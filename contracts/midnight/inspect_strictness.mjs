import fs from 'fs';
import * as ledger from '@midnight-ntwrk/ledger-v8';

const lp = ledger.LedgerParameters.initialParameters();
const blank = ledger.LedgerState.blank('preview');
const strictness = new ledger.WellFormedStrictness();

console.log('Strictness properties:', Object.getOwnPropertyNames(strictness));
console.log('Strictness proto:', Object.getOwnPropertyNames(Object.getPrototypeOf(strictness)));
