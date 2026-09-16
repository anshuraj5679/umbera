import fs from 'fs';

const hex = fs.readFileSync('d:/midnight/contracts/midnight/metadata.hex', 'utf8').replace(/^0x/, '');
const buf = Buffer.from(hex, 'hex');

// In Substrate metadata v14:
// Magic number: 0x6d657461 ("meta")
// Version: 14
console.log('Magic:', buf.slice(0, 4).toString('utf8'), 'Version:', buf[4]);

// Let's search for "Error" types in the string
const str = buf.toString('latin1');
const errorMatches = [];
let offset = 0;
while ((offset = str.indexOf('Error', offset)) !== -1) {
  // Check context
  const start = Math.max(0, offset - 30);
  const end = Math.min(buf.length, offset + 150);
  const snippet = buf.slice(start, end).toString('latin1').replace(/[^a-zA-Z0-9_: ]/g, '.');
  errorMatches.push({ offset, snippet });
  offset += 5;
}

console.log(`Found ${errorMatches.length} occurrences of "Error":`);
for (const m of errorMatches.slice(0, 30)) {
  console.log(`[${m.offset}] ${m.snippet}`);
}
