import { expect } from "chai";
import { ethers } from "hardhat";

describe("TestERC20", () => {
  it("mints to recipient and tracks supply", async () => {
    const [, alice] = await ethers.getSigners();
    const TestERC20 = await ethers.getContractFactory("TestERC20");
    const token = await TestERC20.deploy("Mock USDC", "mUSDC", 6);
    await token.waitForDeployment();
    await token.mint(alice.address, 1_000_000n * 10n ** 6n);
    expect(await token.balanceOf(alice.address)).to.equal(1_000_000n * 10n ** 6n);
    expect(await token.totalSupply()).to.equal(1_000_000n * 10n ** 6n);
    expect(await token.decimals()).to.equal(6);
  });

  it("emits Transfer event on mint", async () => {
    const [, alice] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("TestERC20")).deploy("X", "X", 18);
    await expect(token.mint(alice.address, 100n)).to.emit(token, "Transfer").withArgs(ethers.ZeroAddress, alice.address, 100n);
  });
});
