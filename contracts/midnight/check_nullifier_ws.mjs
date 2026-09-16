import fs from 'fs';
import WebSocket from 'file:///D:/midnight/frontend/node_modules/.pnpm/node_modules/ws/index.js';

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
const wsUrl = env.MIDNIGHT_INDEXER_WS_URL || 'wss://midnight-preview.blockfrost.io/api/v0/ws';
const blockfrostKey = env.BLOCKFROST_PROJECT_ID;
const authQuery = '?project_id=' + blockfrostKey;

// nullifier LE hex
const nullLE = '377cc4bc4d2488dc275c6a37d6d31486f5f426198e943e88d88d4bb1ffd5ef3c';
const nullPrefix = nullLE.slice(0, 16); // First 8 bytes LE prefix

const ws = new WebSocket(`${wsUrl}${authQuery}`, ['graphql-transport-ws', 'graphql-ws'], {
  headers: { 'project_id': blockfrostKey }
});

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'connection_init', payload: { project_id: blockfrostKey } }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'connection_ack') {
    console.log('Connected! Querying nullifier...');
    ws.send(JSON.stringify({
      id: 'nullCheck',
      type: 'subscribe',
      payload: {
        query: `subscription {
          dustNullifierTransactions(
            nullifierLeBytesPrefixes: ["${nullPrefix}"]
            fromBlock: 0
            toBlock: 900000
          ) {
            __typename
            ... on DustNullifierTransaction {
              nullifierLeBytes
              commitmentLeBytes
              transactionId
              transactionHash
              blockHeight
            }
          }
        }`
      }
    }));
  } else {
    console.log('WS msg type:', msg.type, 'id:', msg.id);
    if (msg.data) {
      console.log('DATA:', JSON.stringify(msg.data, null, 2));
    }
    if (msg.errors) {
      console.log('ERRORS:', JSON.stringify(msg.errors, null, 2));
    }
  }
});

ws.on('error', (e) => console.error('WS error:', e.message));

setTimeout(() => {
  console.log('\nTimeout - closing. UTXO appears NOT spent (no nullifier found).');
  ws.close();
  process.exit(0);
}, 8000);