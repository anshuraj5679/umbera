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

const q = `query {
  genUpdate: dustGenerationMerkleTreeUpdate(startIndex: 0, endIndex: 12282) {
    startIndex endIndex update protocolVersion
  }
  commUpdate: dustCommitmentMerkleTreeUpdate(startIndex: 0, endIndex: 91305) {
    startIndex endIndex update protocolVersion
  }
}`;

const r = await fetch(indexerUrl, {
  method: 'POST',
  headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: q })
});
const d = await r.json();
const cached = JSON.parse(fs.readFileSync('d:/midnight/contracts/midnight/tree_updates.json', 'utf8'));

console.log('CACHED GEN LEN:', cached.genUpdate.update.length);
console.log('CURRENT GEN LEN:', d.data.genUpdate.update.length);
console.log('GEN EQUAL?', cached.genUpdate.update === d.data.genUpdate.update);
if (cached.genUpdate.update !== d.data.genUpdate.update) {
  console.log('CACHED GEN:', cached.genUpdate.update);
  console.log('CURRENT GEN:', d.data.genUpdate.update);
}

console.log('CACHED COMM LEN:', cached.commUpdate.update.length);
console.log('CURRENT COMM LEN:', d.data.commUpdate.update.length);
console.log('COMM EQUAL?', cached.commUpdate.update === d.data.commUpdate.update);
