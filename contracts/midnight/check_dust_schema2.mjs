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

// Use introspection to see dustGenerationStatus fields
const q = `{
  __schema {
    types {
      name
      fields {
        name
        type { name kind ofType { name } }
      }
    }
  }
}`;

const r = await fetch(indexerUrl, {
  method: 'POST',
  headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: q })
});
const d = await r.json();
const types = d?.data?.__schema?.types || [];
for (const t of types) {
  if (t.name && (t.name.includes('Dust') || t.name.includes('dust'))) {
    console.log('\nType:', t.name);
    for (const f of (t.fields || [])) {
      console.log('  ', f.name, ':', f.type?.name || f.type?.ofType?.name);
    }
  }
}