import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { createPrivateOrder, computeOrderCommitment, computeOrderNullifier, generateSalt, PRIVACY_CLASSIFICATION } from '../../frontend/midnight/privacy.ts';
import fs from 'fs';
import path from 'path';

console.log('=== PHASE 8: PRIVATE STATE ARCHITECTURE AUDIT ===\n');

// 1. Test Private Order Commitment & Nullifier Generation
console.log('1. Testing Private Order Commitment & Nullifier Computation:');

const salt1 = generateSalt();
const salt2 = generateSalt();
console.log('   Generated Salt 1:', salt1.slice(0, 18) + '...');
console.log('   Generated Salt 2:', salt2.slice(0, 18) + '...');
const saltUnique = salt1 !== salt2;
console.log('   Salt uniqueness check:', saltUnique ? 'PASS' : 'FAIL');

const orderInput1 = {
  side: 0, // BUY
  amount: 1000000n, // 1M units
  limitPrice: 25000000n,
  remainingAmount: 1000000n,
  salt: salt1,
};

const orderState1 = createPrivateOrder(orderInput1);
console.log('   Order 1 Commitment:', orderState1.commitment);
console.log('   Order 1 Nullifier: ', orderState1.nullifier);

// Check determinism: recomputing with same inputs gives identical values
const recomputedCommitment = computeOrderCommitment(orderInput1);
const recomputedNullifier = computeOrderNullifier(orderState1.commitment, orderInput1.salt);
const isDeterministic = 
  recomputedCommitment === orderState1.commitment &&
  recomputedNullifier === orderState1.nullifier;
console.log('   Determinism check:', isDeterministic ? 'PASS' : 'FAIL');

// Check collision resistance: same order params but different salt gives completely different commitment & nullifier
const orderInput2 = { ...orderInput1, salt: salt2 };
const orderState2 = createPrivateOrder(orderInput2);
const isHiding = 
  orderState1.commitment !== orderState2.commitment &&
  orderState1.nullifier !== orderState2.nullifier;
console.log('   ZK Commitment Hiding check (different salts -> distinct commitments):', isHiding ? 'PASS' : 'FAIL');

// 2. Test Private State Provider (Persistence, Retrieval, Update, Removal)
console.log('\n2. Testing LevelDB PrivateStateProvider Lifecycle:');

const testDbPath = path.resolve('test-private-state-db');
const privateStateProvider = levelPrivateStateProvider({
  midnightDbName: 'test-umbra-private-store',
  accountId: 'trader-01-preview',
  privateStoragePasswordProvider: async () => 'secure-pass-16chars-min'
});

const STATE_KEY = 'order_0x11223344';
const initialPrivatePayload = {
  commitment: orderState1.commitment,
  nullifier: orderState1.nullifier,
  privateInput: {
    side: orderInput1.side,
    amount: orderInput1.amount.toString(),
    limitPrice: orderInput1.limitPrice.toString(),
    salt: orderInput1.salt,
  },
  status: 'ACTIVE'
};

// Set contract address for proper scoping
privateStateProvider.setContractAddress('3813ef0145c64237d34584141af8e11b4f4b3a8b29e4ab864fec4aed31880934');

// Set state
await privateStateProvider.set(STATE_KEY, initialPrivatePayload);
console.log('   - State stored in encrypted provider: OK');

// Get state
const retrievedState = await privateStateProvider.get(STATE_KEY);
const retrieveMatches = 
  retrievedState !== null &&
  retrievedState.commitment === initialPrivatePayload.commitment &&
  retrievedState.nullifier === initialPrivatePayload.nullifier;
console.log('   - State retrieved and decrypted:     ', retrieveMatches ? 'PASS' : 'FAIL');

// Update state
const updatedPrivatePayload = { ...initialPrivatePayload, status: 'MATCHED' };
await privateStateProvider.set(STATE_KEY, updatedPrivatePayload);
const retrievedUpdated = await privateStateProvider.get(STATE_KEY);
const updateMatches = retrievedUpdated?.status === 'MATCHED';
console.log('   - State update to MATCHED:           ', updateMatches ? 'PASS' : 'FAIL');

// Remove state
await privateStateProvider.remove(STATE_KEY);
const retrievedAfterRemove = await privateStateProvider.get(STATE_KEY);
const removeMatches = retrievedAfterRemove === null || retrievedAfterRemove === undefined;
console.log('   - State removal:                     ', removeMatches ? 'PASS' : 'FAIL');

// 3. Verify Privacy Classification Boundaries
console.log('\n3. Verifying Privacy Classification Model:');
console.log('   Local Private State (Client-only, encrypted):');
for (const p of PRIVACY_CLASSIFICATION.private) {
  console.log(`     * ${p}`);
}
console.log('   Public On-Chain Ledger State (Visible on Preview block explorer):');
for (const p of PRIVACY_CLASSIFICATION.public) {
  console.log(`     * ${p}`);
}
console.log('   Verifiable ZK Invariants (Enforced by Compact circuits):');
for (const p of PRIVACY_CLASSIFICATION.verifiable) {
  console.log(`     * ${p}`);
}

const privacyArchitectureValid = 
  PRIVACY_CLASSIFICATION.private.includes('Order side (BUY/SELL)') &&
  PRIVACY_CLASSIFICATION.private.includes('Limit price') &&
  PRIVACY_CLASSIFICATION.public.includes('Order commitment (hash)') &&
  PRIVACY_CLASSIFICATION.public.includes('Batch ID');

console.log('   Privacy classification audit:', privacyArchitectureValid ? 'PASS' : 'FAIL');

console.log('\n=== PHASE 8 SUMMARY ===');
const p8Pass = saltUnique && isDeterministic && isHiding && retrieveMatches && updateMatches && removeMatches && privacyArchitectureValid;
console.log('Private State Phase:', p8Pass ? 'PASS' : 'FAIL');
