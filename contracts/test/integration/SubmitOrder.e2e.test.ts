// ============================================================================
//  F3 — Encryption end-to-end smoke
// ============================================================================
//
//  Exercises the real cofhejs.encrypt → submitOrder path against the
//  in-process CoFHE mocks deployed by cofhe-hardhat-plugin. This is the
//  only place the encryption stack is tested under the unit suite — the
//  B4 hardhat suite stays plaintext-only on purpose (see B4 prompt).
//
//  Scope is intentionally narrow: one trader, one pair, one order. The
//  goal is to catch shape/ABI regressions in:
//    • cofhejs initialization with a Hardhat signer
//    • Encryptable.uint128 → InEuint128 wire format
//    • DarkPoolDEX.submitOrder happy path (BUY side)
//    • FHERC20Wrapper operator+wrap+confidentialTransferFrom plumbing
//
//  Full matching/settlement integration belongs in the matcher's
//  testcontainers-based integration suite (see matcher/vitest.integration).
// ============================================================================

import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { Encryptable, FheTypes } from "cofhejs/node";

// Encryption can take a few seconds the first time the tfhe wasm warms up.
const ENCRYPT_TIMEOUT_MS = 120_000;

describe("F3 :: submitOrder end-to-end (encrypted)", function () {
  this.timeout(ENCRYPT_TIMEOUT_MS);

  async function deployStack() {
    const [admin, matcher, feeCollector, alice] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("TestERC20");
    const usdc = await Token.deploy("USDC", "USDC", 6);
    const weth = await Token.deploy("WETH", "WETH", 18);

    const Wrapper = await ethers.getContractFactory("FHERC20Wrapper");
    const eUSDC = await Wrapper.deploy(await usdc.getAddress(), "eUSDC", "eUSDC", 6);
    const eWETH = await Wrapper.deploy(await weth.getAddress(), "eWETH", "eWETH", 18);

    const Dex = await ethers.getContractFactory("DarkPoolDEX");
    const dex = await Dex.deploy(admin.address, matcher.address, feeCollector.address);

    // Pair 0: eUSDC (base) / eWETH (quote)
    await dex.connect(admin).registerPair(
      await eUSDC.getAddress(),
      await eWETH.getAddress(),
      10n * 10n ** 6n,
    );

    return { admin, matcher, feeCollector, alice, usdc, weth, eUSDC, eWETH, dex };
  }

  it("encrypts, escrows, and emits OrderSubmitted for a BUY", async function () {
    const { alice, usdc, eUSDC, eWETH, dex } = await deployStack();

    // ─── Initialize cofhejs bound to Alice's signer ───────────────────────
    // The plugin's helper wires cofhejs to the mock contracts deployed on
    // the hardhat network via the `cofhe` extendEnvironment hook.
    const initRes = await hre.cofhe.initializeWithHardhatSigner(alice);
    expect(initRes.success, `cofhejs init failed: ${initRes.error?.message ?? "unknown"}`).to.equal(true);

    // ─── Fund Alice with plain USDC and wrap into eUSDC ───────────────────
    const oneUSDC = 10n ** 6n;
    const deposit = 100n * oneUSDC; // Alice locks 100 USDC as a buyer
    const request = 25n * 10n ** 18n; // wants 25 eWETH back (price is implicit)

    await usdc.mint(alice.address, deposit);
    await usdc.connect(alice).approve(await eUSDC.getAddress(), deposit);
    await eUSDC.connect(alice).wrap(deposit);

    // ─── Grant DEX operator rights on both pair tokens ────────────────────
    // Side-private submitOrder touches both token legs, with one encrypted zero.
    const latestBlock = await ethers.provider.getBlock("latest");
    const deadline = (latestBlock!.timestamp ?? Math.floor(Date.now() / 1000)) + 3600;
    await eUSDC.connect(alice).setOperator(await dex.getAddress(), deadline);
    await eWETH.connect(alice).setOperator(await dex.getAddress(), deadline);
    expect(await eUSDC.isOperator(alice.address, await dex.getAddress())).to.equal(true);
    expect(await eWETH.isOperator(alice.address, await dex.getAddress())).to.equal(true);

    // ─── Encrypt the four private-side legs via cofhejs ───────────────────
    // Encryptable.uint128 builds the (data, utype, securityZone) tuple that
    // cofhejs.encrypt then turns into InEuint128 calldata structs the
    // DarkPoolDEX entrypoint expects.
    const encRes = await (await import("cofhejs/node")).cofhejs.encrypt([
      Encryptable.uint128(deposit),
      Encryptable.uint128(0n),
      Encryptable.uint128(0n),
      Encryptable.uint128(request),
    ]);
    expect(encRes.success, `cofhejs.encrypt failed: ${encRes.error?.message ?? "unknown"}`).to.equal(true);
    const [encBaseDeposit, encQuoteDeposit, encBaseRequest, encQuoteRequest] = encRes.data!;
    expect(encBaseDeposit.utype).to.equal(FheTypes.Uint128);
    expect(encQuoteDeposit.utype).to.equal(FheTypes.Uint128);
    expect(encBaseRequest.utype).to.equal(FheTypes.Uint128);
    expect(encQuoteRequest.utype).to.equal(FheTypes.Uint128);

    // ─── Submit the BUY order ─────────────────────────────────────────────
    const tx = await dex.connect(alice).submitOrder(
      0,                 // pairId
      encBaseDeposit,
      encQuoteDeposit,
      encBaseRequest,
      encQuoteRequest,
      0,                 // no expiry
    );
    const receipt = await tx.wait();
    expect(receipt?.status).to.equal(1);

    // ─── Verify the OrderSubmitted event ──────────────────────────────────
    const orderSubmitted = receipt!.logs
      .map((l) => {
        try { return dex.interface.parseLog(l); } catch { return null; }
      })
      .find((p) => p?.name === "OrderSubmitted");
    expect(orderSubmitted, "OrderSubmitted event not found in tx logs").to.not.be.null;
    expect(orderSubmitted!.args.trader).to.equal(alice.address);
    expect(orderSubmitted!.args.pairId).to.equal(0n);
    expect(orderSubmitted!.args.side).to.equal(undefined);
    const orderId = orderSubmitted!.args.orderId as bigint;

    // ─── Plaintext metadata read-back must not expose side ────────────────
    const info = await dex.getOrderInfo(orderId);
    expect(info.trader).to.equal(alice.address);
    expect(info.pairId).to.equal(0n);
    expect(info.status).to.equal(0n); // ACTIVE

    // ─── Cross-check encrypted legs via the mock plaintext store ──────────
    const legs = await dex.connect(alice).getMyOrderLegs(orderId);
    const recoveredDeposit = await hre.cofhe.mocks.getPlaintext(BigInt(legs.baseDeposit));
    const recoveredQuoteDeposit = await hre.cofhe.mocks.getPlaintext(BigInt(legs.quoteDeposit));
    const recoveredBaseRequest = await hre.cofhe.mocks.getPlaintext(BigInt(legs.baseRequest));
    const recoveredRequest = await hre.cofhe.mocks.getPlaintext(BigInt(legs.quoteRequest));
    expect(recoveredDeposit).to.equal(deposit);
    expect(recoveredQuoteDeposit).to.equal(0n);
    expect(recoveredBaseRequest).to.equal(0n);
    expect(recoveredRequest).to.equal(request);
  });

  it("rejects submitOrder when the operator deadline is in the past", async function () {
    const { alice, usdc, eUSDC, dex } = await deployStack();

    const initRes = await hre.cofhe.initializeWithHardhatSigner(alice);
    expect(initRes.success).to.equal(true);

    const oneUSDC = 10n ** 6n;
    const deposit = 50n * oneUSDC;
    const request = 1n * 10n ** 18n;

    await usdc.mint(alice.address, deposit);
    await usdc.connect(alice).approve(await eUSDC.getAddress(), deposit);
    await eUSDC.connect(alice).wrap(deposit);

    // Operator deadline already expired — confidentialTransferFrom must revert.
    const past = (await ethers.provider.getBlock("latest"))!.timestamp - 1;
    await eUSDC.connect(alice).setOperator(await dex.getAddress(), past);
    expect(await eUSDC.isOperator(alice.address, await dex.getAddress())).to.equal(false);

    const { cofhejs } = await import("cofhejs/node");
    const encRes = await cofhejs.encrypt([
      Encryptable.uint128(deposit),
      Encryptable.uint128(0n),
      Encryptable.uint128(0n),
      Encryptable.uint128(request),
    ]);
    expect(encRes.success).to.equal(true);
    const [encBaseDeposit, encQuoteDeposit, encBaseRequest, encQuoteRequest] = encRes.data!;

    await expect(
      dex.connect(alice).submitOrder(0, encBaseDeposit, encQuoteDeposit, encBaseRequest, encQuoteRequest, 0),
    ).to.be.revertedWithCustomError(eUSDC, "InsufficientAllowanceOrOperator");
  });
});
