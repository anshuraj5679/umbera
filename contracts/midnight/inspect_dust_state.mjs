import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
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
const dustPubKey = dustSecretKey.publicKey;

console.log('Dust Public Key:', dustPubKey.toString());

const indexerUrl = env.MIDNIGHT_INDEXER_URL || 'https://midnight-preview.blockfrost.io/api/v0';
const blockfrostKey = env.BLOCKFROST_PROJECT_ID;

// Query GraphQL for all dust events or recent blocks
const q = `query {
  block {
    height
    hash
  }
}`;

const r = await fetch(indexerUrl, {
  method: 'POST',
  headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: q })
});
const d = await r.json();
console.log('Chain tip:', d.data?.block);
