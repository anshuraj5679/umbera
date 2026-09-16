import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { verifyContractState } from '@midnight-ntwrk/midnight-js-contracts';

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
const CONTRACT_ADDRESS = rootEnv.MIDNIGHT_CONTRACT_ADDRESS || '3813ef0145c64237d34584141af8e11b4f4b3a8b29e4ab864fec4aed31880934';
const PROOF_SERVER_URL = 'http://localhost:6300';

console.log('=== PHASE 7: ZK / PROOF VALIDATION AUDIT ===\n');

// 1. Check Proof Server Health
console.log('1. Checking Proof Server HTTP Health at ' + PROOF_SERVER_URL + '...');
let proofServerHealthy = false;
try {
  const r = await fetch(PROOF_SERVER_URL);
  console.log(`   Proof server responded with HTTP status: ${r.status}`);
  if (r.status === 200 || r.status === 404 || r.status === 405) {
    proofServerHealthy = true;
    console.log('   [PASS] Proof server is reachable and active.');
  }
} catch (e) {
  console.log(`   [FAIL] Proof server unreachable: ${e.message}`);
}

// 2. Verify all circuits and their ZK artifacts
console.log('\n2. Verifying ZK artifacts for all circuits:');
const circuits = [
  'submitOrder',
  'cancelOrder',
  'closeBatch',
  'publishMatchResult',
  'settleBatch',
  'verifyOrderStatus',
  'isNullifierSpent',
  'openBatch'
];

const zkirDir = path.join(REPO_ROOT, 'contracts/midnight/dist/zkir');
const keysDir = path.join(REPO_ROOT, 'contracts/midnight/dist/keys');

const verifierKeys = [];
let allArtifactsValid = true;

for (const circuit of circuits) {
  const zkirFile = path.join(zkirDir, `${circuit}.zkir`);
  const bzkirFile = path.join(zkirDir, `${circuit}.bzkir`);
  const proverFile = path.join(keysDir, `${circuit}.prover`);
  const verifierFile = path.join(keysDir, `${circuit}.verifier`);

  const hasZkir = fs.existsSync(zkirFile) || fs.existsSync(bzkirFile);
  const zkirSize = hasZkir ? fs.statSync(fs.existsSync(bzkirFile) ? bzkirFile : zkirFile).size : 0;
  
  const hasProver = fs.existsSync(proverFile);
  const proverSize = hasProver ? fs.statSync(proverFile).size : 0;

  const hasVerifier = fs.existsSync(verifierFile);
  const verifierSize = hasVerifier ? fs.statSync(verifierFile).size : 0;

  if (hasVerifier) {
    const vkBytes = fs.readFileSync(verifierFile);
    verifierKeys.push([circuit, vkBytes]);
  }

  const ok = hasZkir && zkirSize > 0 && hasProver && proverSize > 0 && hasVerifier && verifierSize > 0;
  if (!ok) allArtifactsValid = false;

  console.log(`   Circuit [${circuit.padEnd(20)}] -> ZKIR: ${zkirSize} B | Prover: ${proverSize} B | Verifier: ${verifierSize} B | Status: ${ok ? 'OK' : 'MISSING'}`);
}

// 3. Verify verifier keys match on-chain deployed contract state!
console.log('\n3. Verifying local verifier keys match on-chain contract state:');
const blockfrostKey = rootEnv.BLOCKFROST_PROJECT_ID;
const indexerBaseUrl = rootEnv.MIDNIGHT_INDEXER_URL || 'https://midnight-preview.blockfrost.io/api/v0';
const wsBaseUrl = rootEnv.MIDNIGHT_INDEXER_WS_URL || 'wss://midnight-preview.blockfrost.io/api/v0/ws';
const authQuery = '?project_id=' + blockfrostKey;
const provider = indexerPublicDataProvider(`${indexerBaseUrl}${authQuery}`, `${wsBaseUrl}${authQuery}`);

let verifierKeysMatch = false;
try {
  const contractState = await provider.queryContractState(CONTRACT_ADDRESS);
  if (contractState) {
    // verifyContractState throws ContractTypeError if any key does not match
    verifyContractState(verifierKeys, contractState);
    verifierKeysMatch = true;
    console.log('   [PASS] verifyContractState() succeeded! All 7 circuit verifier keys EXACTLY match deployed contract on Midnight Preview!');
  } else {
    console.log('   [FAIL] Could not retrieve contract state for verification');
  }
} catch (e) {
  console.log('   [FAIL] Verifier keys mismatch error:', e.message);
}

// 4. Verify no Preview / Preprod mismatch in artifacts or config
console.log('\n4. Verifying network configuration:');
const netMatch = rootEnv.MIDNIGHT_NETWORK_ID === 'preview';
console.log('   Network ID configured:', rootEnv.MIDNIGHT_NETWORK_ID);
console.log('   Network check:', netMatch ? 'PASS (preview)' : 'FAIL');

console.log('\n=== PHASE 7 SUMMARY ===');
const p7Pass = proofServerHealthy && allArtifactsValid && verifierKeysMatch && netMatch;
console.log('ZK / Proof Validation Phase:', p7Pass ? 'PASS' : 'FAIL');
