import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

setNetworkId('preview');

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        env[trimmed.slice(0, eqIdx).trim()] = val;
      }
    }
  }
  return env;
}

const rootEnv = loadEnv(path.join(REPO_ROOT, '.env'));
const frontendEnv = loadEnv(path.join(REPO_ROOT, 'frontend/.env.local'));
const EXPECTED_ADDRESS = rootEnv.MIDNIGHT_CONTRACT_ADDRESS || '3813ef0145c64237d34584141af8e11b4f4b3a8b29e4ab864fec4aed31880934';

console.log('=== PHASE 1: DEPLOYMENT VERIFICATION ===\n');

// 1. Check env configurations
console.log('1. Checking environment configurations:');
console.log('   Root .env MIDNIGHT_CONTRACT_ADDRESS:', rootEnv.MIDNIGHT_CONTRACT_ADDRESS);
console.log('   Root .env NEXT_PUBLIC_MIDNIGHT_CONTRACT_ADDRESS:', rootEnv.NEXT_PUBLIC_MIDNIGHT_CONTRACT_ADDRESS);
console.log('   Frontend .env.local NEXT_PUBLIC_MIDNIGHT_CONTRACT_ADDRESS:', frontendEnv.NEXT_PUBLIC_MIDNIGHT_CONTRACT_ADDRESS);
console.log('   Root network ID:', rootEnv.MIDNIGHT_NETWORK_ID);
console.log('   Frontend network ID:', frontendEnv.NEXT_PUBLIC_MIDNIGHT_NETWORK_ID);

const envMatch = 
  rootEnv.MIDNIGHT_CONTRACT_ADDRESS === EXPECTED_ADDRESS &&
  rootEnv.NEXT_PUBLIC_MIDNIGHT_CONTRACT_ADDRESS === EXPECTED_ADDRESS &&
  frontendEnv.NEXT_PUBLIC_MIDNIGHT_CONTRACT_ADDRESS === EXPECTED_ADDRESS &&
  rootEnv.MIDNIGHT_NETWORK_ID === 'preview' &&
  frontendEnv.NEXT_PUBLIC_MIDNIGHT_NETWORK_ID === 'preview';

console.log('   Env addresses match expected:', envMatch ? 'PASS' : 'FAIL');

// 2. Query Preview node RPC
console.log('\n2. Querying Preview Node RPC for contract state...');
const blockfrostKey = rootEnv.BLOCKFROST_PROJECT_ID;
const nodeBaseUrl = rootEnv.MIDNIGHT_NODE_URL || 'https://rpc.midnight-preview.blockfrost.io';

let nodeStateBytes = 0;
try {
  const r = await fetch(nodeBaseUrl, {
    method: 'POST',
    headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'midnight_contractState',
      params: [EXPECTED_ADDRESS]
    })
  });
  const d = await r.json();
  if (d.result) {
    nodeStateBytes = Array.isArray(d.result) ? d.result.length : (typeof d.result === 'string' ? d.result.length / 2 : 1);
    console.log(`   [PASS] Contract state exists on node RPC (type: ${typeof d.result}, size: ${nodeStateBytes})`);
  } else {
    console.log('   [FAIL] Node RPC returned no state:', d);
  }
} catch (e) {
  console.log('   [FAIL] Node RPC error:', e.message);
}

// 3. Query Indexer
console.log('\n3. Querying Preview Indexer...');
const indexerBaseUrl = rootEnv.MIDNIGHT_INDEXER_URL || 'https://midnight-preview.blockfrost.io/api/v0';
const wsBaseUrl = rootEnv.MIDNIGHT_INDEXER_WS_URL || 'wss://midnight-preview.blockfrost.io/api/v0/ws';
const authQuery = '?project_id=' + blockfrostKey;
const provider = indexerPublicDataProvider(`${indexerBaseUrl}${authQuery}`, `${wsBaseUrl}${authQuery}`);

let indexerStateFound = false;
try {
  const state = await provider.queryContractState(EXPECTED_ADDRESS);
  if (state) {
    indexerStateFound = true;
    console.log('   [PASS] Contract state found on indexer. State data present.');
    console.log('   State type:', state.constructor?.name || typeof state);
  } else {
    console.log('   [WARN] Indexer returned null state');
  }
} catch (e) {
  console.log('   [WARN] Indexer queryContractState:', e.message);
}

// 4. Verify local compiled artifacts
console.log('\n4. Verifying locally compiled artifacts & circuits:');
const distDir = path.join(REPO_ROOT, 'contracts/midnight/dist');
const zkirDir = path.join(distDir, 'zkir');
const keysDir = path.join(distDir, 'keys');
const contractBundle = path.join(distDir, 'contract/index.js');

console.log('   contract/index.js exists:', fs.existsSync(contractBundle));

const expectedCircuits = [
  'submitOrder',
  'cancelOrder',
  'closeBatch',
  'publishMatchResult',
  'settleBatch',
  'verifyOrderStatus',
  'isNullifierSpent'
];

let allCircuitsPresent = true;
for (const c of expectedCircuits) {
  const bzkir = path.join(zkirDir, `${c}.bzkir`);
  const zkir = path.join(zkirDir, `${c}.zkir`);
  const prover = path.join(keysDir, `${c}.prover`);
  const verifier = path.join(keysDir, `${c}.verifier`);
  
  const hasZkir = fs.existsSync(bzkir) || fs.existsSync(zkir);
  const hasProver = fs.existsSync(prover);
  const hasVerifier = fs.existsSync(verifier);
  
  console.log(`   - Circuit: ${c.padEnd(20)} | ZKIR: ${hasZkir ? 'OK' : 'MISSING'} | ProverKey: ${hasProver ? 'OK' : 'MISSING'} | VerifierKey: ${hasVerifier ? 'OK' : 'MISSING'}`);
  if (!hasZkir || !hasProver || !hasVerifier) allCircuitsPresent = false;
}

console.log('\n=== PHASE 1 SUMMARY ===');
console.log('Env configuration:', envMatch ? 'PASS' : 'FAIL');
console.log('Node state verification:', nodeStateBytes > 0 ? 'PASS' : 'FAIL');
console.log('Indexer state verification:', indexerStateFound ? 'PASS' : 'FAIL');
console.log('All 7 circuits and keys present:', allCircuitsPresent ? 'PASS' : 'FAIL');
