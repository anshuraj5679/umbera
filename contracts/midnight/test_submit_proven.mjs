import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WalletBuilder } from '@midnight-ntwrk/wallet';
import { NetworkId as ZswapNetworkId } from '@midnight-ntwrk/zswap';
import { Transaction, LedgerParameters } from '@midnight-ntwrk/ledger-v8';
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
const blockfrostKey = env.BLOCKFROST_PROJECT_ID;
const authQuery = '?project_id=' + blockfrostKey;
const indexerBaseUrl = env.MIDNIGHT_INDEXER_URL || 'https://midnight-preview.blockfrost.io/api/v0';
const nodeBaseUrl = env.MIDNIGHT_NODE_URL || 'https://rpc.midnight-preview.blockfrost.io';
const wsBaseUrl = env.MIDNIGHT_INDEXER_WS_URL || 'wss://midnight-preview.blockfrost.io/api/v0/ws';
const proofServerUrl = env.PROOF_SERVER_URL || 'http://localhost:6300';
const authenticatedIndexerUrl = `${indexerBaseUrl}${authQuery}`;
const authenticatedWsUrl = `${wsBaseUrl}${authQuery}`;
const authenticatedNodeUrl = `${nodeBaseUrl}${authQuery}`;

const mnemonic = env.MIDNIGHT_DEPLOYER_SEED.trim();
const words = mnemonic.split(/\s+/);
const hexEntropy = bip39.mnemonicToEntropy(words.join(' '));

const binPath = path.join(__dirname, 'proven_deploy_tx.bin');
if (!fs.existsSync(binPath)) throw new Error('proven_deploy_tx.bin not found');
const bytes = new Uint8Array(fs.readFileSync(binPath));
console.log('Loaded proven_deploy_tx.bin bytes:', bytes.length);

const provenTx = Transaction.deserialize('signature', 'proof', 'pre-binding', bytes);
console.log('Deserialized proven tx. Identifiers:', provenTx.identifiers().join(', '));

// Intercept fetch to capture exact RPC request and response
const origFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  let url = input;
  let body = init?.body;
  if (input instanceof Request) {
    url = input.url;
    body = await input.clone().text();
  }
  const resp = await origFetch(input, init);
  if (body && typeof body === 'string' && body.includes('author_submitExtrinsic')) {
    const respClone = resp.clone();
    const respText = await respClone.text();
    console.log(`\n[RPC SUBMISSION CAPTURE]`);
    console.log(`URL:    ${url}`);
    console.log(`Status: ${resp.status}`);
    console.log(`Body:   ${respText}`);
  }
  return resp;
};

async function main() {
  console.log('Building wallet...');
  const wallet = await WalletBuilder.build(
    authenticatedIndexerUrl,
    authenticatedWsUrl,
    proofServerUrl,
    authenticatedNodeUrl,
    hexEntropy,
    ZswapNetworkId.TestNet,
    'warn',
    true
  );

  console.log('Submitting transaction to Midnight Preview...');
  try {
    const result = await wallet.submitTransaction(provenTx);
    console.log('\n[SUCCESS] submitTransaction returned:', result);
  } catch (e) {
    console.log('\n[SUBMIT ERROR]:', e.message);
    if (e.stack) console.log(e.stack);
  } finally {
    try { await wallet.close(); } catch {}
  }
}

main().catch(console.error);
