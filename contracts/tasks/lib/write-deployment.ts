import fs from "node:fs/promises";
import path from "node:path";

export async function writeDeployment(network: string, deployment: any) {
  const filename = network === "hardhat" || network === "localhost" ? ".deployed-local.json" : `.deployed-${network}.json`;
  const out = path.resolve(__dirname, "../../../shared/addresses", filename);
  await fs.writeFile(out, JSON.stringify(deployment, null, 2));
  console.log(`wrote ${out}`);
}
