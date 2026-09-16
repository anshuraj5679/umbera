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

async function query() {
  const q = `
    query {
      transactions(offset: { hash: "7d2f1bd3cd79a1d31b4ff596fc1b96e6189cb55875aa3b5b22683e3fa8c2d9c3" }) {
        id
        hash
        block {
          height
          hash
          timestamp
        }
        ... on RegularTransaction {
          fee
          dustCommitmentStartIndex
          dustCommitmentEndIndex
        }
      }
    }
  `;

  const res = await fetch(indexerUrl, {
    method: 'POST',
    headers: {
      'project_id': blockfrostKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: q })
  });

  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

query().catch(console.error);
