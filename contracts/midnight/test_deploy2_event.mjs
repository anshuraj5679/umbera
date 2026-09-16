import fs from 'fs';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import bip39 from 'bip39';
import { HDKey } from 'file:///D:/midnight/frontend/node_modules/.pnpm/node_modules/@scure/bip32/lib/esm/index.js';

const env = Object.fromEntries(fs.readFileSync('d:/midnight/.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => l.trim().split('=')));
const lp = ledger.LedgerParameters.initialParameters();

const seedBytes = bip39.mnemonicToSeedSync(env.MIDNIGHT_DEPLOYER_SEED.trim());
const root = HDKey.fromMasterSeed(seedBytes);
const child2 = root.derive("m/44'/2400'/0'/2/0");
const dustSecretKey = ledger.DustSecretKey.fromSeed(child2.privateKey);

const DEPLOY2_EVENT_HEX = '6d69646e696768743a6576656e745b76395d3a0400f5012a1eceae9f9390e9904b1216c17b4ebb823a0a6002626cbdd9f5014effc629e10000020007730b51b2dc46391302a49264dbb5e9e9f4c23b68091c38021b9678988b76a65f33c21607007346c4d5f89195eb60d6369560eadb6c457a26aa7c3f56e26b5bde0953e2f070610f0e2bb132a8101103a23caa6a03ba3caa6a';

let localState = new ledger.DustLocalState(lp.dust);
// Replay deploy 2 event directly to see if our key decrypts it
const res = localState.replayRawEvents(dustSecretKey, Buffer.from(DEPLOY2_EVENT_HEX, 'hex'));
console.log('Replay success:', res.events.length);
console.log('UTXOs created:', res.state.utxos.length);
for (const u of res.state.utxos) {
  console.log('UTXO mtIndex:', u.mtIndex, 'value:', u.value?.toString());
}
