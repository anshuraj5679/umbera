import fs from 'fs';
import * as scale from 'scale-ts';

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
const nodeBaseUrl = env.MIDNIGHT_NODE_URL;

// Let's test calling TaggedTransactionQueue_validate_transaction with Extrinsic 3 from block 884520
const rHash = await fetch(nodeBaseUrl, {
  method: 'POST',
  headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chain_getBlockHash', params: [884520] })
});
const dHash = await rHash.json();
const blockHash = dHash.result;

const rBlock = await fetch(nodeBaseUrl, {
  method: 'POST',
  headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chain_getBlock', params: [blockHash] })
});
const dBlock = await rBlock.json();
const ext3Hex = dBlock.result.block.extrinsics[3].replace(/^0x/, '');
const ext3Bytes = Buffer.from(ext3Hex, 'hex');

// TaggedTransactionQueue_validate_transaction parameters:
// TransactionSource: u8 (1 = External, 2 = InBlock)
// Extrinsic: Vec<u8> or raw extrinsic bytes
// block_hash: Hash (32 bytes)
console.log('Testing validate_transaction...');

// Try format 1: source (1 byte) + extrinsic bytes + block_hash (32 bytes)
const parentHash = dBlock.result.block.header.parentHash.replace(/^0x/, '');
const param1 = Buffer.concat([
  Buffer.from([1]), // TransactionSource::External
  ext3Bytes,
  Buffer.from(parentHash, 'hex')
]);

const res1 = await fetch(nodeBaseUrl, {
  method: 'POST',
  headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'state_call',
    params: ['TaggedTransactionQueue_validate_transaction', '0x' + param1.toString('hex'), '0x' + parentHash]
  })
});
const data1 = await res1.json();
console.log('Result at parentHash:', JSON.stringify(data1, null, 2));
