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
const rawTxBytes = boundTx.serialize();
console.log('rawTxBytes length:', rawTxBytes.length);

// Construct Option A: Raw binary bytes as Vec<u8>
// Call = pallet (u8: 5) + method (u8: 0) + Vec<u8> (compact_len + rawTxBytes)
const encodedVec = scale.Vector(scale.u8).enc(rawTxBytes);
const encodedTxVersion = scale.u8.enc(4);
const encodedPallet = scale.u8.enc(5);
const encodedMethod = scale.u8.enc(0);

const callData = Buffer.concat([
  Buffer.from(encodedTxVersion),
  Buffer.from(encodedPallet),
  Buffer.from(encodedMethod),
  Buffer.from(encodedVec)
]);
const encodedTotalLength = scale.compact.enc(callData.length);
const fullExtrinsic = Buffer.concat([Buffer.from(encodedTotalLength), callData]);
const extrinsicHex = '0x' + fullExtrinsic.toString('hex');
console.log('Raw binary extrinsic hex length:', extrinsicHex.length);
console.log('First 60 chars of extrinsicHex:', extrinsicHex.slice(0, 60));

console.log('\nSubmitting to node author_submitExtrinsic...');
const res = await fetch(nodeBaseUrl, {
  method: 'POST',
  headers: {
    'project_id': blockfrostKey,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'author_submitExtrinsic',
    params: [extrinsicHex]
  })
});
const data = await res.json();
console.log('\nRPC RESPONSE:', JSON.stringify(data, null, 2));
