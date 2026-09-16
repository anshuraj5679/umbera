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
const blockfrostKey = env.BLOCKFROST_PROJECT_ID;
const indexerUrl = env.MIDNIGHT_INDEXER_URL || 'https://midnight-preview.blockfrost.io/api/v0';
const contractAddress = env.MIDNIGHT_CONTRACT_ADDRESS || '6a081726fa0a8114f197df795f487146527189fcd38446e218f2b8d80f0cf7ee';

console.log(`Watching for on-chain confirmation of contract: ${contractAddress}`);

const q = `query {
  block { height hash }
  contractAction(contractAddress: "${contractAddress}") {
    contractAddress
    transactionId
    blockHeight
    blockHash
  }
}`;

let confirmed = false;
for (let i = 0; i < 30; i++) {
  try {
    const r = await fetch(indexerUrl, {
      method: 'POST',
      headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q })
    });
    const d = await r.json();
    console.log(`[Poll ${i+1}/30] Current block: ${d.data?.block?.height}, Contract actions:`, d.data?.contractAction?.length || 0);
    if (d.data?.contractAction && d.data.contractAction.length > 0) {
      console.log('\n[CONFIRMED ON-CHAIN!]');
      console.log(JSON.stringify(d.data.contractAction, null, 2));
      confirmed = true;
      break;
    }
  } catch (e) {
    console.warn('Poll error:', e.message);
  }
  await new Promise(r => setTimeout(r, 6000)); // 6s block time
}

if (!confirmed) {
  console.log('Transaction is in block pool or propagating. Checking contract state via node RPC...');
  const r = await fetch(env.MIDNIGHT_NODE_URL, {
    method: 'POST',
    headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'midnight_contractState',
      params: [contractAddress]
    })
  });
  console.log('midnight_contractState:', await r.json());
}
