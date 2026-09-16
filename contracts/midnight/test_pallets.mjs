import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import * as scale from 'scale-ts';

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
const nodeBaseUrl = env.MIDNIGHT_NODE_URL || 'https://rpc.midnight-preview.blockfrost.io';

const bytes = new Uint8Array(fs.readFileSync('d:/midnight/contracts/midnight/proven_deploy_tx.bin'));
const provenTx = ledger.Transaction.deserialize('signature', 'proof', 'pre-binding', bytes);
const boundTx = provenTx.bind();
const rawTxBytes = Buffer.from(boundTx.serialize());
console.log('rawTxBytes length:', rawTxBytes.length);

// Test Pallet 4 vs Pallet 5
// In Substrate SCALE:
// Vec<u8> = compact(len) + rawBytes
// But wait! Does it expect ASCII hex string or raw binary?
// Let's test both!

async function testPallet(palletIdx, methodIdx, payload, desc) {
  console.log(`\n=== Testing Pallet ${palletIdx}, Method ${methodIdx}: ${desc} ===`);
  const compactLen = scale.compact.enc(payload.length);
  const vecU8 = Buffer.concat([Buffer.from(compactLen), payload]);
  
  const txVersion = Buffer.from([0x04]); // unsigned v4
  const palletBuf = Buffer.from([palletIdx]);
  const methodBuf = Buffer.from([methodIdx]);
  
  const callData = Buffer.concat([txVersion, palletBuf, methodBuf, vecU8]);
  const totalLen = Buffer.from(scale.compact.enc(callData.length));
  const fullExtrinsic = Buffer.concat([totalLen, callData]);
  const extHex = '0x' + fullExtrinsic.toString('hex');
  console.log('Extrinsic hex length:', extHex.length);
  
  const res = await fetch(nodeBaseUrl, {
    method: 'POST',
    headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'author_submitExtrinsic', params: [extHex] })
  });
  const data = await res.json();
  console.log('Result:', JSON.stringify(data));
}

// 1. Pallet 4, Method 0 with raw binary bytes
await testPallet(4, 0, rawTxBytes, 'Pallet 4 (Midnight) with raw binary');

// 2. Pallet 4, Method 0 with hex ascii string
const hexAscii = Buffer.from(rawTxBytes.toString('hex'), 'utf8');
await testPallet(4, 0, hexAscii, 'Pallet 4 (Midnight) with hex ascii');

// 3. Pallet 5, Method 0 with raw binary bytes
await testPallet(5, 0, rawTxBytes, 'Pallet 5 (MidnightSystem) with raw binary');

// 4. Pallet 5, Method 0 with hex ascii string
await testPallet(5, 0, hexAscii, 'Pallet 5 (MidnightSystem) with hex ascii');
