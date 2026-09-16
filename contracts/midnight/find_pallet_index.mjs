import fs from 'fs';

const hex = fs.readFileSync('d:/midnight/contracts/midnight/metadata.hex', 'utf8').replace(/^0x/, '');
const buf = Buffer.from(hex, 'hex');

// In Substrate metadata v14:
// Magic: "meta" (0x6174656d)
console.log('Magic:', buf.slice(0, 4).toString('utf8'));
console.log('Version:', buf[4]);

// Search for pallet names and find their indices in the metadata
const str = buf.toString('latin1');
const re = /([A-Za-z0-9_]+)pallet/g;
let m;
while ((m = re.exec(str)) !== null) {
  // Check index near the match
  console.log('Found pallet keyword near:', m.index, m[0]);
}

// Let's search for "pallet_midnight" in the metadata
const idx = str.indexOf('pallet_midnight');
console.log('pallet_midnight at:', idx);
