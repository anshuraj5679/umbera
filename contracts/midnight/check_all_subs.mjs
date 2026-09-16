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

async function checkSub() {
  const query = `
    query {
      __schema {
        subscriptionType {
          fields {
            name
            args {
              name
              type {
                name
                kind
                ofType {
                  name
                  kind
                }
              }
            }
          }
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
    body: JSON.stringify({ query })
  });

  const data = await res.json();
  const fields = data?.data?.__schema?.subscriptionType?.fields || [];
  for (const f of fields) {
    const args = f.args.map(a => `${a.name}: ${a.type.name || a.type.ofType?.name}`).join(', ');
    console.log(`${f.name}(${args})`);
  }
}

checkSub().catch(console.error);
