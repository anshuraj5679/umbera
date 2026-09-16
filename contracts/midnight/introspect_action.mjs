import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('d:/midnight/.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => l.trim().split('=')));
const r = await fetch(env.MIDNIGHT_INDEXER_URL, {
  method: 'POST',
  headers: { 'project_id': env.BLOCKFROST_PROJECT_ID, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: `query {
      __type(name: "ContractAction") {
        fields {
          name
        }
      }
    }`
  })
});
const d = await r.json();
console.log(d.data?.__type?.fields?.map(f => f.name));
