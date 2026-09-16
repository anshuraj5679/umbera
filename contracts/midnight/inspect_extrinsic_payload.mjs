import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WalletBuilder } from '@midnight-ntwrk/wallet';
import { NetworkId as ZswapNetworkId } from '@midnight-ntwrk/zswap';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import bip39 from 'bip39';

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
const words = env.MIDNIGHT_DEPLOYER_SEED.trim().split(/\s+/);
const hexEntropy = bip39.mnemonicToEntropy(words.join(' '));

const bytes = new Uint8Array(fs.readFileSync('d:/midnight/contracts/midnight/proven_deploy_tx.bin'));
const provenTx = ledger.Transaction.deserialize('signature', 'proof', 'pre-binding', bytes);
const boundTx = provenTx.bind();

const rawTxBytes = boundTx.serialize();
console.log('rawTxBytes length:', rawTxBytes.length);
console.log('rawTxBytes first 30 bytes hex:', Buffer.from(rawTxBytes.slice(0, 30)).toString('hex'));
console.log('rawTxBytes first 30 bytes ascii:', Buffer.from(rawTxBytes.slice(0, 30)).toString('utf8'));

globalThis.fetch = async (input, init) => {
  let body = init?.body;
  if (input instanceof Request) body = await input.clone().text();
  if (body && body.includes('author_submitExtrinsic')) {
    const parsed = JSON.parse(body);
    const ext = parsed.params[0];
    console.log('\nExtrinsic total hex length:', ext.length);
    console.log('Extrinsic first 60 chars:', ext.slice(0, 60));
    const buf = Buffer.from(ext, 'hex');
    console.log('Extrinsic first 30 bytes:', buf.slice(0, 30));
    console.log('Extrinsic ascii from byte 4:', buf.slice(4, 50).toString('utf8'));
    console.log('Extrinsic ascii from byte 7:', buf.slice(7, 50).toString('utf8'));
  }
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x123' }));
};

const wallet = await WalletBuilder.build(
  'https://midnight-preview.blockfrost.io/api/v0',
  'wss://midnight-preview.blockfrost.io/api/v0/ws',
  'http://localhost:6300',
  'https://rpc.midnight-preview.blockfrost.io',
  hexEntropy,
  ZswapNetworkId.TestNet,
  'warn',
  true
);

await wallet.submitTransaction(boundTx);
await wallet.close();
