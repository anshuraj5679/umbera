import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bip39 from 'bip39';
import { HDKey } from 'file:///D:/midnight/frontend/node_modules/.pnpm/node_modules/@scure/bip32/lib/esm/index.js';
import * as ledger from '@midnight-ntwrk/ledger-v8';

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
const mnemonic = env.MIDNIGHT_DEPLOYER_SEED.trim();
const seedBytes = bip39.mnemonicToSeedSync(mnemonic);
const root = HDKey.fromMasterSeed(seedBytes);
const child2 = root.derive("m/44'/2400'/0'/2/0");
const dustSecretKey = ledger.DustSecretKey.fromSeed(child2.privateKey);

const indexerUrl = env.MIDNIGHT_INDEXER_URL || 'https://midnight-preview.blockfrost.io/api/v0';
const blockfrostKey = env.BLOCKFROST_PROJECT_ID;
const lp = ledger.LedgerParameters.initialParameters();

async function checkEndIndex(field, start, end) {
  const q = `query { ${field}(startIndex: ${start}, endIndex: ${end}) { startIndex endIndex } }`;
  const r = await fetch(indexerUrl, {
    method: 'POST',
    headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q })
  });
  const d = await r.json();
  return d.data && d.data[field] && !d.errors;
}

async function findMaxEnd(field, start, min, max) {
  let low = min;
  let high = max;
  let best = min;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const ok = await checkEndIndex(field, start, mid);
    if (ok) { best = mid; low = mid + 1; }
    else { high = mid - 1; }
  }
  return best;
}

const tipGen = await findMaxEnd('dustGenerationMerkleTreeUpdate', 13108, 13108, 32767);
const tipComm = await findMaxEnd('dustCommitmentMerkleTreeUpdate', 115346, 115346, 131071);
console.log(`Current Tips: Gen=${tipGen}, Comm=${tipComm}`);

const q = `query {
  gen0: dustGenerationMerkleTreeUpdate(startIndex: 0, endIndex: 12282) { update }
  comm0: dustCommitmentMerkleTreeUpdate(startIndex: 0, endIndex: 91305) { update }
  gen1: dustGenerationMerkleTreeUpdate(startIndex: 12284, endIndex: 13106) { update }
  comm1: dustCommitmentMerkleTreeUpdate(startIndex: 91307, endIndex: 115343) { update }
  gen2: dustGenerationMerkleTreeUpdate(startIndex: 13108, endIndex: ${tipGen}) { update }
  comm2: dustCommitmentMerkleTreeUpdate(startIndex: 115346, endIndex: ${tipComm}) { update }
}`;

const r = await fetch(indexerUrl, {
  method: 'POST',
  headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: q })
});
const d = await r.json();

let localState = new ledger.DustLocalState(lp.dust);

// 1. Initial collapsed updates
localState = localState.applyGenerationCollapsedUpdate(
  ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(d.data.gen0.update, 'hex'))
);
localState = localState.applyCommitmentCollapsedUpdate(
  ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(d.data.comm0.update, 'hex'))
);

// 2. Initial funding event (mtIndex: 91306)
const FUNDING_EVENT_HEX = '6d69646e696768743a6576656e745b76395d3a0400c103cc01793be7ee36a6c94b0aa951c26fc95a6f4567b4f40691819afc555d00c85c00000100050fffaf68efc3920a735ce2e6097a85648610ab426b50e26cd44286cf0cde9c9da05a00da5f6015580673b703f51df0fc04830c92098e354ccd5ccaf1cf6fa35fabf7088707239d6a012300034aa39b6a98ed47b7e048b309aec26fdd52d3cf18a7d4e3fd463d35f6d215e097e3083906aa9205000700f2052a01735ce2e6097a85648610ab426b50e26cd44286cf0cde9c9da05a00da5f6015580698ed47b7e048b309aec26fdd52d3cf18a7d4e3fd463d35f6d215e097e308390613ffffffffffffffffedbf0362a39b6a';
localState = localState.replayRawEvents(dustSecretKey, Buffer.from(FUNDING_EVENT_HEX, 'hex')).state;

// 3. Updates between funding and first deployment
localState = localState.applyGenerationCollapsedUpdate(
  ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(d.data.gen1.update, 'hex'))
);
localState = localState.applyCommitmentCollapsedUpdate(
  ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(d.data.comm1.update, 'hex'))
);

// 4. First deploy change event (spent 91306, created 115344)
const DEPLOY1_CHANGE_HEX = '6d69646e696768743a6576656e745b76395d3a0400f5017d2f1bd3cd79a1d31b4ff596fc1b96e6189cb55875aa3b5b22683e3fa8c2d9c30000020007734c57afc7586a5c53999a8f8d3d4ba390a23c970910cacbeb2a2f4d4de0be645f420a070073377cc4bc4d2488dc275c6a37d6d31486f5f426198e943e88d88d4bb1ffd5ef3c0f07bda82a67930e037ffba96a037afba96a';
const deploy1Res = localState.replayRawEvents(dustSecretKey, Buffer.from(DEPLOY1_CHANGE_HEX, 'hex'));
localState = deploy1Res.state;

// 5. Updates between deploy 1 and current tip
if (d.data.gen2?.update) {
  localState = localState.applyGenerationCollapsedUpdate(
    ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(d.data.gen2.update, 'hex'))
  );
}
if (d.data.comm2?.update) {
  localState = localState.applyCommitmentCollapsedUpdate(
    ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(d.data.comm2.update, 'hex'))
  );
}

console.log('UTXOs count after deploy 1 change replay:', localState.utxos.length);
for (const u of localState.utxos) {
  console.log(`  UTXO mtIndex: ${u.mtIndex}, value: ${u.value}`);
}
console.log('Wallet Balance:', localState.walletBalance(new Date()));
