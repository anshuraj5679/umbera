import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
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
const zkirDir = path.join(distDir, 'zkir');
const keysDir = path.join(distDir, 'keys');
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

const contractAddress = env.MIDNIGHT_CONTRACT_ADDRESS;
const authQuery = '?project_id=' + env.BLOCKFROST_PROJECT_ID;
const publicDataProvider = indexerPublicDataProvider(`${env.MIDNIGHT_INDEXER_URL}${authQuery}`, `${env.MIDNIGHT_INDEXER_WS_URL || 'wss://midnight-preview.blockfrost.io/api/v0/ws'}${authQuery}`);
const privateStateProvider = levelPrivateStateProvider({
  midnightDbName: `umbra-inspect-${Date.now()}`,
  accountId: 'umbra-op',
  privateStoragePasswordProvider: async () => 'umbra-inspect-pass'
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
console.log('Intents keys:', Array.from(unprovenTx.intents.keys()));
for (const [k, intent] of unprovenTx.intents) {
  console.log(`Intent ${k}:`);
  console.log('  ttl:', intent.ttl);
  console.log('  dustActions:', intent.dustActions);
  console.log('  contractActions count:', intent.contractActions?.length);
  console.log('  tokens:', intent.tokens);
}
const now = new Date();
const ttl = new Date(now.getTime() + 1800 * 1000);

for (const [k, intent] of unprovenTx.intents) {
  intent.ttl = ttl;
}

const lp = ledger.LedgerParameters.initialParameters();
const feeEstimate = unprovenTx.feesWithMargin(lp, 5);
console.log('Fee estimate:', feeEstimate.toString());

// Let's create dust spend from localState
const treeUpdates = JSON.parse(fs.readFileSync('d:/midnight/contracts/midnight/tree_updates.json', 'utf8'));
let localState = new ledger.DustLocalState(lp.dust);
const genUpdate = ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(treeUpdates.genUpdate.update, 'hex'));
localState = localState.applyGenerationCollapsedUpdate(genUpdate);
const commUpdate = ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(treeUpdates.commUpdate.update, 'hex'));
localState = localState.applyCommitmentCollapsedUpdate(commUpdate);
const rawHex = '6d69646e696768743a6576656e745b76395d3a0400c103cc01793be7ee36a6c94b0aa951c26fc95a6f4567b4f40691819afc555d00c85c00000100050fffaf68efc3920a735ce2e6097a85648610ab426b50e26cd44286cf0cde9c9da05a00da5f6015580673b703f51df0fc04830c92098e354ccd5ccaf1cf6fa35fabf7088707239d6a012300034aa39b6a98ed47b7e048b309aec26fdd52d3cf18a7d4e3fd463d35f6d215e097e3083906aa9205000700f2052a01735ce2e6097a85648610ab426b50e26cd44286cf0cde9c9da05a00da5f6015580698ed47b7e048b309aec26fdd52d3cf18a7d4e3fd463d35f6d215e097e308390613ffffffffffffffffedbf0362a39b6a';
localState = localState.replayRawEvents(dustSecretKey, Buffer.from(rawHex, 'hex')).state;
const dustUtxo = localState.utxos[0];

const [, dustSpend] = localState.spend(dustSecretKey, dustUtxo, feeEstimate, now);
const dustActions = new ledger.DustActions('signature', 'pre-proof', now, [dustSpend], []);
const feeIntent = ledger.Intent.new(ttl);
feeIntent.dustActions = dustActions;

console.log('\n--- Testing fee with tag: guaranteedOnly AND dustActions ---');
try {
  const feeTx = ledger.Transaction.fromParts('preview').addIntent({ tag: 'guaranteedOnly' }, feeIntent);
  const merged = unprovenTx.merge(feeTx);
  console.log('Merged segments:', Array.from(merged.intents.keys()));
  console.log('Imbalances for seg 0 with feeEstimate:', merged.imbalances(0, feeEstimate));

  // Check wellFormed locally!
  const blank = ledger.LedgerState.blank('preview');
  const strictness = new ledger.WellFormedStrictness();
  console.log('Testing wellFormed on unproven merged tx...');
  // Well formed on unproven requires proofs, but let's check imbalances
} catch (e) {
  console.log('Error:', e.message);
}
