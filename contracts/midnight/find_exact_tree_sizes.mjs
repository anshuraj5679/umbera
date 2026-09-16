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

async function checkEndIndex(field, start, end) {
  const q = `query { ${field}(startIndex: ${start}, endIndex: ${end}) { startIndex endIndex } }`;
  const r = await fetch(indexerUrl, {
    method: 'POST',
    headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q })
  });
  const d = await r.json();
  if (d.data && d.data[field] && !d.errors) {
    return true;
  }
  return false;
}

// Binary search for max valid endIndex
async function findMaxEnd(field, start, min, max) {
  let low = min;
  let high = max;
  let best = min;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const ok = await checkEndIndex(field, start, mid);
    if (ok) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

console.log('Finding exact tree sizes on Midnight Preview...');
const maxGen = await findMaxEnd('dustGenerationMerkleTreeUpdate', 0, 12282, 32767);
console.log('Max valid generation endIndex from 0:', maxGen);

const maxComm = await findMaxEnd('dustCommitmentMerkleTreeUpdate', 0, 91305, 131071);
console.log('Max valid commitment endIndex from 0:', maxComm);
