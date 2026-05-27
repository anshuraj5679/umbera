import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

async function deployDexFixture() {
  const [admin, matcher, feeCollector, alice, bob] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("TestERC20");
  const usdc = await Token.deploy("USDC", "USDC", 6);
  const weth = await Token.deploy("WETH", "WETH", 18);
  const Wrapper = await ethers.getContractFactory("FHERC20Wrapper");
  const eUSDC = await Wrapper.deploy(await usdc.getAddress(), "eUSDC", "eUSDC", 6);
  const eWETH = await Wrapper.deploy(await weth.getAddress(), "eWETH", "eWETH", 18);
  const Dex = await ethers.getContractFactory("DarkPoolDEX");
  const dex = await Dex.deploy(admin.address, matcher.address, feeCollector.address);
  await dex.connect(admin).registerPair(await eUSDC.getAddress(), await eWETH.getAddress(), 10n * 10n ** 6n);
  return { admin, matcher, feeCollector, alice, bob, usdc, weth, eUSDC, eWETH, dex };
}

describe("DarkPoolDEX (plaintext paths)", () => {
  describe("batch lifecycle", () => {
    it("closeBatch_rotatesBatch", async () => {
      const { dex } = await loadFixture(deployDexFixture);
      await time.increase(5 * 60 + 1);
      await expect(dex.closeBatch()).to.emit(dex, "BatchClosed").and.to.emit(dex, "BatchOpened");
      const cur = await dex.getCurrentBatch();
      expect(cur.batchId).to.equal(1n);
    });

    it("closeBatch_revertsWhenStillOpen", async () => {
      const { dex } = await loadFixture(deployDexFixture);
      await expect(dex.closeBatch()).to.be.revertedWithCustomError(dex, "BatchStillOpen");
    });
  });

  describe("access control matrix", () => {
    it("nonAdmin_cannot_pause", async () => {
      const { alice, dex } = await loadFixture(deployDexFixture);
      await expect(dex.connect(alice).pause()).to.be.revertedWithCustomError(dex, "Unauthorized");
    });
    it("nonAdmin_cannot_setMatcher", async () => {
      const { alice, dex } = await loadFixture(deployDexFixture);
      await expect(dex.connect(alice).setMatcher(alice.address)).to.be.revertedWithCustomError(dex, "Unauthorized");
    });
    it("nonMatcher_cannot_publishMatches", async () => {
      const { alice, dex } = await loadFixture(deployDexFixture);
      await expect(dex.connect(alice).publishMatches([], [], [], [], [], [])).to.be.revertedWithCustomError(dex, "Unauthorized");
    });
  });

  describe("account commitments", () => {
    const accountCommitment = "0x1111111111111111111111111111111111111111111111111111111111111111";

    it("registerSessionAccount_authorizes_sender_without_owner_address", async () => {
      const { alice, dex } = await loadFixture(deployDexFixture);

      await expect(dex.connect(alice).registerSessionAccount(accountCommitment))
        .to.emit(dex, "AccountRegistered")
        .withArgs(accountCommitment, alice.address)
        .and.to.emit(dex, "SessionAuthorized")
        .withArgs(accountCommitment, alice.address);

      expect(await dex.accountRegistered(accountCommitment)).to.equal(true);
      expect(await dex.sessionAuthorized(accountCommitment, alice.address)).to.equal(true);
    });

    it("authorizeSession_requires_existing_authorized_session", async () => {
      const { alice, bob, dex } = await loadFixture(deployDexFixture);

      await expect(dex.connect(bob).authorizeSession(accountCommitment, alice.address))
        .to.be.revertedWithCustomError(dex, "SessionNotAuthorized");
    });

    it("authorized_session_can_authorize_and_revoke_another_session", async () => {
      const { alice, bob, dex } = await loadFixture(deployDexFixture);

      await dex.connect(alice).registerSessionAccount(accountCommitment);
      await expect(dex.connect(alice).authorizeSession(accountCommitment, bob.address))
        .to.emit(dex, "SessionAuthorized")
        .withArgs(accountCommitment, bob.address);
      expect(await dex.sessionAuthorized(accountCommitment, bob.address)).to.equal(true);

      await expect(dex.connect(alice).revokeSession(accountCommitment, bob.address))
        .to.emit(dex, "SessionRevoked")
        .withArgs(accountCommitment, bob.address);
      expect(await dex.sessionAuthorized(accountCommitment, bob.address)).to.equal(false);
    });

    it("submitOrderForAccount_rejects_unauthorized_session_before_encryption", async () => {
      const { alice, dex } = await loadFixture(deployDexFixture);
      const emptyInput = { ctHash: 0, securityZone: 0, utype: 0, signature: "0x" };

      await expect(dex.connect(alice).submitOrderForAccount(
        accountCommitment,
        0,
        emptyInput,
        emptyInput,
        emptyInput,
        emptyInput,
        0,
      )).to.be.revertedWithCustomError(dex, "SessionNotAuthorized");
    });
  });

  describe("admin params", () => {
    it("feeRate_aboveMax_reverts", async () => {
      const { admin, dex } = await loadFixture(deployDexFixture);
      await expect(dex.connect(admin).setFeeRate(101)).to.be.revertedWithCustomError(dex, "FeeTooHigh");
    });

    it("feeRate_belowMax_succeeds", async () => {
      const { admin, dex } = await loadFixture(deployDexFixture);
      await dex.connect(admin).setFeeRate(50);
      expect(await dex.feeBps()).to.equal(50n);
    });

    it("admin_transfer_two_step", async () => {
      const { admin, alice, dex } = await loadFixture(deployDexFixture);
      await dex.connect(admin).initiateAdminTransfer(alice.address);
      expect(await dex.pendingAdmin()).to.equal(alice.address);
      await dex.connect(alice).acceptAdminTransfer();
      expect(await dex.admin()).to.equal(alice.address);
    });

    it("admin_transfer_nonPending_reverts", async () => {
      const { admin, alice, bob, dex } = await loadFixture(deployDexFixture);
      await dex.connect(admin).initiateAdminTransfer(alice.address);
      await expect(dex.connect(bob).acceptAdminTransfer()).to.be.revertedWithCustomError(dex, "Unauthorized");
    });

    it("setBatchDuration_outOfRange_reverts", async () => {
      const { admin, dex } = await loadFixture(deployDexFixture);
      await expect(dex.connect(admin).setBatchDuration(30)).to.be.revertedWithCustomError(dex, "InvalidDuration");
      await expect(dex.connect(admin).setBatchDuration(7200)).to.be.revertedWithCustomError(dex, "InvalidDuration");
    });

    it("setDisputeWindow_outOfRange_reverts", async () => {
      const { admin, dex } = await loadFixture(deployDexFixture);
      await expect(dex.connect(admin).setDisputeWindow(120)).to.be.revertedWithCustomError(dex, "InvalidDuration");
      await expect(dex.connect(admin).setDisputeWindow(8000)).to.be.revertedWithCustomError(dex, "InvalidDuration");
    });
  });

  describe("pair management", () => {
    it("registerPair_emits", async () => {
      const { admin, eUSDC, eWETH, dex } = await loadFixture(deployDexFixture);
      await expect(dex.connect(admin).registerPair(await eUSDC.getAddress(), await eWETH.getAddress(), 1))
        .to.emit(dex, "PairRegistered");
    });

    it("togglePair_changesActive", async () => {
      const { admin, dex } = await loadFixture(deployDexFixture);
      await dex.connect(admin).togglePair(0, false);
      const pair = await dex.pairs(0);
      expect(pair.active).to.equal(false);
    });

    it("togglePair_invalidPair_reverts", async () => {
      const { admin, dex } = await loadFixture(deployDexFixture);
      await expect(dex.connect(admin).togglePair(99, true)).to.be.revertedWithCustomError(dex, "InvalidPair");
    });
  });

  describe("pause", () => {
    it("pause_emits_event", async () => {
      const { admin, dex } = await loadFixture(deployDexFixture);
      await expect(dex.connect(admin).pause()).to.emit(dex, "Paused");
      expect(await dex.paused()).to.equal(true);
    });

    it("unpause_emits_event", async () => {
      const { admin, dex } = await loadFixture(deployDexFixture);
      await dex.connect(admin).pause();
      await expect(dex.connect(admin).unpause()).to.emit(dex, "Unpaused");
      expect(await dex.paused()).to.equal(false);
    });
  });

  describe("dispute / match plaintext branches", () => {
    it("settleMatch_nonexistent_reverts", async () => {
      const { dex } = await loadFixture(deployDexFixture);
      // Nonexistent match (id 9999) has default status=PENDING and publishedAt=0.
      // The dispute-window check passes (0 + 30min < now), then it hits ZeroAddress
      // when accessing pairs[0].baseToken which is address(0) for an unregistered match.
      // Any revert from the contract is acceptable; confirm it does not succeed.
      await expect(dex.settleMatch(9999)).to.be.reverted;
    });

    it("disputeMatch_nonexistent_reverts", async () => {
      const { dex, alice } = await loadFixture(deployDexFixture);
      // Nonexistent match: status=PENDING passes first check, but publishedAt=0
      // means the dispute window (30 min) has already expired → DisputeWindowExpired.
      await expect(dex.connect(alice).disputeMatch(9999)).to.be.revertedWithCustomError(dex, "DisputeWindowExpired");
    });

    it("cancelOrder_nonexistent_reverts", async () => {
      const { dex, alice } = await loadFixture(deployDexFixture);
      await expect(dex.connect(alice).cancelOrder(9999)).to.be.revertedWithCustomError(dex, "NotYourOrder");
    });
  });

  describe("getCurrentBatch view", () => {
    it("reports_open_batch", async () => {
      const { dex } = await loadFixture(deployDexFixture);
      const cur = await dex.getCurrentBatch();
      expect(cur.isOpen).to.equal(true);
      expect(cur.orderCount).to.equal(0n);
    });
  });
});
