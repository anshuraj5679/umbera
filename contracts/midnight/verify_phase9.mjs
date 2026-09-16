import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { createUnprovenCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { SecretKeys } from '@midnight-ntwrk/zswap';
import { LedgerParameters, Transaction } from '@midnight-ntwrk/ledger-v8';

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
const distDir = path.join(REPO_ROOT, 'contracts/midnight/dist');
const zkirDir = path.join(distDir, 'zkir');
const keysDir = path.join(distDir, 'keys');

console.log('=== PHASE 9: TRANSACTION TESTS (PRE-BROADCAST AUDIT) ===\n');
console.log('Target Deployed Contract:', CONTRACT_ADDRESS);
console.log('Proof Server:', PROOF_SERVER_URL);
console.log('RULE: STOP BEFORE BROADCAST. No transactions will be broadcast to Preview network.\n');

// 1. Initialize Providers
const zkConfigProvider = {
  async getZKIR(id) {
    const bz = path.join(zkirDir, `${id}.bzkir`);
    const z = path.join(zkirDir, `${id}.zkir`);
    return new Uint8Array(fs.readFileSync(fs.existsSync(bz) ? bz : z));
  },
  async getProverKey(id) { return new Uint8Array(fs.readFileSync(path.join(keysDir, `${id}.prover`))); },
  async getVerifierKey(id) { return new Uint8Array(fs.readFileSync(path.join(keysDir, `${id}.verifier`))); },
  async get(id) {
    const [zkir, proverKey, verifierKey] = await Promise.all([this.getZKIR(id), this.getProverKey(id), this.getVerifierKey(id)]);
    return { zkir, proverKey, verifierKey };
  }
};

const proofProvider = httpClientProofProvider(PROOF_SERVER_URL, zkConfigProvider);
const blockfrostKey = rootEnv.BLOCKFROST_PROJECT_ID;
const indexerBaseUrl = rootEnv.MIDNIGHT_INDEXER_URL || 'https://midnight-preview.blockfrost.io/api/v0';
const wsBaseUrl = rootEnv.MIDNIGHT_INDEXER_WS_URL || 'wss://midnight-preview.blockfrost.io/api/v0/ws';
const authQuery = '?project_id=' + blockfrostKey;
const publicDataProvider = indexerPublicDataProvider(`${indexerBaseUrl}${authQuery}`, `${wsBaseUrl}${authQuery}`);

const privateStateProvider = levelPrivateStateProvider({
  midnightDbName: `phase9-test-${Date.now()}`,
  accountId: 'phase9-tester',
  privateStoragePasswordProvider: async () => 'phase9-test-secure-key-16chars'
});
privateStateProvider.setContractAddress(CONTRACT_ADDRESS);

const dummyKeys = SecretKeys.fromSeed(new Uint8Array(32).fill(0x77));
const walletProvider = {
  getCoinPublicKey: () => dummyKeys.coinPublicKey,
  getEncryptionPublicKey: () => dummyKeys.encryptionPublicKey
};

// 2. Load Compiled Contract
const contractBundle = path.join(distDir, 'contract/index.js');
const contractModule = await import(pathToFileURL(contractBundle).href);
let compiledContract = CompiledContract.make('umbra', contractModule.Contract);
compiledContract = CompiledContract.withVacantWitnesses(compiledContract);
compiledContract = CompiledContract.withCompiledFileAssets(compiledContract, distDir);

const transactionalCircuits = [
  {
    name: 'submitOrder',
    args: [new Uint8Array(32).fill(0x01), 1n],
    description: 'Registers 32-byte order commitment for batch 1',
    isTransactional: true
  },
  {
    name: 'cancelOrder',
    args: [Buffer.from('2505384e1285f13b32d6b65924642855e071cbcd0176a5095074a7cd11e36e50', 'hex'), new Uint8Array(32).fill(0x02)],
    description: 'Cancels active order commitment with nullifier',
    isTransactional: true
  },
  {
    name: 'closeBatch',
    args: [1n],
    description: 'Operator closes batch 1 and advances batch counter',
    isTransactional: true
  },
  {
    name: 'publishMatchResult',
    args: [1n, new Uint8Array(32).fill(0x03), Array.from({ length: 32 }, () => new Uint8Array(32).fill(0x01))],
    description: 'Operator publishes settlement root and matched commitments',
    isTransactional: true
  },
  {
    name: 'settleBatch',
    args: [1n],
    description: 'Operator finalizes batch settlement',
    isTransactional: true
  },
  {
    name: 'verifyOrderStatus',
    args: [Buffer.from('2505384e1285f13b32d6b65924642855e071cbcd0176a5095074a7cd11e36e50', 'hex')],
    description: 'Queries status of order commitment',
    isTransactional: false
  },
  {
    name: 'isNullifierSpent',
    args: [new Uint8Array(32).fill(0xaa)],
    description: 'Checks if nullifier is spent (replay check)',
    isTransactional: false
  }
];

const results = {};

for (const c of transactionalCircuits) {
  console.log(`--- Testing Circuit: ${c.name} ---`);
  console.log(`Description: ${c.description}`);
  
  const circuitResult = {
    transactionConstructed: 'NO',
    proofGenerated: 'NO',
    bindingFinalization: 'NO',
    feeCalculated: 'N/A',
    broadcastRequired: c.isTransactional ? 'YES' : 'NO',
    error: null
  };

  try {
    // Attempt constructing unproven call transaction against the deployed contract
    const unsubmittedCallTxData = await createUnprovenCallTx(
      { zkConfigProvider, publicDataProvider, walletProvider, privateStateProvider },
      {
        compiledContract,
        circuitId: c.name,
        contractAddress: CONTRACT_ADDRESS,
        args: c.args
      }
    );

    circuitResult.transactionConstructed = 'YES';
    console.log('   [OK] Unproven transaction constructed successfully.');

    // Now test proving on proof server (STOP BEFORE BROADCAST)
    const unprovenTx = unsubmittedCallTxData.private.unprovenTx;
    console.log('   Generating ZK proof via localhost:6300 proof server...');
    const provenTx = await proofProvider.proveTx(unprovenTx);
    circuitResult.proofGenerated = 'YES';
    console.log('   [OK] ZK proof generated successfully!');

    // Test binding / finalization
    const boundTx = provenTx.bind();
    circuitResult.bindingFinalization = 'YES';
    console.log('   [OK] Transaction binding finalized.');

    // Calculate fees
    const lp = LedgerParameters.initialParameters();
    const fee = unprovenTx.feesWithMargin(lp, 5);
    circuitResult.feeCalculated = `${fee.toString()} fee units (~${(Number(fee) / 1e7).toFixed(4)} DUST)`;
    console.log(`   [OK] Estimated fee: ${circuitResult.feeCalculated}`);

  } catch (err) {
    circuitResult.error = err.message;
    console.log(`   [Precondition Assertion]: ${err.message}`);
  }

  results[c.name] = circuitResult;
  console.log(`Summary for ${c.name}:`);
  console.log(`  - transaction constructed: ${circuitResult.transactionConstructed}`);
  console.log(`  - proof generated:         ${circuitResult.proofGenerated}`);
  console.log(`  - binding/finalization:    ${circuitResult.bindingFinalization}`);
  console.log(`  - fee calculated:          ${circuitResult.feeCalculated}`);
  console.log(`  - broadcast required:      ${circuitResult.broadcastRequired}`);
  if (circuitResult.error) {
    console.log(`  - error / invariant note:  ${circuitResult.error}`);
  }
  console.log();
}

console.log('=== PHASE 9 SUMMARY TABLE ===');
for (const [name, res] of Object.entries(results)) {
  console.log(`${name.padEnd(20)} | TxConstructed: ${res.transactionConstructed.padEnd(3)} | Proved: ${res.proofGenerated.padEnd(3)} | Bound: ${res.bindingFinalization.padEnd(3)} | BroadcastReq: ${res.broadcastRequired} | Error: ${res.error || 'None'}`);
}
