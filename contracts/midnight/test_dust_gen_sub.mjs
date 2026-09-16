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

const addrBE = 'mn_dust_preview1qevp2czlmgq94gyann0qenuxgt2xecjsddp2kyyxvjzh5z0xufwqkfyfgm';
const addrLE = 'mn_dust_preview1tn3wvzt6s4jgvy9tgf44pcnv63pgdncvm6wfmgz6qrd97cq4tqrqjzw8dh';

const ws = new WebSocket(wsUrl, ['graphql-transport-ws', 'graphql-ws'], {
  headers: { 'project_id': blockfrostKey }
});

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'connection_init', payload: { project_id: blockfrostKey } }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'connection_ack') {
    console.log('Connected! Subscribing for LE...');
    ws.send(JSON.stringify({
      id: 'subLE',
      type: 'subscribe',
      payload: {
        query: `
          subscription {
            dustGenerations(dustAddress: "${addrLE}") {
              __typename
              ... on DustGenerationsItem {
                commitmentMtIndex
                generationMtIndex
                owner
                value
                initialValue
                backingNight
                ctime
                transactionId
                transactionHash
              }
            }
          }
        `
      }
    }));

    ws.send(JSON.stringify({
      id: 'subBE',
      type: 'subscribe',
      payload: {
        query: `
          subscription {
            dustGenerations(dustAddress: "${addrBE}") {
              __typename
              ... on DustGenerationsItem {
                commitmentMtIndex
                generationMtIndex
                owner
                value
                initialValue
                backingNight
                ctime
                transactionId
                transactionHash
              }
            }
          }
        `
      }
    }));
  } else {
    console.log('WS msg:', JSON.stringify(msg));
  }
});

setTimeout(() => {
  ws.close();
  process.exit(0);
}, 6000);
