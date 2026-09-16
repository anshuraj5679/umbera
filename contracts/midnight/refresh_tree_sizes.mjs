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

async function run() {
  // Query with progressively larger endIndices to find current tree size
  // Start with a big number and see what we get back
  const q = `query {
    block { height hash }
    genUpdate1: dustGenerationMerkleTreeUpdate(startIndex: 0, endIndex: 12282) {
      startIndex endIndex protocolVersion
    }
    genUpdate2: dustGenerationMerkleTreeUpdate(startIndex: 12282, endIndex: 50000) {
      startIndex endIndex protocolVersion
    }
    commUpdate1: dustCommitmentMerkleTreeUpdate(startIndex: 0, endIndex: 91305) {
      startIndex endIndex protocolVersion
    }
    commUpdate2: dustCommitmentMerkleTreeUpdate(startIndex: 91305, endIndex: 200000) {
      startIndex endIndex protocolVersion
    }
  }`;

  const r = await fetch(indexerUrl, {
    method: 'POST',
    headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q })
  });
  const d = await r.json();
  console.log('Block:', d?.data?.block?.height);
  console.log('genUpdate1 (0-12282):', d?.data?.genUpdate1?.startIndex, '-', d?.data?.genUpdate1?.endIndex);
  console.log('genUpdate2 (12282-50000):', d?.data?.genUpdate2?.startIndex, '-', d?.data?.genUpdate2?.endIndex);
  console.log('commUpdate1 (0-91305):', d?.data?.commUpdate1?.startIndex, '-', d?.data?.commUpdate1?.endIndex);
  console.log('commUpdate2 (91305-200000):', d?.data?.commUpdate2?.startIndex, '-', d?.data?.commUpdate2?.endIndex);
  if (d?.errors) console.log('Errors:', JSON.stringify(d.errors));
}

run().catch(console.error);