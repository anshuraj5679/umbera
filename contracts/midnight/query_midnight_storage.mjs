import fs from 'fs';

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
const nodeBaseUrl = env.MIDNIGHT_NODE_URL;
const blockfrostKey = env.BLOCKFROST_PROJECT_ID;

// Query all storage keys under pallet Midnight (xxhash128("Midnight"))
import { xxhashAsHex } from 'file:///D:/midnight/frontend/node_modules/.pnpm/node_modules/@polkadot/util-crypto/xxhash/asHex.js';

const pHash = xxhashAsHex('Midnight', 128);
console.log('Pallet prefix:', pHash);

const rKeys = await fetch(nodeBaseUrl, {
  method: 'POST',
  headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'state_getKeys', params: [pHash] })
});
const dKeys = await rKeys.json();
console.log('Midnight storage keys count:', dKeys.result?.length);
for (const k of dKeys.result || []) {
  const rVal = await fetch(nodeBaseUrl, {
    method: 'POST',
    headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'state_getStorage', params: [k] })
  });
  const dVal = await rVal.json();
  const hex = dVal.result?.replace('0x', '') || '';
  const buf = Buffer.from(hex, 'hex');
  console.log(`Key: ${k}`);
  console.log(`  Length: ${buf.length} bytes`);
  console.log(`  Ascii:  ${buf.slice(0, 60).toString('latin1').replace(/[^a-zA-Z0-9_: -]/g, '.')}`);
}
