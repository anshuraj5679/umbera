import fs from 'fs';

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
const indexerUrl = env.MIDNIGHT_INDEXER_URL || 'https://midnight-preview.blockfrost.io/api/v0';
const blockfrostKey = env.BLOCKFROST_PROJECT_ID;

// Check dust status of the UTXO
const q = `query {
  dustGenerations(dustAddress: "mn_dust_preview1qevp2czlmgq94gyann0qenuxgt2xecjsddp2kyyxvjzh5z0xufwqkfyfgm", offset: { height: 0 }, limit: 5) {
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
      spent
      spentTransactionId
    }
  }
}`;

const r = await fetch(indexerUrl, {
  method: 'POST',
  headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: q })
});
const d = await r.json();
console.log('Response:', JSON.stringify(d, null, 2));