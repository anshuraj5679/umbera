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
import { LedgerParameters } from '@midnight-ntwrk/ledger-v8';

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
const CONTRACT_ADDRESS = '6a081726fa0a8114f197df795f487146527189fcd38446e218f2b8d80f0cf7ee';
const PROOF_SERVER_URL = 'http://localhost:6300';
const distDir = path.resolve(__dirname, 'dist');
const zkirDir = path.join(distDir, 'zkir');
const keysDir = path.join(distDir, 'keys');

const zkConfigProvider = {
  async getZKIR(id) {
    const bz = path.join(zkirDir, id + '.bzkir');
    const z = path.join(zkirDir, id + '.zkir');
    return new Uint8Array(fs.readFileSync(fs.existsSync(bz) ? bz : z));
  },
  async getProverKey(id) { return new Uint8Array(fs.readFileSync(path.join(keysDir, id + '.prover'))); },
  async getVerifierKey(id) { return new Uint8Array(fs.readFileSync(path.join(keysDir, id + '.verifier'))); },
  async get(id) {
    const [zkir, proverKey, verifierKey] = await Promise.all([this.getZKIR(id), this.getProverKey(id), this.getVerifierKey(id)]);
    return { zkir, proverKey, verifierKey };
  }
};

const proofProvider = httpClientProofProvider(PROOF_SERVER_URL, zkConfigProvider);
const publicDataProvider = indexerPublicDataProvider(
  'https://midnight-preview.blockfrost.io/api/v0?project_id=' + rootEnv.BLOCKFROST_PROJECT_ID,
  'wss://midnight-preview.blockfrost.io/api/v0/ws?project_id=' + rootEnv.BLOCKFROST_PROJECT_ID
);

const privateStateProvider = levelPrivateStateProvider({
  midnightDbName: 'test-nullifier-db-' + Date.now(),
  accountId: 'test-user',
  privateStoragePasswordProvider: async () => 'test-pass-16chars-secure'
});
privateStateProvider.setContractAddress(CONTRACT_ADDRESS);

const dummyKeys = SecretKeys.fromSeed(new Uint8Array(32).fill(0x55));
const walletProvider = {
  getCoinPublicKey: () => dummyKeys.coinPublicKey,
  getEncryptionPublicKey: () => dummyKeys.encryptionPublicKey
};

const contractBundle = path.join(distDir, 'contract/index.js');
const contractModule = await import(pathToFileURL(contractBundle).href);
let compiledContract = CompiledContract.make('umbra', contractModule.Contract);
compiledContract = CompiledContract.withVacantWitnesses(compiledContract);
compiledContract = CompiledContract.withCompiledFileAssets(compiledContract, distDir);

console.log('Testing createUnprovenCallTx for isNullifierSpent...');
try {
  const dummyNullifier = new Uint8Array(32).fill(0xaa);
  const txData = await createUnprovenCallTx(
    { zkConfigProvider, publicDataProvider, walletProvider, privateStateProvider },
    {
      compiledContract,
      circuitId: 'isNullifierSpent',
      contractAddress: CONTRACT_ADDRESS,
      args: [dummyNullifier]
    }
  );
  console.log('[SUCCESS] unprovenTx created for isNullifierSpent!');
  console.log('unprovenTx present:', !!txData.private.unprovenTx);
  console.log('Circuit result:', txData.result);

  console.log('Generating proof on proof server...');
  const provenTx = await proofProvider.proveTx(txData.private.unprovenTx);
  console.log('[SUCCESS] Proof generated for isNullifierSpent!');

  const boundTx = provenTx.bind();
  console.log('[SUCCESS] Transaction bound!');

  const lp = LedgerParameters.initialParameters();
  const fee = txData.private.unprovenTx.feesWithMargin(lp, 5);
  console.log('Fee calculated:', fee.toString(), `(~${(Number(fee)/1e7).toFixed(4)} DUST)`);
} catch (e) {
  console.log('[ERROR]:', e.message);
}
