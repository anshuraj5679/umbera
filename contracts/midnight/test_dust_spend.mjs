import * as ledger from '@midnight-ntwrk/ledger-v8';
import bip39 from 'bip39';
import { HDKey } from 'file:///D:/midnight/frontend/node_modules/.pnpm/node_modules/@scure/bip32/lib/esm/index.js';
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
const seedBytes = bip39.mnemonicToSeedSync(env.MIDNIGHT_DEPLOYER_SEED.trim());
const root = HDKey.fromMasterSeed(seedBytes);
const child2 = root.derive("m/44'/2400'/0'/2/0");
const dustSecretKey = ledger.DustSecretKey.fromSeed(child2.privateKey);

const lp = ledger.LedgerParameters.initialParameters();
let localState = new ledger.DustLocalState(lp.dust);

const treeUpdates = JSON.parse(fs.readFileSync('d:/midnight/contracts/midnight/tree_updates.json', 'utf8'));

console.log('1. Applying generation tree collapsed update...');
const genUpdateBytes = Buffer.from(treeUpdates.genUpdate.update, 'hex');
const genUpdate = ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(genUpdateBytes);
localState = localState.applyGenerationCollapsedUpdate(genUpdate);
console.log('Generation tree root after collapsed update:', localState.generatingTreeRoot());

console.log('2. Applying commitment tree collapsed update...');
const commUpdateBytes = Buffer.from(treeUpdates.commUpdate.update, 'hex');
const commUpdate = ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(commUpdateBytes);
localState = localState.applyCommitmentCollapsedUpdate(commUpdate);
console.log('Commitment tree root after collapsed update:', localState.commitmentTreeRoot());

console.log('3. Replaying dust event 196028...');
const rawHex = '6d69646e696768743a6576656e745b76395d3a0400c103cc01793be7ee36a6c94b0aa951c26fc95a6f4567b4f40691819afc555d00c85c00000100050fffaf68efc3920a735ce2e6097a85648610ab426b50e26cd44286cf0cde9c9da05a00da5f6015580673b703f51df0fc04830c92098e354ccd5ccaf1cf6fa35fabf7088707239d6a012300034aa39b6a98ed47b7e048b309aec26fdd52d3cf18a7d4e3fd463d35f6d215e097e3083906aa9205000700f2052a01735ce2e6097a85648610ab426b50e26cd44286cf0cde9c9da05a00da5f6015580698ed47b7e048b309aec26fdd52d3cf18a7d4e3fd463d35f6d215e097e308390613ffffffffffffffffedbf0362a39b6a';
const rawBytes = Buffer.from(rawHex, 'hex');

const res = localState.replayRawEvents(dustSecretKey, rawBytes);
localState = res.state;
console.log('Replay succeeded!');
console.log('UTXOs count:', localState.utxos.length);
const u = localState.utxos[0];
console.log('UTXO 0:', {
  initialValue: u.initialValue,
  owner: u.owner,
  nonce: u.nonce,
  ctime: u.ctime,
  mtIndex: u.mtIndex
});

console.log('Wallet balance at current time:', localState.walletBalance(new Date()));

console.log('4. Testing spend:');
const feeUnits = 3277340000000001n;
const now = new Date();
const [newState, dustSpend] = localState.spend(dustSecretKey, u, feeUnits, now);
console.log('*** DUST SPEND SUCCESSFUL! ***');
console.log('oldNullifier:', dustSpend.oldNullifier);
console.log('newCommitment:', dustSpend.newCommitment);
console.log('vFee:', dustSpend.vFee);
console.log('proof:', dustSpend.proof);
console.log('New state utxos:', newState.utxos.length);
console.log('New state wallet balance:', newState.walletBalance(now));
