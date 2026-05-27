import fs from "node:fs/promises";
import path from "node:path";

const ARTIFACTS = path.resolve(__dirname, "../artifacts/src");
const OUT = path.resolve(__dirname, "../../shared/abi");

const CONTRACTS = ["DarkPoolDEX", "FHERC20Wrapper", "TestERC20"];

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  for (const name of CONTRACTS) {
    const artifactPath = path.join(ARTIFACTS, `${name}.sol`, `${name}.json`);
    try {
      const raw = await fs.readFile(artifactPath, "utf8");
      const { abi, bytecode } = JSON.parse(raw);
      await fs.writeFile(
        path.join(OUT, `${name}.json`),
        JSON.stringify({ abi, bytecode }, null, 2),
      );
      console.log(`exported ${name}`);
    } catch (e) {
      console.warn(`skip ${name}: ${(e as Error).message}`);
    }
  }
}
main();
