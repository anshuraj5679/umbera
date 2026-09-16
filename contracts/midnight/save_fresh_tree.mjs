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

if (!d.data?.genUpdate?.update || !d.data?.commUpdate?.update) {
  throw new Error('Failed to fetch tree updates: ' + JSON.stringify(d));
}

const freshData = {
  genUpdate: d.data.genUpdate,
  commUpdate: d.data.commUpdate
};

fs.writeFileSync('d:/midnight/contracts/midnight/tree_updates.json', JSON.stringify(freshData, null, 2));
console.log('Successfully updated tree_updates.json with fresh on-chain data!');
console.log('genUpdate:', freshData.genUpdate.startIndex, 'to', freshData.genUpdate.endIndex);
console.log('commUpdate:', freshData.commUpdate.startIndex, 'to', freshData.commUpdate.endIndex);
