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
const indexerUrl = env.MIDNIGHT_INDEXER_URL || 'https://midnight-preview.blockfrost.io/api/v0';
const blockfrostKey = env.BLOCKFROST_PROJECT_ID;

async function run() {
  const query = `
    query {
      genUpdate: dustGenerationMerkleTreeUpdate(startIndex: 0, endIndex: 12282) {
        startIndex
        endIndex
        update
        protocolVersion
      }
      commUpdate: dustCommitmentMerkleTreeUpdate(startIndex: 0, endIndex: 91305) {
        startIndex
        endIndex
        update
        protocolVersion
      }
    }
  `;

  const res = await fetch(indexerUrl, {
    method: 'POST',
    headers: {
      'project_id': blockfrostKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query })
  });

  const data = await res.json();
  console.log('genUpdate:', {
    startIndex: data.data?.genUpdate?.startIndex,
    endIndex: data.data?.genUpdate?.endIndex,
    updateLength: data.data?.genUpdate?.update?.length
  });
  console.log('commUpdate:', {
    startIndex: data.data?.commUpdate?.startIndex,
    endIndex: data.data?.commUpdate?.endIndex,
    updateLength: data.data?.commUpdate?.update?.length
  });

  fs.writeFileSync('d:/midnight/contracts/midnight/tree_updates.json', JSON.stringify(data.data, null, 2));
  console.log('Saved tree_updates.json');
}

run().catch(console.error);
