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
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
        env[trimmed.slice(0, eqIdx).trim()] = val;
      }
    }
  }
  return env;
}

const env = loadEnv();
const rHash = await fetch(env.MIDNIGHT_NODE_URL, {
  method: 'POST',
  headers: { 'project_id': env.BLOCKFROST_PROJECT_ID, 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chain_getBlockHash', params: [884520] })
});
const dHash = await rHash.json();
console.log('Block 884520 hash:', dHash.result);

const rBlock = await fetch(env.MIDNIGHT_NODE_URL, {
  method: 'POST',
  headers: { 'project_id': env.BLOCKFROST_PROJECT_ID, 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chain_getBlock', params: [dHash.result] })
});
const dBlock = await rBlock.json();
for (let i = 0; i < dBlock.result.block.extrinsics.length; i++) {
  const ext = dBlock.result.block.extrinsics[i];
  console.log(`Extrinsic ${i} length: ${ext.length}, start: ${ext.slice(0, 50)}`);
  const buf = Buffer.from(ext.replace(/^0x/, ''), 'hex');
  console.log(`Extrinsic ${i} buffer hex: ${buf.slice(0, 20).toString('hex')}`);
  console.log(`Extrinsic ${i} ascii: ${buf.slice(0, 40).toString('latin1').replace(/[^a-zA-Z0-9_: -]/g, '.')}`);
}
