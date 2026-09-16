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
const rBlock = await fetch(env.MIDNIGHT_INDEXER_URL, {
  method: 'POST',
  headers: { 'project_id': env.BLOCKFROST_PROJECT_ID, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: 'query { block { dustCommitmentEndIndex } }' })
});
const b = (await rBlock.json()).data.block;
for (const end of [b.dustCommitmentEndIndex, b.dustCommitmentEndIndex - 1]) {
  const r = await fetch(env.MIDNIGHT_INDEXER_URL, {
    method: 'POST',
    headers: { 'project_id': env.BLOCKFROST_PROJECT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `query { comm: dustCommitmentMerkleTreeUpdate(startIndex: 116145, endIndex: ${end}) { update } }` })
  });
  const d = await r.json();
  console.log('end:', end, 'error:', d.errors?.[0]?.message, 'hasUpdate:', !!d.data?.comm?.update);
}
