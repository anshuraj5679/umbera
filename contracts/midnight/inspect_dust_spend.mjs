import fs from 'fs';
import {
  LedgerParameters,
  DustSecretKey,
  DustLocalState,
  DustStateMerkleTreeCollapsedUpdate,
  DustActions,
  Intent,
  Transaction
} from '@midnight-ntwrk/ledger-v8';
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
const lp = LedgerParameters.initialParameters();
const mnemonic = env.MIDNIGHT_DEPLOYER_SEED.trim();
const seedBytes = bip39.mnemonicToSeedSync(mnemonic);
const root = HDKey.fromMasterSeed(seedBytes);
const child2 = root.derive("m/44'/2400'/0'/2/0");
const dustSecretKey = DustSecretKey.fromSeed(child2.privateKey);
console.log('Dust Public Key:', dustSecretKey.publicKey.toString());

const treeUpdates = JSON.parse(fs.readFileSync('d:/midnight/contracts/midnight/tree_updates.json', 'utf8'));
let localState = new DustLocalState(lp.dust);
localState = localState.applyGenerationCollapsedUpdate(
  DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(treeUpdates.genUpdate.update, 'hex'))
);
localState = localState.applyCommitmentCollapsedUpdate(
  DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(treeUpdates.commUpdate.update, 'hex'))
);
const FUNDING_EVENT_HEX = '6d69646e696768743a6576656e745b76395d3a0400c103cc01793be7ee36a6c94b0aa951c26fc95a6f4567b4f40691819afc555d00c85c00000100050fffaf68efc3920a735ce2e6097a85648610ab426b50e26cd44286cf0cde9c9da05a00da5f6015580673b703f51df0fc04830c92098e354ccd5ccaf1cf6fa35fabf7088707239d6a012300034aa39b6a98ed47b7e048b309aec26fdd52d3cf18a7d4e3fd463d35f6d215e097e3083906aa9205000700f2052a01735ce2e6097a85648610ab426b50e26cd44286cf0cde9c9da05a00da5f6015580698ed47b7e048b309aec26fdd52d3cf18a7d4e3fd463d35f6d215e097e308390613ffffffffffffffffedbf0362a39b6a';
const res = localState.replayRawEvents(dustSecretKey, Buffer.from(FUNDING_EVENT_HEX, 'hex'));
localState = res.state;
const dustUtxo = localState.utxos[0];
console.log('UTXO mtIndex:', dustUtxo.mtIndex);
console.log('UTXO value:', dustUtxo.value);
console.log('UTXO backingNight:', dustUtxo.backingNight?.toString());

// Inspect dustSpend object
const now = new Date();
const feeEstimate = 4102720980565255n;
const [newState, dustSpend] = localState.spend(dustSecretKey, dustUtxo, feeEstimate, now);
console.log('\ndustSpend keys:', Object.keys(dustSpend));
console.log('dustSpend type:', dustSpend.constructor?.name);
// Try to serialize it
try {
  console.log('dustSpend serialized:', Buffer.from(dustSpend.serialize()).toString('hex').slice(0, 100));
} catch(e) {
  console.log('serialize error:', e.message);
}
// Check internal structure
for (const [k, v] of Object.entries(dustSpend)) {
  console.log(`  ${k}: ${typeof v === 'bigint' ? v.toString() : JSON.stringify(v)?.slice(0, 80)}`);
}