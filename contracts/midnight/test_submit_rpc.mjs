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
const nodeUrl = env.MIDNIGHT_NODE_URL || 'https://rpc.midnight-preview.blockfrost.io';
const blockfrostKey = env.BLOCKFROST_PROJECT_ID;

async function testSubmit() {
  const res = await fetch(nodeUrl, {
    method: 'POST',
    headers: {
      'project_id': blockfrostKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'author_submitExtrinsic',
      params: ['0x1234']
    })
  });

  console.log('Result:', await res.json());
}

testSubmit().catch(console.error);
