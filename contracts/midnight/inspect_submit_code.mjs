import fs from 'fs';
import path from 'path';
import { WalletBuilder } from '@midnight-ntwrk/wallet';
import { NetworkId as ZswapNetworkId } from '@midnight-ntwrk/zswap';
import bip39 from 'bip39';

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
const words = env.MIDNIGHT_DEPLOYER_SEED.trim().split(/\s+/);
const hexEntropy = bip39.mnemonicToEntropy(words.join(' '));

async function inspect() {
  const wallet = await WalletBuilder.build(
    env.MIDNIGHT_INDEXER_URL || 'https://midnight-preview.blockfrost.io/api/v0',
    env.MIDNIGHT_INDEXER_WS_URL || 'wss://midnight-preview.blockfrost.io/api/v0/ws',
    'http://localhost:6300',
    env.MIDNIGHT_NODE_URL || 'https://rpc.midnight-preview.blockfrost.io',
    hexEntropy,
    ZswapNetworkId.TestNet,
    'error',
    true
  );

  console.log('submitTransaction function length:', wallet.submitTransaction.length);
  console.log('submitTransaction code:', wallet.submitTransaction.toString().slice(0, 500));

  await wallet.close();
}

inspect().catch(console.error);
