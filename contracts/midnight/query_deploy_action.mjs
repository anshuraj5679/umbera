import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('d:/midnight/.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => l.trim().split('=')));
const r = await fetch(env.MIDNIGHT_INDEXER_URL, {
  method: 'POST',
  headers: { 'project_id': env.BLOCKFROST_PROJECT_ID, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: `query {
      contractAction(address: "3813ef0145c64237d34584141af8e11b4f4b3a8b29e4ab864fec4aed31880934") {
        address
        transaction {
          id
          hash
          block {
            height
            hash
          }
        }
      }
    }`
  })
});
console.log(JSON.stringify(await r.json(), null, 2));
