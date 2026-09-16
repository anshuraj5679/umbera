import fs from 'fs';
import WebSocket from 'file:///D:/midnight/frontend/node_modules/.pnpm/node_modules/ws/index.js';

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
const wsUrl = env.MIDNIGHT_INDEXER_WS_URL || 'wss://midnight-preview.blockfrost.io/api/v0/ws';
const blockfrostKey = env.BLOCKFROST_PROJECT_ID;
const address = 'mn_addr_preview123hysmjl9ey5y7smnm2tvh92gfqzk9rlq34ca6042efd5a9gl6yqwjgl8p';

const ws = new WebSocket(wsUrl, ['graphql-transport-ws', 'graphql-ws'], {
  headers: { 'project_id': blockfrostKey }
});

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'connection_init', payload: { project_id: blockfrostKey } }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'connection_ack') {
    ws.send(JSON.stringify({
      id: 'sub1',
      type: 'subscribe',
      payload: {
        query: `
          subscription {
            unshieldedTransactions(address: "${address}") {
              ... on UnshieldedTransaction {
                transaction { id hash }
                createdUtxos {
                  owner
                  tokenType
                  value
                  outputIndex
                  intentHash
                  ctime
                  registeredForDustGeneration
                }
              }
            }
          }
        `
      }
    }));
  } else if (msg.type === 'next' && msg.payload?.data?.unshieldedTransactions) {
    const item = msg.payload.data.unshieldedTransactions;
    if (item.transaction?.hash === 'cc01793be7ee36a6c94b0aa951c26fc95a6f4567b4f40691819afc555d00c85c') {
      console.log('Found cc01793b UTXOs:');
      console.log(JSON.stringify(item.createdUtxos, null, 2));
      ws.close();
      process.exit(0);
    }
  }
});
