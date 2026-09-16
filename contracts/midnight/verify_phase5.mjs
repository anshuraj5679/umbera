import path from 'path';
import { fileURLToPath } from 'url';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { Contract, ledger } from './dist/contract/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

setNetworkId('preview');

console.log('=== PHASE 5: CONTRACT BINDING AUDIT ===\n');

import fs from 'fs';
const rootEnvLines = fs.readFileSync(path.join(REPO_ROOT, '.env'), 'utf8').split('\n');
const DEPLOYED_ADDRESS = rootEnvLines.find(l => l.startsWith('MIDNIGHT_CONTRACT_ADDRESS='))?.split('=')[1]?.trim() || '3813ef0145c64237d34584141af8e11b4f4b3a8b29e4ab864fec4aed31880934';

// 1. Check frontend configured address
console.log('1. Verifying frontend contract address binding:');
const frontendEnv = await import('dotenv').then(d => {
  const env = {};
  const fs = import('fs');
  return env;
}).catch(() => ({}));

// Read frontend/.env.local directly
const envLines = fs.readFileSync(path.join(REPO_ROOT, 'frontend/.env.local'), 'utf8').split('\n');
let frontendAddress = '';
for (const line of envLines) {
  if (line.startsWith('NEXT_PUBLIC_MIDNIGHT_CONTRACT_ADDRESS=')) {
    frontendAddress = line.split('=')[1].trim();
  }
}
console.log('   Expected Address: ', DEPLOYED_ADDRESS);
console.log('   Frontend Address: ', frontendAddress);
const addressMatch = frontendAddress === DEPLOYED_ADDRESS;
console.log('   Address Match:    ', addressMatch ? 'PASS' : 'FAIL');

// 2. Instantiate Compact Contract Class
console.log('\n2. Instantiating compiled Contract class:');
const contractInstance = new Contract({});
console.log('   Contract instance created:', !!contractInstance);

const expectedCircuits = [
  'submitOrder',
  'cancelOrder',
  'closeBatch',
  'publishMatchResult',
  'settleBatch',
  'verifyOrderStatus',
  'isNullifierSpent'
];

console.log('\n3. Verifying circuit method accessibility on generated contract:');
let allCircuitsAccessible = true;
for (const circuit of expectedCircuits) {
  const inCircuits = typeof contractInstance.circuits[circuit] === 'function';
  const inImpure = typeof contractInstance.impureCircuits[circuit] === 'function';
  const inProvable = typeof contractInstance.provableCircuits[circuit] === 'function';
  const ok = inCircuits && inImpure && inProvable;
  if (!ok) allCircuitsAccessible = false;
  console.log(`   - ${circuit.padEnd(20)} | circuits: ${inCircuits ? 'OK' : 'MISSING'} | impure: ${inImpure ? 'OK' : 'MISSING'} | provable: ${inProvable ? 'OK' : 'MISSING'}`);
}

// 4. Verify frontend createUmbraContract binding
console.log('\n4. Verifying frontend createUmbraContract binding:');
const { createUmbraContract } = await import('../../frontend/midnight/contract.ts');
const frontendContract = await createUmbraContract(DEPLOYED_ADDRESS, { ready: true });
let frontendCircuitsAccessible = true;
for (const circuit of expectedCircuits) {
  const fn = frontendContract[circuit];
  const ok = typeof fn === 'function';
  if (!ok) frontendCircuitsAccessible = false;
  console.log(`   - Frontend method [${circuit.padEnd(20)}]: ${ok ? 'ACCESSIBLE' : 'MISSING'}`);
}

console.log('\n=== PHASE 5 SUMMARY ===');
const p5Pass = addressMatch && allCircuitsAccessible && frontendCircuitsAccessible;
console.log('Contract Binding Phase:', p5Pass ? 'PASS' : 'FAIL');
