import { WalletBuilder } from '@midnight-ntwrk/wallet';
import { NetworkId as ZswapNetworkId } from '@midnight-ntwrk/zswap';
import bip39 from 'bip39';
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
const words = env.MIDNIGHT_DEPLOYER_SEED.trim().split(/\s+/);
const hexEntropy = bip39.mnemonicToEntropy(words.join(' '));

const nodeBaseUrl = env.MIDNIGHT_NODE_URL || 'https://rpc.midnight-preview.blockfrost.io';
const indexerBaseUrl = env.MIDNIGHT_INDEXER_URL || 'https://midnight-preview.blockfrost.io/api/v0';
const wsBaseUrl = env.MIDNIGHT_INDEXER_WS_URL || 'wss://midnight-preview.blockfrost.io/api/v0/ws';
const blockfrostKey = env.BLOCKFROST_PROJECT_ID;
const authQuery = '?project_id=' + blockfrostKey;

// Intercept fetch calls
const origFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  let url = typeof input === 'string' ? input : input.url;
  let body = init?.body;
  if (!body && input instanceof Request) {
    try {
      body = await input.clone().text();
    } catch {}
  }
  console.log('[INTERCEPTED FETCH]', url);
  if (body) {
    try {
      const parsed = JSON.parse(body);
      console.log('   method:', parsed.method, 'id:', parsed.id);
      if (parsed.method === 'author_submitExtrinsic') {
        console.log('   extrinsic hex length:', parsed.params?.[0]?.length);
        console.log('   extrinsic prefix:', parsed.params?.[0]?.slice(0, 40));
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: 'test-intercepted-hash' }), { status: 200 });
      }
    } catch {}
  }
  return origFetch(input, init);
};

async function testSubmitTrace() {
  const authenticatedNodeUrl = `${nodeBaseUrl}${authQuery}`;
  const wallet = await WalletBuilder.build(
    `${indexerBaseUrl}${authQuery}`,
    `${wsBaseUrl}${authQuery}`,
    'http://localhost:6300',
    authenticatedNodeUrl,
    hexEntropy,
    ZswapNetworkId.TestNet,
    'error',
    true
  );

  console.log('Testing submitTransaction call:');
  // Pass a dummy transaction with serialize method
  const dummyTx = {
    serialize: () => new Uint8Array([1, 2, 3, 4]),
    identifiers: () => ['test-id-123']
  };

  try {
    const res = await wallet.submitTransaction(dummyTx);
    console.log('submitTransaction returned:', res);
  } catch (e) {
    console.log('submitTransaction error:', e.message);
  }

  await wallet.close();
}

testSubmitTrace().catch(console.error);
