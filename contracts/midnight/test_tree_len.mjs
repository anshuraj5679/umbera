import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('d:/midnight/.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => l.trim().split('=')));
const r = await fetch(env.MIDNIGHT_INDEXER_URL, {
  method: 'POST',
  headers: { 'project_id': env.BLOCKFROST_PROJECT_ID, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: `query {
      gen0: dustGenerationMerkleTreeUpdate(startIndex: 0, endIndex: 12282) { update }
      comm0: dustCommitmentMerkleTreeUpdate(startIndex: 0, endIndex: 91305) { update }
    }`
  })
});
const d = await r.json();
console.log('gen0 len:', d.data?.gen0?.update?.length);
console.log('comm0 len:', d.data?.comm0?.update?.length);
