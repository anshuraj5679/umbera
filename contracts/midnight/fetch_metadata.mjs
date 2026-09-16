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
const res = await fetch(env.MIDNIGHT_NODE_URL, {
  method: 'POST',
  headers: { 'project_id': env.BLOCKFROST_PROJECT_ID, 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'state_getMetadata', params: [] })
});
const data = await res.json();
const metadataHex = data?.result;
console.log('Metadata hex length:', metadataHex?.length);
fs.writeFileSync('d:/midnight/contracts/midnight/metadata.hex', metadataHex);
console.log('Saved metadata.hex');
