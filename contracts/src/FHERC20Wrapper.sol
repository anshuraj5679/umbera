// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract FHERC20Wrapper {
    using FHE for euint128;
    using SafeERC20 for IERC20;

    IERC20 public immutable underlying;
    string public name;
    string public symbol;
    uint8  public immutable decimals;

    mapping(address => euint128) internal _balances;
    mapping(address => mapping(address => uint256)) public operatorDeadlines;

    event Wrap(address indexed account, uint256 amount);
    event Unwrap(address indexed account, uint256 amount);
    event OperatorSet(address indexed holder, address indexed operator, uint256 deadline);
    event ConfidentialTransfer(address indexed from, address indexed to, uint256 indicator);

    error InsufficientAllowanceOrOperator();
    error ZeroAddress();

    constructor(address _underlying, string memory _name, string memory _symbol, uint8 _decimals) {
        if (_underlying == address(0)) revert ZeroAddress();
        underlying = IERC20(_underlying);
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function wrap(uint256 amount) external {
        underlying.safeTransferFrom(msg.sender, address(this), amount);
        euint128 add = FHE.asEuint128(uint128(amount));
        _balances[msg.sender] = FHE.add(_balances[msg.sender], add);
        FHE.allowThis(_balances[msg.sender]);
        FHE.allow(_balances[msg.sender], msg.sender);
        emit Wrap(msg.sender, amount);
    }

    function setOperator(address spender, uint256 deadline) external {
        operatorDeadlines[msg.sender][spender] = deadline;
        emit OperatorSet(msg.sender, spender, deadline);
    }

    function isOperator(address holder, address spender) external view returns (bool) {
        return operatorDeadlines[holder][spender] > block.timestamp;
    }

    function confidentialTransfer(address to, InEuint128 calldata encAmount) external {
        _internalTransfer(msg.sender, to, FHE.asEuint128(encAmount));
    }

    function confidentialTransferFrom(address from, address to, InEuint128 calldata encAmount) external {
        if (operatorDeadlines[from][msg.sender] <= block.timestamp) revert InsufficientAllowanceOrOperator();
        _internalTransfer(from, to, FHE.asEuint128(encAmount));
    }

    function confidentialTransferFrom(address from, address to, euint128 amount) external {
        if (operatorDeadlines[from][msg.sender] <= block.timestamp) revert InsufficientAllowanceOrOperator();
        _internalTransfer(from, to, amount);
    }

    function confidentialTransfer(address to, euint128 amount) external {
        _internalTransfer(msg.sender, to, amount);
    }

    function _internalTransfer(address from, address to, euint128 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        _balances[from] = FHE.sub(_balances[from], amount);
        _balances[to]   = FHE.add(_balances[to],   amount);
        FHE.allowThis(_balances[from]);
        FHE.allowThis(_balances[to]);
        FHE.allow(_balances[from], from);
        FHE.allow(_balances[to], to);
        emit ConfidentialTransfer(from, to, uint256(keccak256(abi.encode(block.number, from, to))) % 9999);
    }

    function encryptedBalanceOf(address account) external view returns (euint128) {
        return _balances[account];
    }
}
