import fs from 'fs';
import * as ledger from '@midnight-ntwrk/ledger-v8';

const bytes = new Uint8Array(fs.readFileSync('d:/midnight/contracts/midnight/proven_deploy_tx.bin'));
const provenTx = ledger.Transaction.deserialize('signature', 'proof', 'pre-binding', bytes);
const boundTx = provenTx.bind();
const blank = ledger.LedgerState.blank('preview');
const strictness = new ledger.WellFormedStrictness();

const ctime = new Date('2026-09-16T06:11:08.000Z');
console.log('Testing wellFormed with different tblock values relative to ctime:');

for (const diffSec of [-60, -30, -10, -5, 0, 5, 10, 60, 300, 600, 1800, 3600, 7200, 10800, 14400]) {
  const tblock = new Date(ctime.getTime() + diffSec * 1000);
  try {
    const v = boundTx.wellFormed(blank, strictness, tblock);
    console.log(`diff ${diffSec}s (${tblock.toISOString()}): OK`);
  } catch (e) {
    console.log(`diff ${diffSec}s (${tblock.toISOString()}): ERROR: ${e.message}`);
  }
}
