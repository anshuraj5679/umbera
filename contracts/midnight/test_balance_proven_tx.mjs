import * as ledger from '@midnight-ntwrk/ledger-v8';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { createUnprovenDeployTx } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { SecretKeys } from '@midnight-ntwrk/zswap';
import bip39 from 'bip39';
import { HDKey } from 'file:///D:/midnight/frontend/node_modules/.pnpm/node_modules/@scure/bip32/lib/esm/index.js';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

setNetworkId('preview');

function loadEnv() {
  const envPath = 'd:/midnight/.env';
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
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
  async getZKIR(circuitId) {
    const bzkirPath = path.join(zkirDir, `${circuitId}.bzkir`);
    const zkirPath = path.join(zkirDir, `${circuitId}.zkir`);
    const filePath = fs.existsSync(bzkirPath) ? bzkirPath : zkirPath;
    return new Uint8Array(fs.readFileSync(filePath));
  },
  async getProverKey(circuitId) {
    return new Uint8Array(fs.readFileSync(path.join(keysDir, `${circuitId}.prover`)));
  },
  async getVerifierKey(circuitId) {
    return new Uint8Array(fs.readFileSync(path.join(keysDir, `${circuitId}.verifier`)));
  },
  async get(circuitId) {
    const [zkir, proverKey, verifierKey] = await Promise.all([
      this.getZKIR(circuitId),
      this.getProverKey(circuitId),
      this.getVerifierKey(circuitId)
    ]);
    return { zkir, proverKey, verifierKey };
  }
};

const proofProvider = httpClientProofProvider('http://localhost:6300', zkConfigProvider);

const privateStateProvider = levelPrivateStateProvider({
  midnightDbName: 'umbra-test-private-state',
  accountId: 'umbra-deployer',
  privateStoragePasswordProvider: async () => 'test-pass'
});

const walletProvider = {
  getCoinPublicKey: () => deployerKeys.coinPublicKey,
  getEncryptionPublicKey: () => deployerKeys.encryptionPublicKey
};

// Shims from deploy.mjs
const initialLedgerParams = ledger.LedgerParameters.initialParameters();
if (ledger.Transaction?.prototype?.fees) {
  const origTxFees = ledger.Transaction.prototype.fees;
  ledger.Transaction.prototype.fees = function(params) {
    try {
      return origTxFees.call(this, initialLedgerParams);
    } catch {
      return origTxFees.call(this, params);
    }
  };
}

const contractBundle = path.join(distDir, 'contract/index.js');
const contractModule = await import(pathToFileURL(contractBundle).href);
let compiledContract = CompiledContract.make('umbra', contractModule.Contract);
compiledContract = CompiledContract.withVacantWitnesses(compiledContract);
compiledContract = CompiledContract.withCompiledFileAssets(compiledContract, distDir);

console.log('1. Creating unproven deploy tx...');
const unprovenDeployTxData = await createUnprovenDeployTx(
  { zkConfigProvider, walletProvider, privateStateProvider },
  { compiledContract }
);

console.log('2. Proving unproven deploy tx (simulating submitTxCore step 1)...');
const provenDeployTx = await proofProvider.proveTx(unprovenDeployTxData.private.unprovenTx);
console.log('Proven deploy tx identifiers:', provenDeployTx.identifiers());

console.log('3. Now simulating walletProvider.balanceTx(provenDeployTx)...');
// Load DUST state
const lp = ledger.LedgerParameters.initialParameters();
let localState = new ledger.DustLocalState(lp.dust);

const treeUpdates = JSON.parse(fs.readFileSync('d:/midnight/contracts/midnight/tree_updates.json', 'utf8'));
const genUpdate = ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(treeUpdates.genUpdate.update, 'hex'));
localState = localState.applyGenerationCollapsedUpdate(genUpdate);

const commUpdate = ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(treeUpdates.commUpdate.update, 'hex'));
localState = localState.applyCommitmentCollapsedUpdate(commUpdate);

const rawHex = '6d69646e696768743a6576656e745b76395d3a0400c103cc01793be7ee36a6c94b0aa951c26fc95a6f4567b4f40691819afc555d00c85c00000100050fffaf68efc3920a735ce2e6097a85648610ab426b50e26cd44286cf0cde9c9da05a00da5f6015580673b703f51df0fc04830c92098e354ccd5ccaf1cf6fa35fabf7088707239d6a012300034aa39b6a98ed47b7e048b309aec26fdd52d3cf18a7d4e3fd463d35f6d215e097e3083906aa9205000700f2052a01735ce2e6097a85648610ab426b50e26cd44286cf0cde9c9da05a00da5f6015580698ed47b7e048b309aec26fdd52d3cf18a7d4e3fd463d35f6d215e097e308390613ffffffffffffffffedbf0362a39b6a';
const res = localState.replayRawEvents(dustSecretKey, Buffer.from(rawHex, 'hex'));
localState = res.state;
const dustUtxo = localState.utxos[0];

const now = new Date();
const ttl = new Date(now.getTime() + 3600 * 1000);

// Fee needed
const requiredFee = provenDeployTx.fees(initialLedgerParams);
console.log('Required fee from proven tx:', requiredFee.toString());

// Calculate fee with margin
const feeWithMargin = provenDeployTx.feesWithMargin(initialLedgerParams, 5);
console.log('Fee with margin:', feeWithMargin.toString());

// Spend from dust state
const [newState, dustSpend] = localState.spend(dustSecretKey, dustUtxo, feeWithMargin, now);
console.log('Dust spend created. vFee:', dustSpend.vFee.toString());

const dustActions = new ledger.DustActions('signature', 'pre-proof', now, [dustSpend], []);
const feeIntent = ledger.Intent.new(ttl);
feeIntent.dustActions = dustActions;

// Construct fee transaction
const feeTx = ledger.Transaction.fromParts('preview').addIntent({ tag: 'specific', value: 1 }, feeIntent);

// Option A: Merge provenDeployTx with feeTx
console.log('Merging provenDeployTx with feeTx...');
const mergedTx = provenDeployTx.merge(feeTx);
console.log('Merged tx intents:', Array.from(mergedTx.intents.keys()));
console.log('Merged tx fees:', mergedTx.fees(initialLedgerParams).toString());

// Now prove the merged tx
console.log('Proving merged tx via proofProvider.proveTx...');
const fullyProvenTx = await proofProvider.proveTx(mergedTx);
console.log('Fully proven tx created!');
console.log('Serialized size:', fullyProvenTx.serialize().length, 'bytes');
console.log('Identifiers:', fullyProvenTx.identifiers());
console.log('Coin imbalances:', fullyProvenTx.imbalances(0, feeWithMargin));
