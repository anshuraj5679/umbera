import fs from 'fs';
import path from 'path';

function loadEnv() {
  const envPath = 'd:/midnight/.env';
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
        env[trimmed.slice(0, eqIdx).trim()] = val;
      }
    }
  }
  return env;
}

const env = loadEnv();
const blockfrostKey = env.BLOCKFROST_PROJECT_ID;
const indexerUrl = env.MIDNIGHT_INDEXER_URL || 'https://midnight-preview.blockfrost.io/api/v0';
const contractAddress = '3813ef0145c64237d34584141af8e11b4f4b3a8b29e4ab864fec4aed31880934';
const extHash = '0x3d9d385a44df133b2c953cc489f60a6aba6fc702836a03031ed3b4167e78d21a';

console.log(`Watching for confirmation of contract: ${contractAddress}`);
console.log(`Extrinsic hash: ${extHash}\n`);

const q = `query {
  block { height hash timestamp }
  contractAction(address: "${contractAddress}") {
    address
    contractState
    transaction {
      id
      hash
      block {
        height
        hash
      }
    }
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
    const action = d.data?.contractAction;
    console.log(`[Poll ${i+1}/30] Block: ${d.data?.block?.height} | Contract Action: ${action ? 'FOUND!' : 'pending...'}`);
    if (action) {
      console.log('\n===============================================================');
      console.log('       NEW UMBRA CONTRACT CONFIRMED ON MIDNIGHT PREVIEW!      ');
      console.log('===============================================================');
      console.log(JSON.stringify(action, null, 2));
      console.log('===============================================================\n');
      confirmed = true;
      break;
    }
  } catch (e) {
    console.warn('Poll error:', e.message);
  }
  await new Promise(r => setTimeout(r, 6000));
}

if (!confirmed) {
  // Check via node RPC midnight_contractState
  console.log('Checking via node RPC midnight_contractState...');
  const rRpc = await fetch(env.MIDNIGHT_NODE_URL, {
    method: 'POST',
    headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'midnight_contractState',
      params: [contractAddress]
    })
  });
  console.log('midnight_contractState result:', await rRpc.json());
}
