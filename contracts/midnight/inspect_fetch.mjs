import fs from 'fs';
import { WalletBuilder } from '@midnight-ntwrk/wallet';
import { NetworkId as ZswapNetworkId } from '@midnight-ntwrk/zswap';
import bip39 from 'bip39';

const envLines = fs.readFileSync('d:/midnight/.env', 'utf8').split('\n');
const env = {};
for (const line of envLines) {
  const t = line.trim();
  if (t && !t.startsWith('#')) {
    const idx = t.indexOf('=');
    if (idx !== -1) {
      let val = t.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[t.slice(0, idx).trim()] = val;
    }
  }
}

const words = env.MIDNIGHT_DEPLOYER_SEED.trim().split(/\s+/);
const hexEntropy = bip39.mnemonicToEntropy(words.join(' '));
const blockfrostKey = env.BLOCKFROST_PROJECT_ID;
const authQuery = '?project_id=' + blockfrostKey;

const origFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  let url = input;
  let body = init?.body;
  if (input instanceof Request) {
    url = input.url;
    body = await input.clone().text();
  }
  console.log('--- FETCH CALL ---');
  console.log('URL:', url);
  console.log('REQUEST BODY:', body);
  const resp = await origFetch(input, init);
  const respClone = resp.clone();
  const text = await respClone.text();
  console.log('RESPONSE STATUS:', resp.status);
  console.log('RESPONSE BODY:', text);
  return resp;
};

async function test() {
  const wallet = await WalletBuilder.build(
    'https://midnight-preview.blockfrost.io/api/v0' + authQuery,
    'wss://midnight-preview.blockfrost.io/api/v0/ws' + authQuery,
    'http://localhost:6300',
    'https://rpc.midnight-preview.blockfrost.io' + authQuery,
    hexEntropy,
    ZswapNetworkId.TestNet,
    'error',
    true
  );

  const dummyTx = {
    serialize: () => new Uint8Array([1, 2, 3, 4]),
    identifiers: () => ['test-id-123']
  };

  try {
    await wallet.submitTransaction(dummyTx);
  } catch (e) {
    console.log('submit error:', e.message);
  }
  await wallet.close();
}

test().catch(console.error);
