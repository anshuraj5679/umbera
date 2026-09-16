import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { createUnprovenCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { SecretKeys } from '@midnight-ntwrk/zswap';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import bip39 from 'bip39';
import { HDKey } from 'file:///D:/midnight/frontend/node_modules/.pnpm/node_modules/@scure/bip32/lib/esm/index.js';

setNetworkId('preview');

function loadEnv() {
  const lines = fs.readFileSync('d:/midnight/.env', 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
        env[trimmed.slice(0, eqIdx).trim()] = val;
      }
    }
  }
  return env;
}

const env = loadEnv();
const seedBytes = bip39.mnemonicToSeedSync(env.MIDNIGHT_DEPLOYER_SEED.trim());
const root = HDKey.fromMasterSeed(seedBytes);
const child2 = root.derive("m/44'/2400'/0'/2/0");
const dustSecretKey = ledger.DustSecretKey.fromSeed(child2.privateKey);
const child3 = root.derive("m/44'/2400'/0'/3/0");
const deployerKeys = SecretKeys.fromSeed(child3.privateKey);

const distDir = 'd:/midnight/contracts/midnight/dist';
const zkConfigProvider = {
  async getZKIR(id) {
    const bz = path.join(distDir, 'zkir', `${id}.bzkir`);
    const z = path.join(distDir, 'zkir', `${id}.zkir`);
    return new Uint8Array(fs.readFileSync(fs.existsSync(bz) ? bz : z));
  },
  async getProverKey(id) { return new Uint8Array(fs.readFileSync(path.join(distDir, 'keys', `${id}.prover`))); },
  async getVerifierKey(id) { return new Uint8Array(fs.readFileSync(path.join(distDir, 'keys', `${id}.verifier`))); },
  async get(id) {
    const [zkir, proverKey, verifierKey] = await Promise.all([this.getZKIR(id), this.getProverKey(id), this.getVerifierKey(id)]);
    return { zkir, proverKey, verifierKey };
  }
};

const contractAddress = env.MIDNIGHT_CONTRACT_ADDRESS;
const authQuery = '?project_id=' + env.BLOCKFROST_PROJECT_ID;
const publicDataProvider = indexerPublicDataProvider(`${env.MIDNIGHT_INDEXER_URL}${authQuery}`, `${env.MIDNIGHT_INDEXER_WS_URL || 'wss://midnight-preview.blockfrost.io/api/v0/ws'}${authQuery}`);
const privateStateProvider = levelPrivateStateProvider({
  midnightDbName: `umbra-bal-${Date.now()}`,
  accountId: 'umbra-bal-op',
  privateStoragePasswordProvider: async () => 'umbra-bal-pass-16chars'
});
privateStateProvider.setContractAddress(contractAddress);

const walletProvider = {
  getCoinPublicKey: () => deployerKeys.coinPublicKey,
  getEncryptionPublicKey: () => deployerKeys.encryptionPublicKey
};

const contractBundle = path.join(distDir, 'contract/index.js');
const contractModule = await import(pathToFileURL(contractBundle).href);
let compiledContract = CompiledContract.make('umbra', contractModule.Contract);
compiledContract = CompiledContract.withVacantWitnesses(compiledContract);
compiledContract = CompiledContract.withCompiledFileAssets(compiledContract, distDir);

const unsubmittedTxData = await createUnprovenCallTx(
  { zkConfigProvider, publicDataProvider, walletProvider, privateStateProvider },
  {
    compiledContract,
    circuitId: 'submitOrder',
    contractAddress,
    args: [new Uint8Array(32), 1n]
  }
);
const unprovenTx = unsubmittedTxData.private.unprovenTx;
const callSeg = Array.from(unprovenTx.intents.keys())[0];
console.log('Call segment:', callSeg);

const lp = ledger.LedgerParameters.initialParameters();
const now = new Date();
const ttl = new Date(now.getTime() + 1800 * 1000);
const feeEstimate = unprovenTx.feesWithMargin(lp, 5);

// Build dummy spend to test imbalances
const dummySpend = new ledger.DustSpend(
  new ledger.DustProof('pre-proof'),
  116144n,
  feeEstimate,
  dustSecretKey.publicKey,
  new ledger.DustNullifier(new Uint8Array(32))
);
const dustActions = new ledger.DustActions('signature', 'pre-proof', now, [dummySpend], []);

console.log('Testing Approach A: intentCopy.dustActions = dustActions');
intentCopy.dustActions = dustActions;
console.log('UnprovenTx imbalances with attached dustActions (seg 0):', unprovenTx.imbalances(0, feeEstimate));
console.log('UnprovenTx imbalances with attached dustActions (callSeg):', unprovenTx.imbalances(callSeg, feeEstimate));

// Test Approach B: feeTx with separate intent
const feeIntent = ledger.Intent.new(ttl);
feeIntent.dustActions = dustActions;
for (const spec of [{ tag: 'first' }, { tag: 'guaranteedOnly' }, { tag: 'specific', value: 1 }]) {
  try {
    const feeTx = ledger.Transaction.fromParts('preview').addIntent(spec, feeIntent);
    const merged = unprovenTx.merge(feeTx);
    console.log(`Merge with spec ${JSON.stringify(spec)}:`);
    console.log('  segments:', Array.from(merged.intents.keys()));
    console.log('  seg 0 imbalances:', merged.imbalances(0, feeEstimate));
  } catch (e) {
    console.log(`Merge with spec ${JSON.stringify(spec)} failed:`, e.message);
  }
}

