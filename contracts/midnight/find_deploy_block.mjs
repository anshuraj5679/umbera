import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

function loadEnv() {
  const envPath = path.join(REPO_ROOT, '.env');
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        env[trimmed.slice(0, eqIdx).trim()] = val;
      }
    }
  }
  return env;
}

const env = loadEnv();
const nodeBaseUrl = env.MIDNIGHT_NODE_URL;
const blockfrostKey = env.BLOCKFROST_PROJECT_ID;

const TX_HASH = '0xdbf1700efd82d7c4bf2c558e383d10396f920ad4aa7a7dd88d5cfae06bae9b86';

console.log('Searching for block of extrinsic:', TX_HASH);

// Query indexer for contract actions of the deployed contract
const indexerUrl = env.MIDNIGHT_INDEXER_URL;
const q = `query {
  contractAction(contractAddress: "${env.MIDNIGHT_CONTRACT_ADDRESS}") {
    contractAddress
    transactionId
    blockHeight
    blockHash
  }
}`;

const r = await fetch(indexerUrl, {
  method: 'POST',
  headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: q })
});
const d = await r.json();
console.log('Contract action result:', JSON.stringify(d, null, 2));

const blockHeight = d.data?.contractAction?.[0]?.blockHeight;
const blockHash = d.data?.contractAction?.[0]?.blockHash;
console.log('Block height:', blockHeight, 'Block hash:', blockHash);
