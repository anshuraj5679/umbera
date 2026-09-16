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

// Query the current tree updates with exact same indices as cached
const q = `query {
  block { height hash }
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
console.log('Block:', d?.data?.block?.height, d?.data?.block?.hash);

const currentGen = d?.data?.genUpdate?.update;
const currentComm = d?.data?.commUpdate?.update;

const cached = JSON.parse(fs.readFileSync('d:/midnight/contracts/midnight/tree_updates.json', 'utf8'));
const cachedGen = cached.genUpdate?.update;
const cachedComm = cached.commUpdate?.update;

console.log('genUpdate same?', currentGen === cachedGen);
console.log('commUpdate same?', currentComm === cachedComm);
if (currentGen !== cachedGen) {
  console.log('genUpdate CHANGED!');
  console.log('cached gen:', cachedGen?.slice(0, 80));
  console.log('current gen:', currentGen?.slice(0, 80));
}
if (currentComm !== cachedComm) {
  console.log('commUpdate CHANGED!');
  console.log('cached comm:', cachedComm?.slice(0, 80));
  console.log('current comm:', currentComm?.slice(0, 80));
}
if (currentGen === cachedGen && currentComm === cachedComm) {
  console.log('Tree updates ARE identical! Saving fresh copy...');
  const fresh = { genUpdate: d.data.genUpdate, commUpdate: d.data.commUpdate };
  fs.writeFileSync('d:/midnight/contracts/midnight/tree_updates_fresh.json', JSON.stringify(fresh, null, 2));
}