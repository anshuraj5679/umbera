import fs from 'fs';

function loadEnv() {
  const lines = fs.readFileSync('d:/midnight/.env', 'utf8').split('\n');
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
const url = env.MIDNIGHT_NODE_URL;
const key = env.BLOCKFROST_PROJECT_ID;

async function callRpc(method, params = []) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'project_id': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  return await r.json();
}

console.log('midnight_ledgerVersion:', await callRpc('midnight_ledgerVersion'));
console.log('midnight_apiVersions:', await callRpc('midnight_apiVersions'));
console.log('midnight_ledgerStateRoot:', await callRpc('midnight_ledgerStateRoot'));
console.log('midnight_zswapStateRoot:', await callRpc('midnight_zswapStateRoot'));
