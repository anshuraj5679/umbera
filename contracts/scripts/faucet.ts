import { ethers } from "hardhat";
import dep from "../../shared/addresses/.deployed-arbSepolia.json";

const TO = process.env.FAUCET_TO ?? "0x060613A360fFe3213818c022b404E5AA9D755611";

const ABI = [
  "function mint(address to, uint256 amount) external",
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("from:", signer.address, "→ to:", TO);

  const plan = [
    { addr: dep.underlying.mUSDC, amount: 1_000_000n * 10n ** 6n },
    { addr: dep.underlying.mWETH, amount: 1_000n * 10n ** 18n },
    { addr: dep.underlying.mWBTC, amount: 10n * 10n ** 8n },
  ];

  for (const { addr, amount } of plan) {
    const tok = new ethers.Contract(addr, ABI, signer);
    const sym = await tok.symbol();
    const tx = await tok.mint(TO, amount);
    const rcpt = await tx.wait();
    const bal = await tok.balanceOf(TO);
    console.log(`  ${sym}: minted ${amount.toString()} (tx ${rcpt.hash}); balance ${bal.toString()}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
