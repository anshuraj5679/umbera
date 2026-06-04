// ============================================================================
//  F3 — Encryption end-to-end smoke
// ============================================================================
//
//  Exercises the real @cofhe/sdk encryptInputs → submitOrder path against the
//  in-process CoFHE mocks deployed by cofhe-hardhat-plugin. This is the
//  only place the encryption stack is tested under the unit suite — the
//  B4 hardhat suite stays plaintext-only on purpose (see B4 prompt).
//
//  Scope is intentionally narrow: one trader, one pair, one order. The
//  goal is to catch shape/ABI regressions in:
//    • @cofhe/sdk initialization with a Hardhat signer
//    • Encryptable.uint128 → InEuint128 wire format
//    • DarkPoolDEX.submitOrder happy path (BUY side)
//    • FHERC20Wrapper operator+wrap+confidentialTransferFrom plumbing
//
//  Full matching/settlement integration belongs in the matcher's
//  testcontainers-based integration suite (see matcher/vitest.integration).
// ============================================================================

import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { Encryptable, FheTypes, MOCKS_ZK_VERIFIER_SIGNER_PRIVATE_KEY } from "@cofhe/sdk";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/node";
import { hardhat as cofheHardhat } from "@cofhe/sdk/chains";
import { createPublicClient, createWalletClient, custom } from "viem";
import { hardhat as viemHardhat } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// Encryption can take a few seconds the first time the tfhe wasm warms up.
const ENCRYPT_TIMEOUT_MS = 120_000;
const HARDHAT_ALICE_PRIVATE_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const COFHE_HARDHAT_PLUGIN_MOCK_ZK_VERIFIER = "0x0000000000000000000000000000000000000100";
const SDK_MOCK_ZK_VERIFIER = "0x0000000000000000000000000000000000005001";
const MOCK_ZK_VERIFIER_ABI = [
  {
    type: "function",
    name: "zkVerifyCalcCtHashesPacked",
    stateMutability: "view",
    inputs: [
      { name: "values", type: "uint256[]" },
      { name: "utypes", type: "uint8[]" },
      { name: "user", type: "address" },
      { name: "securityZone", type: "uint8" },
      { name: "chainId", type: "uint256" },
    ],
    outputs: [{ name: "ctHashes", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "insertPackedCtHashes",
    stateMutability: "nonpayable",
    inputs: [
      { name: "ctHashes", type: "uint256[]" },
      { name: "values", type: "uint256[]" },
    ],
    outputs: [],
  },
] as const;

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

    // ─── Encrypt the four private-side legs via @cofhe/sdk ────────────────
    // Encryptable.uint128 builds the (data, utype, securityZone) tuple that
    // encryptInputs then turns into InEuint128 calldata structs the
    // DarkPoolDEX entrypoint expects.
    const [encBaseDeposit, encQuoteDeposit, encBaseRequest, encQuoteRequest] = await encryptInputsForAlice([
      deposit,
      0n,
      0n,
      request,
    ]);
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

    const [encBaseDeposit, encQuoteDeposit, encBaseRequest, encQuoteRequest] = await encryptInputsForAlice([
      deposit,
      0n,
      0n,
      request,
    ]);

    await expect(
      dex.connect(alice).submitOrder(0, encBaseDeposit, encQuoteDeposit, encBaseRequest, encQuoteRequest, 0),
    ).to.be.revertedWithCustomError(eUSDC, "InsufficientAllowanceOrOperator");
  });
});

async function encryptInputsForAlice(values: bigint[]) {
  const transport = custom(hre.network.provider as any);
  const publicClient = createPublicClient({ chain: viemHardhat, transport });
  const aliceAccount = privateKeyToAccount(HARDHAT_ALICE_PRIVATE_KEY);
  const walletClient = createWalletClient({ chain: viemHardhat, transport, account: aliceAccount });
  const zkvWalletClient = createWalletClient({
    chain: viemHardhat,
    transport,
    account: privateKeyToAccount(MOCKS_ZK_VERIFIER_SIGNER_PRIVATE_KEY),
  });
  await ensureSdkMockVerifierAddress(publicClient);

  const cofhe = createCofheClient(createCofheConfig({
    supportedChains: [cofheHardhat],
    fheKeyStorage: null,
    mocks: { decryptDelay: 0, encryptDelay: 0 },
    _internal: { zkvWalletClient: zkvWalletClient as any },
  }));

  await cofhe.connect(publicClient as any, walletClient as any);

  // This intentionally mirrors the browser path in frontend/lib/cofhe.tsx:
  // values -> Encryptable.uint128 -> client.encryptInputs(...).execute().
  const encrypted = await cofhe
    .encryptInputs(values.map((value) => Encryptable.uint128(value)))
    .execute();

  // @cofhe/sdk mock mode writes plaintext test handles to its own mock verifier
  // address. The pinned cofhe-hardhat-plugin used by these contracts keeps the
  // verifier at 0x...0100, so mirror the same handles into the plugin store.
  // The encrypted calldata and signatures still come from @cofhe/sdk.
  await walletClient.writeContract({
    address: COFHE_HARDHAT_PLUGIN_MOCK_ZK_VERIFIER,
    abi: MOCK_ZK_VERIFIER_ABI,
    functionName: "insertPackedCtHashes",
    args: [encrypted.map((item) => item.ctHash), values],
    chain: viemHardhat,
    account: aliceAccount,
  });

  return encrypted;
}

async function ensureSdkMockVerifierAddress(publicClient: ReturnType<typeof createPublicClient>) {
  const sdkCode = await publicClient.getCode({ address: SDK_MOCK_ZK_VERIFIER });
  if (sdkCode && sdkCode !== "0x") return;

  const pluginCode = await publicClient.getCode({ address: COFHE_HARDHAT_PLUGIN_MOCK_ZK_VERIFIER });
  if (!pluginCode || pluginCode === "0x") {
    throw new Error(`CoFHE plugin MockZkVerifier missing at ${COFHE_HARDHAT_PLUGIN_MOCK_ZK_VERIFIER}`);
  }

  await hre.network.provider.request({
    method: "hardhat_setCode",
    params: [SDK_MOCK_ZK_VERIFIER, pluginCode],
  });
}
