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

const blockHashCc01 = 'c5dfa9869069c0d562b0c697d8d7c4dc36ec42e6ece2890b4cd355ef9c8cdbbb';
const blockHeightCc01 = 727902;

const ws = new WebSocket(wsUrl, ['graphql-transport-ws', 'graphql-ws'], {
  headers: { 'project_id': blockfrostKey }
});

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'connection_init', payload: { project_id: blockfrostKey } }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'connection_ack') {
    console.log('Connected! Subscribing at block 727902...');
    ws.send(JSON.stringify({
      id: 'subLE',
      type: 'subscribe',
      payload: {
        query: `
          subscription {
            dustGenerations(
              dustAddress: "${addrLE}",
              blockHash: "${blockHashCc01}",
              dtimeCutoffHeight: ${blockHeightCc01}
            ) {
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
            dustGenerations(
              dustAddress: "${addrBE}",
              blockHash: "${blockHashCc01}",
              dtimeCutoffHeight: ${blockHeightCc01}
            ) {
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
    console.log('WS msg:', JSON.stringify(msg, null, 2));
  }
});

setTimeout(() => {
  ws.close();
  process.exit(0);
}, 6000);
