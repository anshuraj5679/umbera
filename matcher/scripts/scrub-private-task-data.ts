import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { create as createDb } from "../src/db/client.js";
import { loadConfig } from "../src/config.js";
import { countPrivateTaskResidue, scrubPrivateTaskResidue } from "../src/privacy/scrub.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
loadDotenv({ path: path.join(repoRoot, ".env") });

async function main() {
  const execute = process.argv.includes("--execute");
  const cfg = await loadConfig();
  const db = createDb(cfg.RDS_URL);

  if (!execute) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      residue: await countPrivateTaskResidue(db),
    }, null, 2));
    return;
  }

  console.log(JSON.stringify({
    ok: true,
    dryRun: false,
    scrub: await scrubPrivateTaskResidue(db),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
