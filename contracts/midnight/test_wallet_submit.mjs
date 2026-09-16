import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WalletBuilder } from '@midnight-ntwrk/wallet';
import { NetworkId as ZswapNetworkId } from '@midnight-ntwrk/zswap';
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

const nodeBaseUrl = env.MIDNIGHT_NODE_URL || 'https://rpc.midnight-preview.blockfrost.io';
const indexerBaseUrl = env.MIDNIGHT_INDEXER_URL || 'https://midnight-preview.blockfrost.io/api/v0';
const wsBaseUrl = env.MIDNIGHT_INDEXER_WS_URL || 'wss://midnight-preview.blockfrost.io/api/v0/ws';
const blockfrostKey = env.BLOCKFROST_PROJECT_ID;
const authQuery = '?project_id=' + blockfrostKey;
const authenticatedIndexerUrl = `${indexerBaseUrl}${authQuery}`;
const authenticatedWsUrl = `${wsBaseUrl}${authQuery}`;

async function run() {
  console.log('Building wallet (without start)...');
  const wallet = await WalletBuilder.build(
    authenticatedIndexerUrl,
    authenticatedWsUrl,
    'http://localhost:6300',
    nodeBaseUrl,
    hexEntropy,
    ZswapNetworkId.TestNet,
    'warn',
    false
  );
  console.log('Wallet built successfully!');
  console.log('submitTransaction function exists:', typeof wallet.submitTransaction === 'function');
  await wallet.close();
}

run().catch(console.error);
