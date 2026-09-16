import { WalletBuilder } from '@midnight-ntwrk/wallet';
import { NetworkId as ZswapNetworkId } from '@midnight-ntwrk/zswap';
import bip39 from 'bip39';
import fs from 'fs';
import { firstValueFrom } from 'rxjs';

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
const words = env.MIDNIGHT_DEPLOYER_SEED.trim().split(/\s+/);
const hexEntropy = bip39.mnemonicToEntropy(words.join(' '));
const blockfrostKey = env.BLOCKFROST_PROJECT_ID;
const authQuery = '?project_id=' + blockfrostKey;

const wallet = await WalletBuilder.build(
  (env.MIDNIGHT_INDEXER_URL || 'https://midnight-preview.blockfrost.io/api/v0') + authQuery,
  (env.MIDNIGHT_INDEXER_WS_URL || 'wss://midnight-preview.blockfrost.io/api/v0/ws') + authQuery,
  'http://localhost:6300',
  (env.MIDNIGHT_NODE_URL || 'https://rpc.midnight-preview.blockfrost.io') + authQuery,
  hexEntropy,
  ZswapNetworkId.TestNet,
  'warn',
  true
);

console.log('Wallet built. Starting wallet...');
await wallet.start();
console.log('Waiting for first wallet.state emission...');
try {
  console.log('wallet.state type:', typeof wallet.state);
  const stateObservable = typeof wallet.state === 'function' ? wallet.state() : wallet.state;
  console.log('stateObservable type:', typeof stateObservable, stateObservable?.constructor?.name);
  const state = await Promise.race([
    firstValueFrom(stateObservable),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 10s')), 10000))
  ]);
  console.log('Wallet state keys:', Object.keys(state));
  for (const k of Object.keys(state)) {
    console.log(`  ${k}:`, typeof state[k], state[k]);
  }
} catch (e) {
  console.log('Error / timeout waiting for wallet.state:', e.message);
} finally {
  await wallet.close();
}
