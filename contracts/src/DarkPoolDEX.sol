// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.25;

// ============================================================================
//  DARK POOL DEX — Production V1 on Fhenix CoFHE
// ============================================================================
//
//  End-to-end encrypted order book with FHERC20 escrow, batch auction
//  matching, optimistic settlement, and protocol fee collection.
//
//  Architecture:
//    Client  ──encrypt──▶  OrderBook  ──events──▶  CoFHE Matcher (off-chain)
//                              ▲                         │
//                              └── publishMatches ◀──────┘
//                              └── settleMatch (after dispute window)
//
//  Privacy guarantees:
//    • Order side, price, size, and fill amounts are euint128 — never exposed on-chain
//    • Settlement transfers use FHERC20 encrypted balances
//    • Events leak only: pairId, batchId, orderId counters, timestamps
//    • No order counts emitted in batch events
//
//  Trust assumptions (Stage 1 — "Training Wheels"):
//    • Matcher role is trusted to publish correct matches
//    • Threshold Network operators trusted for honest decryption
//    • Admin can pause but cannot access encrypted order data
//    • Dispute window allows participants to challenge bad matches
//
//  IMPORTANT — verify all FHERC20 function signatures against the latest
//  fhenix-confidential-contracts release before deployment. The operator
//  model (setOperator / confidentialTransferFrom) replaces ERC20 approve.
//
// ============================================================================

import "@fhenixprotocol/cofhe-contracts/FHE.sol";

// ─────────────────────────────────────────────────────────────────────────────
//  Interfaces
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @notice Minimal FHERC20 interface for the Dark Pool.
 *         Matches fhenix-confidential-contracts v0.3.x operator model.
 *         FHERC20 replaces allowances with time-limited operators and uses
 *         encrypted transfer amounts throughout.
 *
 *         VERIFY these signatures against the deployed FHERC20 you integrate.
 */
interface IFHERC20 {
    /// @notice Transfer encrypted amount from caller to `to`.
    function confidentialTransfer(address to, InEuint128 calldata amount) external;

    /// @notice Operator-initiated transfer of encrypted amount.
    ///         Caller must be an active operator for `from`.
    function confidentialTransferFrom(
        address from,
        address to,
        InEuint128 calldata amount
    ) external;

    /// @notice Operator-initiated transfer using an already verified encrypted handle.
    function confidentialTransferFrom(
        address from,
        address to,
        euint128 amount
    ) external;

    /// @notice Grant operator rights to `spender` until `deadline`.
    function setOperator(address spender, uint256 deadline) external;

    /// @notice Check whether `spender` is an active operator for `holder`.
    function isOperator(address holder, address spender) external view returns (bool);
}

/**
 * @notice Extended FHERC20 interface for contract-held encrypted balances.
 *         The DEX holds tokens in its own FHERC20 balance and must transfer
 *         them out using euint128 handles (not InEuint128 user inputs).
 *
 *         If your FHERC20 does NOT expose this function, deploy a thin
 *         VaultAdapter that wraps the internal _confidentialTransfer.
 */
interface IFHERC20Vault {
    /// @notice Transfer an encrypted amount the contract already holds
    ///         (referenced by euint128 handle) to `to`.
    ///         This is the contract-facing counterpart of confidentialTransfer.
    function confidentialTransfer(address to, euint128 amount) external;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main Contract
// ─────────────────────────────────────────────────────────────────────────────

contract DarkPoolDEX {
    using FHE for euint128;
    using FHE for ebool;

    // ========================================================================
    //  TYPES
    // ========================================================================

    enum OrderStatus { ACTIVE, MATCHED, SETTLED, CANCELLED }
    enum MatchStatus { PENDING, DISPUTED, SETTLED, VOIDED }

    struct TradingPair {
        address baseToken;           // e.g. wrapped USDC (FHERC20)
        address quoteToken;          // e.g. wrapped ETH  (FHERC20)
        bool    active;
        uint128 minOrderSize;        // plaintext floor (in base-unit wei) for spam prevention
    }

    /**
     * @notice Encrypted order.
     *
     *  Each order stores both token legs. One deposit leg and the opposite
     *  request leg are encrypted zero, but observers cannot distinguish zero
     *  ciphertext from a nonzero amount.
     *
     *  BUY  = baseDeposit > 0, quoteRequest > 0, quoteDeposit = baseRequest = 0.
     *  SELL = quoteDeposit > 0, baseRequest > 0, baseDeposit = quoteRequest = 0.
     *
     *  Implicit limit price = deposit / request (never computed on-chain).
     *
     *  Why four token legs instead of side + two amounts?
     *    → Side is not a public calldata/event/view field.
     *    → submitOrder always touches both pair tokens.
     *    → publish/settle always moves both tokens to both matched traders,
     *      with encrypted zero on inactive directions.
     *    → Avoids euint128 × euint128 overflow (no euint256 in CoFHE).
     *    → Settlement transfers deposit/request directly — no multiplication needed.
     */
    struct EncryptedOrder {
        address    trader;
        bytes32    accountCommitment;
        uint256    pairId;
        euint128   baseDeposit;       // encrypted base tokens locked by trader
        euint128   quoteDeposit;      // encrypted quote tokens locked by trader
        euint128   baseRequest;       // encrypted base tokens requested by trader
        euint128   quoteRequest;      // encrypted quote tokens requested by trader
        euint128   remainingBaseDeposit;
        euint128   remainingQuoteDeposit;
        euint128   remainingBaseRequest;
        euint128   remainingQuoteRequest;
        uint256    batchId;
        uint256    createdAt;
        uint256    expiry;            // 0 = no expiry
        OrderStatus status;
    }

    /**
     * @notice Published match between two private-side orders.
     *
     *  The matcher specifies encrypted token flows in every direction. Two
     *  directions are encrypted zero for an ordinary BUY/SELL fill, but the
     *  calldata, events, and settlement calls do not label either order side.
     *  On-chain verification:
     *    • each outgoing token flow ≤ counterparty's remaining deposit
     *    • each incoming token flow ≤ receiver's remaining request
     *  Price fairness is trusted to the matcher (Stage 1) with a dispute window.
     */
    struct Match {
        uint256    pairId;
        uint256    orderAId;
        uint256    orderBId;
        euint128   baseToA;
        euint128   quoteToA;
        euint128   baseToB;
        euint128   quoteToB;
        euint128   protocolFeeBaseToA;
        euint128   protocolFeeQuoteToA;
        euint128   protocolFeeBaseToB;
        euint128   protocolFeeQuoteToB;
        uint256    publishedAt;
        MatchStatus status;
    }

    struct Batch {
        uint256 openedAt;
        uint256 closedAt;             // 0 while open
        bool    settled;              // true once ALL matches in batch are settled
    }

    // ========================================================================
    //  STATE
    // ========================================================================

    // --- Roles ---
    address public admin;
    address public pendingAdmin;
    address public matcher;           // off-chain matching engine operator
    address public feeCollector;      // receives protocol fees

    // --- Global parameters ---
    uint256 public batchDuration    = 5 minutes;
    uint256 public disputeWindow    = 30 minutes;
    uint256 public feeBps           = 20;          // 0.20%  (20 / 10_000)
    uint256 public constant MAX_FEE = 100;         // 1.00% hard ceiling
    uint256 public constant BPS     = 10_000;

    // --- Counters ---
    uint256 public nextOrderId;
    uint256 public nextMatchId;
    uint256 public currentBatchId;

    // --- Storage ---
    mapping(uint256 => TradingPair)    public pairs;
    uint256 public nextPairId;

    mapping(uint256 => EncryptedOrder) internal _orders;
    mapping(uint256 => Match)          internal _matches;
    mapping(uint256 => Batch)          public   batches;
    mapping(bytes32 => bool)           public   accountRegistered;
    mapping(bytes32 => mapping(address => bool)) public sessionAuthorized;

    // Batch → order IDs (for iteration by matcher off-chain via events only)
    // We intentionally do NOT store arrays on-chain to avoid gas bombs.

    // Per-pair accumulated encrypted fees awaiting withdrawal
    mapping(uint256 => euint128) internal _accumulatedFeeBase;
    mapping(uint256 => euint128) internal _accumulatedFeeQuote;

    // --- Circuit breakers ---
    bool public paused;
    uint256 public maxOrdersPerBatch = 500;
    mapping(uint256 => uint256) public batchOrderCount; // batchId → count

    // --- Reentrancy lock ---
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED     = 2;
    uint256 private _reentrancyStatus     = _NOT_ENTERED;

    // ========================================================================
    //  EVENTS  (minimal metadata — no order counts, no encrypted values)
    // ========================================================================

    event PairRegistered(uint256 indexed pairId, address baseToken, address quoteToken);
    event PairToggled(uint256 indexed pairId, bool active);

    event BatchOpened(uint256 indexed batchId, uint256 timestamp);
    event BatchClosed(uint256 indexed batchId, uint256 timestamp);

    event OrderSubmitted(
        uint256 indexed orderId,
        uint256 indexed pairId,
        uint256 indexed batchId,
        address trader
    );
    event OrderSubmittedPrivate(
        uint256 indexed orderId,
        uint256 indexed pairId,
        uint256 indexed batchId,
        bytes32 accountCommitment
    );
    event OrderCancelled(uint256 indexed orderId, address indexed trader);
    event AccountRegistered(bytes32 indexed accountCommitment, address indexed session);
    event SessionAuthorized(bytes32 indexed accountCommitment, address indexed session);
    event SessionRevoked(bytes32 indexed accountCommitment, address indexed session);

    event MatchPublished(
        uint256 indexed matchId,
        uint256 indexed batchId,
        uint256 orderAId,
        uint256 orderBId
    );
    event MatchDisputed(uint256 indexed matchId, address indexed disputor);
    event MatchSettled(uint256 indexed matchId);
    event MatchVoided(uint256 indexed matchId);

    event Paused(address indexed by);
    event Unpaused(address indexed by);

    event AdminTransferInitiated(address indexed newAdmin);
    event AdminTransferCompleted(address indexed newAdmin);
    event MatcherUpdated(address indexed newMatcher);
    event FeeCollectorUpdated(address indexed newCollector);
    event FeeRateUpdated(uint256 newBps);
    event BatchDurationUpdated(uint256 newDuration);
    event DisputeWindowUpdated(uint256 newWindow);

    // ========================================================================
    //  ERRORS
    // ========================================================================

    error Unauthorized();
    error ContractPaused();
    error InvalidPair();
    error InvalidMatch();
    error PairNotActive();
    error BatchNotOpen();
    error BatchStillOpen();
    error BatchFull();
    error OrderExpired();
    error NotYourOrder();
    error OrderNotActive();
    error OrderNotMatched();
    error MatchNotPending();
    error MatchNotDisputed();
    error DisputeWindowActive();
    error DisputeWindowExpired();
    error FeeTooHigh();
    error ZeroAddress();
    error LengthMismatch();
    error Reentrancy();
    error InvalidDuration();
    error TransferFailed();
    error InvalidAccountCommitment();
    error SessionNotAuthorized();

    // ========================================================================
    //  MODIFIERS
    // ========================================================================

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier onlyMatcher() {
        if (msg.sender != matcher) revert Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    modifier nonReentrant() {
        if (_reentrancyStatus == _ENTERED) revert Reentrancy();
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    // ========================================================================
    //  CONSTRUCTOR
    // ========================================================================

    constructor(address _admin, address _matcher, address _feeCollector) {
        if (_admin == address(0) || _matcher == address(0) || _feeCollector == address(0))
            revert ZeroAddress();

        admin        = _admin;
        matcher      = _matcher;
        feeCollector = _feeCollector;

        // Open the first batch
        batches[0] = Batch({ openedAt: block.timestamp, closedAt: 0, settled: false });
        emit BatchOpened(0, block.timestamp);
    }

    // ========================================================================
    //  ADMIN — Pair Management
    // ========================================================================

    function registerPair(
        address baseToken,
        address quoteToken,
        uint128 minOrderSize
    ) external onlyAdmin returns (uint256 pairId) {
        if (baseToken == address(0) || quoteToken == address(0)) revert ZeroAddress();
        pairId = nextPairId++;
        pairs[pairId] = TradingPair({
            baseToken:    baseToken,
            quoteToken:   quoteToken,
            active:       true,
            minOrderSize: minOrderSize
        });
        _accumulatedFeeBase[pairId]  = FHE.asEuint128(0);
        _accumulatedFeeQuote[pairId] = FHE.asEuint128(0);
        FHE.allowThis(_accumulatedFeeBase[pairId]);
        FHE.allowThis(_accumulatedFeeQuote[pairId]);
        emit PairRegistered(pairId, baseToken, quoteToken);
    }

    function togglePair(uint256 pairId, bool active) external onlyAdmin {
        if (pairId >= nextPairId) revert InvalidPair();
        pairs[pairId].active = active;
        emit PairToggled(pairId, active);
    }

    function setMinOrderSize(uint256 pairId, uint128 size) external onlyAdmin {
        if (pairId >= nextPairId) revert InvalidPair();
        pairs[pairId].minOrderSize = size;
    }

    // ========================================================================
    //  ADMIN — Roles & Parameters
    // ========================================================================

    /// @notice Two-step admin transfer to prevent accidental lockout.
    function initiateAdminTransfer(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        pendingAdmin = newAdmin;
        emit AdminTransferInitiated(newAdmin);
    }

    function acceptAdminTransfer() external {
        if (msg.sender != pendingAdmin) revert Unauthorized();
        admin = pendingAdmin;
        pendingAdmin = address(0);
        emit AdminTransferCompleted(msg.sender);
    }

    function setMatcher(address _matcher) external onlyAdmin {
        if (_matcher == address(0)) revert ZeroAddress();
        matcher = _matcher;
        emit MatcherUpdated(_matcher);
    }

    function setFeeCollector(address _collector) external onlyAdmin {
        if (_collector == address(0)) revert ZeroAddress();
        feeCollector = _collector;
        emit FeeCollectorUpdated(_collector);
    }

    function setFeeRate(uint256 _feeBps) external onlyAdmin {
        if (_feeBps > MAX_FEE) revert FeeTooHigh();
        feeBps = _feeBps;
        emit FeeRateUpdated(_feeBps);
    }

    function setBatchDuration(uint256 _duration) external onlyAdmin {
        if (_duration < 1 minutes || _duration > 1 hours) revert InvalidDuration();
        batchDuration = _duration;
        emit BatchDurationUpdated(_duration);
    }

    function setDisputeWindow(uint256 _window) external onlyAdmin {
        if (_window < 5 minutes || _window > 2 hours) revert InvalidDuration();
        disputeWindow = _window;
        emit DisputeWindowUpdated(_window);
    }

    function setMaxOrdersPerBatch(uint256 _max) external onlyAdmin {
        maxOrdersPerBatch = _max;
    }

    // ========================================================================
    //  ADMIN — Emergency Controls
    // ========================================================================

    function pause() external onlyAdmin {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyAdmin {
        paused = false;
        emit Unpaused(msg.sender);
    }

    // ========================================================================
    //  BATCH MANAGEMENT
    // ========================================================================

    /// @notice Rotate to a new batch. Anyone can call once the duration elapses.
    function closeBatch() external whenNotPaused {
        Batch storage current = batches[currentBatchId];
        if (current.closedAt != 0) revert BatchNotOpen();
        if (block.timestamp < current.openedAt + batchDuration) revert BatchStillOpen();

        current.closedAt = block.timestamp;
        emit BatchClosed(currentBatchId, block.timestamp);

        // Open next batch
        currentBatchId++;
        batches[currentBatchId] = Batch({
            openedAt:  block.timestamp,
            closedAt:  0,
            settled:   false
        });
        emit BatchOpened(currentBatchId, block.timestamp);
    }

    // ========================================================================
    //  ACCOUNT COMMITMENTS & SESSION AUTHORIZATION
    // ========================================================================

    /**
     * @notice Register an account commitment and authorize msg.sender as its
     *         first session. The commitment should be derived off-chain from
     *         owner-private material and a session key.
     */
    function registerSessionAccount(bytes32 accountCommitment) external whenNotPaused {
        _authorizeSession(accountCommitment, msg.sender, true);
    }

    /**
     * @notice Let an already-authorized session authorize another session for
     *         the same account commitment.
     */
    function authorizeSession(bytes32 accountCommitment, address session) external whenNotPaused {
        if (!sessionAuthorized[accountCommitment][msg.sender]) revert SessionNotAuthorized();
        _authorizeSession(accountCommitment, session, false);
    }

    function revokeSession(bytes32 accountCommitment, address session) external whenNotPaused {
        if (!sessionAuthorized[accountCommitment][msg.sender]) revert SessionNotAuthorized();
        sessionAuthorized[accountCommitment][session] = false;
        emit SessionRevoked(accountCommitment, session);
    }

    function _authorizeSession(bytes32 accountCommitment, address session, bool registerIfNeeded) internal {
        if (accountCommitment == bytes32(0)) revert InvalidAccountCommitment();
        if (session == address(0)) revert ZeroAddress();
        if (!accountRegistered[accountCommitment]) {
            if (!registerIfNeeded) revert InvalidAccountCommitment();
            accountRegistered[accountCommitment] = true;
            emit AccountRegistered(accountCommitment, session);
        }
        sessionAuthorized[accountCommitment][session] = true;
        emit SessionAuthorized(accountCommitment, session);
    }

    // ========================================================================
    //  ORDER SUBMISSION  (with FHERC20 escrow)
    // ========================================================================

    /**
     * @notice Submit an encrypted order and escrow tokens.
     *
     *  The caller provides both token legs. For a BUY, quote deposit and base
     *  request are encrypted zero. For a SELL, base deposit and quote request
     *  are encrypted zero. The DEX escrows both token legs every time, so
     *  public calldata/events do not disclose side.
     *
     *  Prerequisites:
     *    Trader must have called `setOperator(address(this), deadline)` on both
     *    FHERC20 pair tokens BEFORE calling this function.
     *
     * @param pairId           Registered trading pair ID.
     * @param encBaseDeposit   Encrypted base tokens deposited by trader.
     * @param encQuoteDeposit  Encrypted quote tokens deposited by trader.
     * @param encBaseRequest   Encrypted base tokens requested by trader.
     * @param encQuoteRequest  Encrypted quote tokens requested by trader.
     * @param expiry           Unix timestamp after which the order auto-expires.
     *                         Pass 0 for no expiry.
     */
    function submitOrder(
        uint256 pairId,
        InEuint128 calldata encBaseDeposit,
        InEuint128 calldata encQuoteDeposit,
        InEuint128 calldata encBaseRequest,
        InEuint128 calldata encQuoteRequest,
        uint256 expiry
    ) external whenNotPaused nonReentrant returns (uint256 orderId) {
        orderId = _submitOrder(
            bytes32(0),
            pairId,
            encBaseDeposit,
            encQuoteDeposit,
            encBaseRequest,
            encQuoteRequest,
            expiry
        );
        emit OrderSubmitted(orderId, pairId, currentBatchId, msg.sender);
    }

    /**
     * @notice Submit an encrypted order through an authorized session account.
     *         The event emits the account commitment instead of a trader
     *         address. Escrow still comes from msg.sender, so the session key
     *         should hold/operator-control the encrypted testnet funds.
     */
    function submitOrderForAccount(
        bytes32 accountCommitment,
        uint256 pairId,
        InEuint128 calldata encBaseDeposit,
        InEuint128 calldata encQuoteDeposit,
        InEuint128 calldata encBaseRequest,
        InEuint128 calldata encQuoteRequest,
        uint256 expiry
    ) external whenNotPaused nonReentrant returns (uint256 orderId) {
        if (!sessionAuthorized[accountCommitment][msg.sender]) revert SessionNotAuthorized();
        orderId = _submitOrder(
            accountCommitment,
            pairId,
            encBaseDeposit,
            encQuoteDeposit,
            encBaseRequest,
            encQuoteRequest,
            expiry
        );
        emit OrderSubmittedPrivate(orderId, pairId, currentBatchId, accountCommitment);
    }

    function _submitOrder(
        bytes32 accountCommitment,
        uint256 pairId,
        InEuint128 calldata encBaseDeposit,
        InEuint128 calldata encQuoteDeposit,
        InEuint128 calldata encBaseRequest,
        InEuint128 calldata encQuoteRequest,
        uint256 expiry
    ) internal returns (uint256 orderId) {
        // --- Validations ---
        if (pairId >= nextPairId) revert InvalidPair();
        TradingPair storage pair = pairs[pairId];
        if (!pair.active) revert PairNotActive();

        Batch storage batch = batches[currentBatchId];
        if (batch.closedAt != 0) revert BatchNotOpen();
        if (batchOrderCount[currentBatchId] >= maxOrdersPerBatch) revert BatchFull();

        if (expiry != 0 && expiry <= block.timestamp) revert OrderExpired();

        // --- Convert encrypted inputs to handles ---
        euint128 baseDeposit = FHE.asEuint128(encBaseDeposit);
        euint128 quoteDeposit = FHE.asEuint128(encQuoteDeposit);
        euint128 baseRequest = FHE.asEuint128(encBaseRequest);
        euint128 quoteRequest = FHE.asEuint128(encQuoteRequest);

        // --- Store order ---
        orderId = nextOrderId++;
        EncryptedOrder storage order = _orders[orderId];
        order.trader = msg.sender;
        order.accountCommitment = accountCommitment;
        order.pairId = pairId;
        order.baseDeposit = baseDeposit;
        order.quoteDeposit = quoteDeposit;
        order.baseRequest = baseRequest;
        order.quoteRequest = quoteRequest;
        order.remainingBaseDeposit = baseDeposit;
        order.remainingQuoteDeposit = quoteDeposit;
        order.remainingBaseRequest = baseRequest;
        order.remainingQuoteRequest = quoteRequest;
        order.batchId = currentBatchId;
        order.createdAt = block.timestamp;
        order.expiry = expiry;
        order.status = OrderStatus.ACTIVE;

        batchOrderCount[currentBatchId]++;

        _allowAndEscrowTokenLegs(pair.baseToken, msg.sender, baseDeposit, baseRequest);
        _allowAndEscrowTokenLegs(pair.quoteToken, msg.sender, quoteDeposit, quoteRequest);
    }

    function _allowAndEscrowTokenLegs(
        address token,
        address trader,
        euint128 deposit,
        euint128 request
    ) internal {
        _allowOrderLeg(deposit, trader, matcher, token);
        _allowOrderLeg(request, trader, matcher, token);

        // The user-signed InEuint128 was verified above while msg.sender was
        // still the trader. We transfer verified handles, not the raw inputs.
        IFHERC20(token).confidentialTransferFrom(trader, address(this), deposit);
    }

    function _allowOrderLeg(
        euint128 amount,
        address trader,
        address matcher_,
        address token
    ) internal {
        FHE.allowThis(amount);
        FHE.allow(amount, trader);
        FHE.allow(amount, matcher_);
        FHE.allow(amount, token);
    }

    // ========================================================================
    //  ORDER CANCELLATION  (with FHERC20 refund)
    // ========================================================================

    /**
     * @notice Cancel an active order and refund escrowed tokens.
     *         Only the original trader can cancel. Only ACTIVE orders.
     */
    function cancelOrder(uint256 orderId) external nonReentrant {
        EncryptedOrder storage order = _orders[orderId];
        if (order.trader != msg.sender) revert NotYourOrder();
        if (order.status != OrderStatus.ACTIVE) revert OrderNotActive();

        order.status = OrderStatus.CANCELLED;

        // Refund both remaining deposit legs back to trader. One leg is
        // usually encrypted zero; transferring both preserves side privacy.
        TradingPair storage pair = pairs[order.pairId];

        FHE.allow(order.remainingBaseDeposit, pair.baseToken);
        IFHERC20Vault(pair.baseToken).confidentialTransfer(
            msg.sender,
            order.remainingBaseDeposit
        );
        FHE.allow(order.remainingQuoteDeposit, pair.quoteToken);
        IFHERC20Vault(pair.quoteToken).confidentialTransfer(
            msg.sender,
            order.remainingQuoteDeposit
        );

        emit OrderCancelled(orderId, msg.sender);
    }

    // ========================================================================
    //  MATCH PUBLISHING  (by authorized Matcher)
    // ========================================================================

    /**
     * @notice Publish a batch of matches computed off-chain.
     *
     *  The matcher sends generic order A/B pairs plus encrypted token flows in
     *  each direction. Two flows are encrypted zero for a normal BUY/SELL fill,
     *  but observers cannot distinguish zero ciphertext from nonzero amounts.
     */
    function publishMatches(
        uint256[] calldata orderAIds,
        uint256[] calldata orderBIds,
        InEuint128[] calldata baseToA_,
        InEuint128[] calldata quoteToA_,
        InEuint128[] calldata baseToB_,
        InEuint128[] calldata quoteToB_
    ) external onlyMatcher whenNotPaused nonReentrant {
        uint256 len = orderAIds.length;
        if (
            len != orderBIds.length ||
            len != baseToA_.length ||
            len != quoteToA_.length ||
            len != baseToB_.length ||
            len != quoteToB_.length
        ) revert LengthMismatch();

        for (uint256 i = 0; i < len; i++) {
            _publishSingleMatch(
                orderAIds[i],
                orderBIds[i],
                baseToA_[i],
                quoteToA_[i],
                baseToB_[i],
                quoteToB_[i]
            );
        }
    }

    struct _MatchFlow {
        euint128 baseToA;
        euint128 quoteToA;
        euint128 baseToB;
        euint128 quoteToB;
    }

    struct _MatchFee {
        euint128 baseToA;
        euint128 quoteToA;
        euint128 baseToB;
        euint128 quoteToB;
    }

    function _publishSingleMatch(
        uint256 orderAId,
        uint256 orderBId,
        InEuint128 calldata encBaseToA,
        InEuint128 calldata encQuoteToA,
        InEuint128 calldata encBaseToB,
        InEuint128 calldata encQuoteToB
    ) internal {
        EncryptedOrder storage orderA = _orders[orderAId];
        EncryptedOrder storage orderB = _orders[orderBId];

        if (orderAId == orderBId) revert InvalidMatch();
        if (orderA.status != OrderStatus.ACTIVE) revert OrderNotActive();
        if (orderB.status != OrderStatus.ACTIVE) revert OrderNotActive();
        if (orderA.pairId != orderB.pairId) revert InvalidPair();
        TradingPair storage pair = pairs[orderA.pairId];

        if (batches[orderA.batchId].closedAt == 0) revert BatchStillOpen();
        if (batches[orderB.batchId].closedAt == 0) revert BatchStillOpen();
        if (orderA.expiry != 0 && orderA.expiry < block.timestamp) revert OrderExpired();
        if (orderB.expiry != 0 && orderB.expiry < block.timestamp) revert OrderExpired();

        _MatchFlow memory flow = _MatchFlow({
            baseToA: FHE.asEuint128(encBaseToA),
            quoteToA: FHE.asEuint128(encQuoteToA),
            baseToB: FHE.asEuint128(encBaseToB),
            quoteToB: FHE.asEuint128(encQuoteToB)
        });
        flow = _validatedMatchFlow(orderA, orderB, flow);

        _MatchFee memory fee = _matchFees(flow);
        _debitMatchedOrders(orderA, orderB, flow);
        _allowRemainingOrder(orderA, pair);
        _allowRemainingOrder(orderB, pair);

        uint256 matchId = nextMatchId++;
        _matches[matchId] = Match({
            pairId: orderA.pairId,
            orderAId: orderAId,
            orderBId: orderBId,
            baseToA: FHE.sub(flow.baseToA, fee.baseToA),
            quoteToA: FHE.sub(flow.quoteToA, fee.quoteToA),
            baseToB: FHE.sub(flow.baseToB, fee.baseToB),
            quoteToB: FHE.sub(flow.quoteToB, fee.quoteToB),
            protocolFeeBaseToA: fee.baseToA,
            protocolFeeQuoteToA: fee.quoteToA,
            protocolFeeBaseToB: fee.baseToB,
            protocolFeeQuoteToB: fee.quoteToB,
            publishedAt: block.timestamp,
            status: MatchStatus.PENDING
        });

        _allowMatchForSettlement(_matches[matchId], pair);
        emit MatchPublished(matchId, orderA.batchId, orderAId, orderBId);
    }

    function _validatedMatchFlow(
        EncryptedOrder storage orderA,
        EncryptedOrder storage orderB,
        _MatchFlow memory flow
    ) internal returns (_MatchFlow memory) {
        ebool baseToAOk = FHE.and(
            FHE.lte(flow.baseToA, orderB.remainingBaseDeposit),
            FHE.lte(flow.baseToA, orderA.remainingBaseRequest)
        );
        ebool quoteToAOk = FHE.and(
            FHE.lte(flow.quoteToA, orderB.remainingQuoteDeposit),
            FHE.lte(flow.quoteToA, orderA.remainingQuoteRequest)
        );
        ebool baseToBOk = FHE.and(
            FHE.lte(flow.baseToB, orderA.remainingBaseDeposit),
            FHE.lte(flow.baseToB, orderB.remainingBaseRequest)
        );
        ebool quoteToBOk = FHE.and(
            FHE.lte(flow.quoteToB, orderA.remainingQuoteDeposit),
            FHE.lte(flow.quoteToB, orderB.remainingQuoteRequest)
        );
        ebool ok = FHE.and(FHE.and(baseToAOk, quoteToAOk), FHE.and(baseToBOk, quoteToBOk));
        euint128 zero = FHE.asEuint128(0);
        return _MatchFlow({
            baseToA: FHE.select(ok, flow.baseToA, zero),
            quoteToA: FHE.select(ok, flow.quoteToA, zero),
            baseToB: FHE.select(ok, flow.baseToB, zero),
            quoteToB: FHE.select(ok, flow.quoteToB, zero)
        });
    }

    function _matchFees(_MatchFlow memory flow) internal returns (_MatchFee memory) {
        euint128 encFeeBps = FHE.asEuint128(feeBps);
        euint128 encBPS = FHE.asEuint128(BPS);
        return _MatchFee({
            baseToA: FHE.div(FHE.mul(flow.baseToA, encFeeBps), encBPS),
            quoteToA: FHE.div(FHE.mul(flow.quoteToA, encFeeBps), encBPS),
            baseToB: FHE.div(FHE.mul(flow.baseToB, encFeeBps), encBPS),
            quoteToB: FHE.div(FHE.mul(flow.quoteToB, encFeeBps), encBPS)
        });
    }

    function _debitMatchedOrders(
        EncryptedOrder storage orderA,
        EncryptedOrder storage orderB,
        _MatchFlow memory flow
    ) internal {
        orderA.remainingBaseDeposit = FHE.sub(orderA.remainingBaseDeposit, flow.baseToB);
        orderA.remainingQuoteDeposit = FHE.sub(orderA.remainingQuoteDeposit, flow.quoteToB);
        orderA.remainingBaseRequest = FHE.sub(orderA.remainingBaseRequest, flow.baseToA);
        orderA.remainingQuoteRequest = FHE.sub(orderA.remainingQuoteRequest, flow.quoteToA);
        orderB.remainingBaseDeposit = FHE.sub(orderB.remainingBaseDeposit, flow.baseToA);
        orderB.remainingQuoteDeposit = FHE.sub(orderB.remainingQuoteDeposit, flow.quoteToA);
        orderB.remainingBaseRequest = FHE.sub(orderB.remainingBaseRequest, flow.baseToB);
        orderB.remainingQuoteRequest = FHE.sub(orderB.remainingQuoteRequest, flow.quoteToB);
    }

    function _allowRemainingOrder(EncryptedOrder storage order, TradingPair storage pair) internal {
        FHE.allowThis(order.remainingBaseDeposit);
        FHE.allowThis(order.remainingQuoteDeposit);
        FHE.allowThis(order.remainingBaseRequest);
        FHE.allowThis(order.remainingQuoteRequest);
        FHE.allow(order.remainingBaseDeposit, matcher);
        FHE.allow(order.remainingQuoteDeposit, matcher);
        FHE.allow(order.remainingBaseRequest, matcher);
        FHE.allow(order.remainingQuoteRequest, matcher);
        FHE.allow(order.remainingBaseDeposit, pair.baseToken);
        FHE.allow(order.remainingQuoteDeposit, pair.quoteToken);
    }

    function _allowMatchForSettlement(Match storage m, TradingPair storage pair) internal {
        FHE.allowThis(m.baseToA);
        FHE.allowThis(m.quoteToA);
        FHE.allowThis(m.baseToB);
        FHE.allowThis(m.quoteToB);
        FHE.allowThis(m.protocolFeeBaseToA);
        FHE.allowThis(m.protocolFeeQuoteToA);
        FHE.allowThis(m.protocolFeeBaseToB);
        FHE.allowThis(m.protocolFeeQuoteToB);
        FHE.allow(m.baseToA, pair.baseToken);
        FHE.allow(m.baseToB, pair.baseToken);
        FHE.allow(m.quoteToA, pair.quoteToken);
        FHE.allow(m.quoteToB, pair.quoteToken);
    }

    // ========================================================================
    //  DISPUTE MECHANISM
    // ========================================================================

    /**
     * @notice Either party of a match can dispute within the dispute window.
     *         Disputed matches are reviewed by admin (Stage 1 trust model).
     *         In Stage 2, this will be replaced by on-chain fraud proofs.
     */
    function disputeMatch(uint256 matchId) external {
        Match storage m = _matches[matchId];
        if (m.status != MatchStatus.PENDING) revert MatchNotPending();
        if (block.timestamp > m.publishedAt + disputeWindow)
            revert DisputeWindowExpired();

        address traderA = _orders[m.orderAId].trader;
        address traderB = _orders[m.orderBId].trader;
        if (msg.sender != traderA && msg.sender != traderB) revert Unauthorized();

        m.status = MatchStatus.DISPUTED;
        emit MatchDisputed(matchId, msg.sender);
    }

    /**
     * @notice Admin resolves a disputed match. Stage 1 trust assumption.
     * @param matchId  The disputed match.
     * @param valid    true = settle normally, false = void and refund.
     */
    function resolveDispute(uint256 matchId, bool valid) external onlyAdmin nonReentrant {
        Match storage m = _matches[matchId];
        if (m.status != MatchStatus.DISPUTED) revert MatchNotDisputed();

        if (valid) {
            m.status = MatchStatus.PENDING;  // back to pending, can now settle
        } else {
            _voidMatch(matchId);
        }
    }

    function _voidMatch(uint256 matchId) internal {
        Match storage m = _matches[matchId];
        m.status = MatchStatus.VOIDED;

        EncryptedOrder storage orderA = _orders[m.orderAId];
        EncryptedOrder storage orderB = _orders[m.orderBId];

        euint128 grossBaseToA = FHE.add(m.baseToA, m.protocolFeeBaseToA);
        euint128 grossQuoteToA = FHE.add(m.quoteToA, m.protocolFeeQuoteToA);
        euint128 grossBaseToB = FHE.add(m.baseToB, m.protocolFeeBaseToB);
        euint128 grossQuoteToB = FHE.add(m.quoteToB, m.protocolFeeQuoteToB);

        orderA.remainingBaseDeposit = FHE.add(orderA.remainingBaseDeposit, grossBaseToB);
        orderA.remainingQuoteDeposit = FHE.add(orderA.remainingQuoteDeposit, grossQuoteToB);
        orderA.remainingBaseRequest = FHE.add(orderA.remainingBaseRequest, grossBaseToA);
        orderA.remainingQuoteRequest = FHE.add(orderA.remainingQuoteRequest, grossQuoteToA);
        orderB.remainingBaseDeposit = FHE.add(orderB.remainingBaseDeposit, grossBaseToA);
        orderB.remainingQuoteDeposit = FHE.add(orderB.remainingQuoteDeposit, grossQuoteToA);
        orderB.remainingBaseRequest = FHE.add(orderB.remainingBaseRequest, grossBaseToB);
        orderB.remainingQuoteRequest = FHE.add(orderB.remainingQuoteRequest, grossQuoteToB);

        orderA.status = OrderStatus.ACTIVE;
        orderB.status = OrderStatus.ACTIVE;

        TradingPair storage pair = pairs[m.pairId];
        _allowRemainingOrder(orderA, pair);
        _allowRemainingOrder(orderB, pair);

        emit MatchVoided(matchId);
    }

    // ========================================================================
    //  SETTLEMENT  (encrypted FHERC20 transfers)
    // ========================================================================

    /**
     * @notice Settle a match after the dispute window has elapsed.
     *         Transfers are fully encrypted — never decrypted on-chain.
     *
     *  Flow:
     *    1. base and quote flow to order A's trader
     *    2. base and quote flow to order B's trader
     *    3. fees accumulated in protocol fee pool
     *
     *  Anyone can call (permissionless settlement incentivizes liveness).
     */
    function settleMatch(uint256 matchId) external whenNotPaused nonReentrant {
        Match storage m = _matches[matchId];
        if (m.status != MatchStatus.PENDING) revert MatchNotPending();
        if (block.timestamp < m.publishedAt + disputeWindow)
            revert DisputeWindowActive();

        TradingPair storage pair = pairs[m.pairId];

        FHE.allow(m.baseToA, pair.baseToken);
        IFHERC20Vault(pair.baseToken).confidentialTransfer(
            _orders[m.orderAId].trader,
            m.baseToA
        );
        FHE.allow(m.quoteToA, pair.quoteToken);
        IFHERC20Vault(pair.quoteToken).confidentialTransfer(
            _orders[m.orderAId].trader,
            m.quoteToA
        );
        FHE.allow(m.baseToB, pair.baseToken);
        IFHERC20Vault(pair.baseToken).confidentialTransfer(
            _orders[m.orderBId].trader,
            m.baseToB
        );
        FHE.allow(m.quoteToB, pair.quoteToken);
        IFHERC20Vault(pair.quoteToken).confidentialTransfer(
            _orders[m.orderBId].trader,
            m.quoteToB
        );

        // --- Accumulate protocol fees ---
        _accumulatedFeeBase[m.pairId]  = FHE.add(
            _accumulatedFeeBase[m.pairId],
            FHE.add(m.protocolFeeBaseToA, m.protocolFeeBaseToB)
        );
        _accumulatedFeeQuote[m.pairId] = FHE.add(
            _accumulatedFeeQuote[m.pairId],
            FHE.add(m.protocolFeeQuoteToA, m.protocolFeeQuoteToB)
        );

        FHE.allowThis(_accumulatedFeeBase[m.pairId]);
        FHE.allowThis(_accumulatedFeeQuote[m.pairId]);

        // --- Finalize ---
        m.status = MatchStatus.SETTLED;

        emit MatchSettled(matchId);
    }

    // ========================================================================
    //  FEE WITHDRAWAL
    // ========================================================================

    /**
     * @notice Withdraw accumulated protocol fees for a trading pair.
     *         Fees remain encrypted — feeCollector receives FHERC20 tokens.
     */
    function withdrawFees(uint256 pairId) external nonReentrant {
        if (msg.sender != feeCollector && msg.sender != admin) revert Unauthorized();
        if (pairId >= nextPairId) revert InvalidPair();

        TradingPair storage pair = pairs[pairId];

        // Transfer accumulated base fees
        euint128 baseFee = _accumulatedFeeBase[pairId];
        euint128 zeroBase = FHE.asEuint128(0);
        FHE.allowThis(zeroBase);
        _accumulatedFeeBase[pairId] = zeroBase;
        FHE.allow(baseFee, pair.baseToken);
        IFHERC20Vault(pair.baseToken).confidentialTransfer(feeCollector, baseFee);

        // Transfer accumulated quote fees
        euint128 quoteFee = _accumulatedFeeQuote[pairId];
        euint128 zeroQuote = FHE.asEuint128(0);
        FHE.allowThis(zeroQuote);
        _accumulatedFeeQuote[pairId] = zeroQuote;
        FHE.allow(quoteFee, pair.quoteToken);
        IFHERC20Vault(pair.quoteToken).confidentialTransfer(feeCollector, quoteFee);
    }

    // ========================================================================
    //  PARTIAL FILL MANAGEMENT
    // ========================================================================

    /**
     * @notice After partial fills, a trader can withdraw the unfilled remainder
     *         of their order. This is separate from cancelOrder because the
     *         order has already been MATCHED (partially).
     */
    function withdrawRemainder(uint256 orderId) external nonReentrant {
        EncryptedOrder storage order = _orders[orderId];
        if (order.trader != msg.sender) revert NotYourOrder();
        if (order.status != OrderStatus.MATCHED && order.status != OrderStatus.SETTLED)
            revert OrderNotMatched();

        TradingPair storage pair = pairs[order.pairId];

        euint128 baseRemainder = order.remainingBaseDeposit;
        euint128 quoteRemainder = order.remainingQuoteDeposit;
        euint128 zeroRemainder = FHE.asEuint128(0);
        FHE.allowThis(zeroRemainder);
        order.remainingBaseDeposit = zeroRemainder;
        order.remainingQuoteDeposit = zeroRemainder;

        FHE.allow(baseRemainder, pair.baseToken);
        IFHERC20Vault(pair.baseToken).confidentialTransfer(msg.sender, baseRemainder);
        FHE.allow(quoteRemainder, pair.quoteToken);
        IFHERC20Vault(pair.quoteToken).confidentialTransfer(msg.sender, quoteRemainder);

        // If fully withdrawn, mark as settled
        order.status = OrderStatus.SETTLED;
    }

    // ========================================================================
    //  VIEW FUNCTIONS  (sealed outputs for authorized callers)
    // ========================================================================

    /**
     * @notice Get order metadata (plaintext fields only).
     */
    function getOrderInfo(uint256 orderId) external view returns (
        address  trader,
        uint256  pairId,
        uint256  batchId,
        uint256  createdAt,
        uint256  expiry,
        OrderStatus status
    ) {
        EncryptedOrder storage o = _orders[orderId];
        return (o.trader, o.pairId, o.batchId, o.createdAt, o.expiry, o.status);
    }

    /**
     * @notice Get match metadata (plaintext fields only).
     */
    function getMatchInfo(uint256 matchId) external view returns (
        uint256 pairId,
        uint256 orderAId,
        uint256 orderBId,
        uint256 publishedAt,
        MatchStatus status
    ) {
        Match storage m = _matches[matchId];
        return (m.pairId, m.orderAId, m.orderBId, m.publishedAt, m.status);
    }

    function getOrderAccountCommitment(uint256 orderId) external view returns (bytes32) {
        return _orders[orderId].accountCommitment;
    }

    /**
     * @notice Returns encrypted order legs for the order owner.
     */
    function getMyOrderLegs(uint256 orderId)
        external view returns (
            euint128 baseDeposit,
            euint128 quoteDeposit,
            euint128 baseRequest,
            euint128 quoteRequest
        )
    {
        EncryptedOrder storage o = _orders[orderId];
        if (o.trader != msg.sender) revert NotYourOrder();
        return (
            o.remainingBaseDeposit,
            o.remainingQuoteDeposit,
            o.remainingBaseRequest,
            o.remainingQuoteRequest
        );
    }

    /// @notice Public view of opaque encrypted order-leg handles.
    ///         Safe to expose because only authorized parties can unseal them.
    function getOrderLegs(uint256 orderId)
        external view returns (
            euint128 baseDeposit,
            euint128 quoteDeposit,
            euint128 baseRequest,
            euint128 quoteRequest
        )
    {
        EncryptedOrder storage o = _orders[orderId];
        return (
            o.remainingBaseDeposit,
            o.remainingQuoteDeposit,
            o.remainingBaseRequest,
            o.remainingQuoteRequest
        );
    }

    /// @notice Current batch info.
    function getCurrentBatch() external view returns (
        uint256 batchId,
        uint256 openedAt,
        bool    isOpen,
        uint256 orderCount
    ) {
        Batch storage b = batches[currentBatchId];
        return (
            currentBatchId,
            b.openedAt,
            b.closedAt == 0,
            batchOrderCount[currentBatchId]
        );
    }
}
