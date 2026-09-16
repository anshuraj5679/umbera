import * as ledger from '@midnight-ntwrk/ledger-v8';
import bip39 from 'bip39';
import { HDKey } from 'file:///D:/midnight/frontend/node_modules/.pnpm/node_modules/@scure/bip32/lib/esm/index.js';
import fs from 'fs';
import path from 'path';

function loadEnv() {
  const envPath = path.resolve('../../.env');
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

console.log('Deployer Dust Public Key:', dustSecretKey.publicKey);

// Let's inspect insertGenerationInfo and insertCommitment
console.log('insertGenerationInfo:', typeof localState.insertGenerationInfo);
console.log('insertCommitment:', typeof localState.insertCommitment);
console.log('addUtxo:', typeof localState.addUtxo);
