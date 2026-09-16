import fs from 'fs';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import bip39 from 'bip39';
import { HDKey } from 'file:///D:/midnight/frontend/node_modules/.pnpm/node_modules/@scure/bip32/lib/esm/index.js';

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
const lp = ledger.LedgerParameters.initialParameters();
const mnemonic = env.MIDNIGHT_DEPLOYER_SEED.trim();
const seedBytes = bip39.mnemonicToSeedSync(mnemonic);
const root = HDKey.fromMasterSeed(seedBytes);
const child2 = root.derive("m/44'/2400'/0'/2/0");
const dustSecretKey = ledger.DustSecretKey.fromSeed(child2.privateKey);

const indexerUrl = env.MIDNIGHT_INDEXER_URL || 'https://midnight-preview.blockfrost.io/api/v0';
const blockfrostKey = env.BLOCKFROST_PROJECT_ID;

// Query tree updates before event (0..12282 and 0..91305)
// and after event (12283..13111 and 91306..115341)
const q = `query {
  genBefore: dustGenerationMerkleTreeUpdate(startIndex: 0, endIndex: 12282) { update }
  commBefore: dustCommitmentMerkleTreeUpdate(startIndex: 0, endIndex: 91305) { update }
  genAfter: dustGenerationMerkleTreeUpdate(startIndex: 12284, endIndex: 13111) { update }
  commAfter: dustCommitmentMerkleTreeUpdate(startIndex: 91307, endIndex: 115341) { update }
}`;

console.log('Fetching tree updates before and after funding event...');
const r = await fetch(indexerUrl, {
  method: 'POST',
  headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: q })
});
const d = await r.json();
console.log('Query result errors:', d.errors);
console.log('genBefore len:', d.data?.genBefore?.update?.length);
console.log('commBefore len:', d.data?.commBefore?.update?.length);
console.log('genAfter len:', d.data?.genAfter?.update?.length);
console.log('commAfter len:', d.data?.commAfter?.update?.length);

if (d.data?.genBefore?.update && d.data?.commBefore?.update) {
  let localState = new ledger.DustLocalState(lp.dust);
  localState = localState.applyGenerationCollapsedUpdate(
    ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(d.data.genBefore.update, 'hex'))
  );
  localState = localState.applyCommitmentCollapsedUpdate(
    ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(d.data.commBefore.update, 'hex'))
  );
  
  const FUNDING_EVENT_HEX = '6d69646e696768743a6576656e745b76395d3a0400c103cc01793be7ee36a6c94b0aa951c26fc95a6f4567b4f40691819afc555d00c85c00000100050fffaf68efc3920a735ce2e6097a85648610ab426b50e26cd44286cf0cde9c9da05a00da5f6015580673b703f51df0fc04830c92098e354ccd5ccaf1cf6fa35fabf7088707239d6a012300034aa39b6a98ed47b7e048b309aec26fdd52d3cf18a7d4e3fd463d35f6d215e097e3083906aa9205000700f2052a01735ce2e6097a85648610ab426b50e26cd44286cf0cde9c9da05a00da5f6015580698ed47b7e048b309aec26fdd52d3cf18a7d4e3fd463d35f6d215e097e308390613ffffffffffffffffedbf0362a39b6a';
  const replayRes = localState.replayRawEvents(dustSecretKey, Buffer.from(FUNDING_EVENT_HEX, 'hex'));
  localState = replayRes.state;
  console.log('UTXO after replay:', localState.utxos?.length);
  
  // Now apply updates after event
  if (d.data.genAfter?.update) {
    localState = localState.applyGenerationCollapsedUpdate(
      ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(d.data.genAfter.update, 'hex'))
    );
    console.log('[OK] Applied genAfter update');
  }
  if (d.data.commAfter?.update) {
    localState = localState.applyCommitmentCollapsedUpdate(
      ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(d.data.commAfter.update, 'hex'))
    );
    console.log('[OK] Applied commAfter update');
  }
  
  console.log('UTXOs count after full sync:', localState.utxos?.length);
  console.log('Wallet balance:', localState.walletBalance(new Date()));
  
  // Now try spend on fully synced state!
  const now = new Date();
  const feeEstimate = 4102720980565255n;
  const [newState, dustSpend] = localState.spend(dustSecretKey, localState.utxos[0], feeEstimate, now);
  console.log('[SUCCESS] spend() on fully synced state succeeded!');
  console.log('vFee:', dustSpend.vFee);
}
