import { expect } from "chai";
import { ethers } from "hardhat";

describe("FHERC20Wrapper", () => {
  async function deploy() {
    const [, alice, bob] = await ethers.getSigners();
    const underlying = await (await ethers.getContractFactory("TestERC20")).deploy("X", "X", 18);
    await underlying.mint(alice.address, 1000n * 10n ** 18n);
    const Wrapper = await ethers.getContractFactory("FHERC20Wrapper");
    const w = await Wrapper.deploy(await underlying.getAddress(), "eX", "eX", 18);
    return { alice, bob, underlying, w };
  }

  it("wraps underlying and credits encrypted balance", async () => {
    const { alice, underlying, w } = await deploy();
    await underlying.connect(alice).approve(await w.getAddress(), 100n);
    await w.connect(alice).wrap(100n);
    expect(await underlying.balanceOf(await w.getAddress())).to.equal(100n);
  });

  it("setOperator deadline blocks expired transfers", async () => {
    const { alice, bob, w } = await deploy();
    const past = (await ethers.provider.getBlock("latest"))!.timestamp - 1;
    await w.connect(alice).setOperator(bob.address, past);
    expect(await w.isOperator(alice.address, bob.address)).to.equal(false);
  });
});
