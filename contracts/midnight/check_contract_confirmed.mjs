import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { firstValueFrom } from 'rxjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

setNetworkId('preview');

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
const wsBaseUrl = env.MIDNIGHT_INDEXER_WS_URL || 'wss://midnight-preview.blockfrost.io/api/v0/ws';
const authenticatedIndexerUrl = `${indexerBaseUrl}${authQuery}`;
const authenticatedWsUrl = `${wsBaseUrl}${authQuery}`;

const contractAddress = env.MIDNIGHT_CONTRACT_ADDRESS;
console.log('Checking deployment status for contract:', contractAddress);

const provider = indexerPublicDataProvider(authenticatedIndexerUrl, authenticatedWsUrl);

async function check() {
  try {
    const state = await provider.queryContractState(contractAddress);
    console.log('[INDEXER] Contract state found on-chain:', state ? 'EXISTS' : 'NOT YET');
  } catch (e) {
    console.log('queryContractState:', e.message);
  }

  // Also query node RPC midnight_contractState
  try {
    const r = await fetch(env.MIDNIGHT_NODE_URL, {
      method: 'POST',
      headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'midnight_contractState',
        params: [contractAddress]
      })
    });
    const d = await r.json();
    console.log('[NODE RPC] midnight_contractState:', d?.result ? 'EXISTS (State bytes: ' + d.result.length + ')' : 'PENDING');
  } catch (e) {
    console.log('Node RPC error:', e.message);
  }
}

check().catch(console.error);
