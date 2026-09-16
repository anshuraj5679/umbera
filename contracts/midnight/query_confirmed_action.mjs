import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync('d:/midnight/.env', 'utf8').split('\n').filter(l => l.includes('=')).map(l => l.trim().split('=')));
const r = await fetch(env.MIDNIGHT_INDEXER_URL, {
  method: 'POST',
  headers: { 'project_id': env.BLOCKFROST_PROJECT_ID, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: `query {
      contractAction(address: "3813ef0145c64237d34584141af8e11b4f4b3a8b29e4ab864fec4aed31880934") {
        address
        state
        transaction {
          id
          hash
          block {
            height
            hash
            timestamp
          }
        }
      }
    }`
  })
});
const d = await r.json();
console.log('Contract action data:');
console.log('Transaction ID:   ', d.data?.contractAction?.transaction?.id);
console.log('Transaction Hash: ', d.data?.contractAction?.transaction?.hash);
console.log('Block Height:     ', d.data?.contractAction?.transaction?.block?.height);
console.log('Block Hash:       ', d.data?.contractAction?.transaction?.block?.hash);
console.log('Block Timestamp:  ', d.data?.contractAction?.transaction?.block?.timestamp);
console.log('State Length:     ', d.data?.contractAction?.state?.length, 'chars');
fs.writeFileSync('d:/midnight/contracts/midnight/confirmed_state.hex', d.data?.contractAction?.state || '');
