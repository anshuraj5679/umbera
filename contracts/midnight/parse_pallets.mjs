import fs from 'fs';

const hex = fs.readFileSync('d:/midnight/contracts/midnight/metadata.hex', 'utf8').replace(/^0x/, '');
const buf = Buffer.from(hex, 'hex');

// Look for ASCII "Midnight" and see where it appears in the pallet entries
let offset = 0;
const str = buf.toString('latin1');
while ((offset = str.indexOf('Midnight', offset)) !== -1) {
  // Check bytes around this occurrence
  const slice = buf.slice(Math.max(0, offset - 10), Math.min(buf.length, offset + 30));
  console.log('Offset:', offset, 'Hex around:', slice.toString('hex'), 'Ascii:', slice.toString('latin1').replace(/[^a-zA-Z0-9_: ]/g, '.'));
  offset += 8;
}
