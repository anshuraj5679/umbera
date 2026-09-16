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

// nullifier as bigint: 27562524328907640443913043275345981808073460633032973399858385192177249844279
// Convert to 32-byte little-endian hex
const nullifierBigInt = 27562524328907640443913043275345981808073460633032973399858385192177249844279n;
const hex = nullifierBigInt.toString(16).padStart(64, '0');
// LE bytes = reverse each byte pair
const leHex = hex.match(/.{2}/g).reverse().join('');
console.log('Nullifier BE hex:', hex);
console.log('Nullifier LE hex:', leHex);

const q = `query {
  dustNullifierTransaction(nullifierLeBytes: "${leHex}") {
    nullifierLeBytes
    commitmentLeBytes
    transactionId
    transactionHash
    blockHeight
  }
}`;

const r = await fetch(indexerUrl, {
  method: 'POST',
  headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: q })
});
const d = await r.json();
console.log('Nullifier query result:', JSON.stringify(d, null, 2));