import * as ledger from '@midnight-ntwrk/ledger-v8';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { createUnprovenDeployTx } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { SecretKeys } from '@midnight-ntwrk/zswap';
import bip39 from 'bip39';
import { HDKey } from 'file:///D:/midnight/frontend/node_modules/.pnpm/node_modules/@scure/bip32/lib/esm/index.js';
import { WalletBuilder } from '@midnight-ntwrk/wallet';
import { LedgerParameters, Transaction, DustSecretKey } from '@midnight-ntwrk/ledger-v8';

// Ensure LedgerParameters and fee computation compatibility between @midnight-ntwrk/ledger-v8 and @midnight-ntwrk/wallet / zswap
const initialLedgerParams = LedgerParameters.initialParameters();
if (Transaction?.prototype?.fees) {
  const origTxFees = Transaction.prototype.fees;
  Transaction.prototype.fees = function(params) {
    try {
      return origTxFees.call(this, initialLedgerParams);
    } catch {
      return origTxFees.call(this, params);
    }
  };
}
if (LedgerParameters) {
  Object.defineProperty(LedgerParameters, Symbol.hasInstance, {
    value: function(inst) {
      return inst && (inst.constructor?.name === 'LedgerParameters' || inst.__wbg_ptr !== undefined);
    },
    configurable: true
  });
}

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
const coinPublicKeyHex = deployerKeys.coinPublicKey;
const encryptionPublicKeyHex = deployerKeys.encryptionPublicKey;

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

// Setup providers
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
  getCoinPublicKey: () => coinPublicKeyHex,
  getEncryptionPublicKey: () => encryptionPublicKeyHex
};

const contractBundle = path.join(distDir, 'contract/index.js');
const contractModule = await import(pathToFileURL(contractBundle).href);
let compiledContract = CompiledContract.make('umbra', contractModule.Contract);
compiledContract = CompiledContract.withVacantWitnesses(compiledContract);
compiledContract = CompiledContract.withCompiledFileAssets(compiledContract, distDir);

console.log('Constructing unproven deploy transaction...');
const unprovenDeployTxData = await createUnprovenDeployTx(
  { zkConfigProvider, walletProvider, privateStateProvider },
  { compiledContract }
);

const unprovenTx = unprovenDeployTxData.private.unprovenTx;
console.log('Unproven tx constructed. Identifiers:', unprovenTx.identifiers());

// Now let's calculate fee and attach DUST spend
const initialParams = ledger.LedgerParameters.initialParameters();
const baseFee = unprovenTx.fees(initialParams);
console.log('Base fee units:', baseFee.toString());

const now = new Date();
const ttl = new Date(now.getTime() + 3600 * 1000);

// Spend fee units covering the fee
const spendFeeUnits = 4_000_000_000_000_000n; // 4e15 (~0.3 tDUST)
const [newState, dustSpend] = localState.spend(dustSecretKey, dustUtxo, spendFeeUnits, now);
console.log('dustSpend created! vFee:', dustSpend.vFee);

const dustActions = new ledger.DustActions('signature', 'pre-proof', now, [dustSpend], []);
const feeIntent = ledger.Intent.new(ttl);
feeIntent.dustActions = dustActions;

const feeTx = ledger.Transaction.fromParts('preview').addIntent({ tag: 'specific', value: 1 }, feeIntent);
const mergedTx = unprovenTx.merge(feeTx);

console.log('Merged tx intents:', Array.from(mergedTx.intents.keys()));
console.log('Merged tx fees:', mergedTx.fees(initialParams));

console.log('Proving merged tx via proof server http://localhost:6300...');
const provenTx = await proofProvider.proveTx(mergedTx);
console.log('*** PROVEN TX GENERATED SUCCESSFULLY! ***');
console.log('Proven tx class:', provenTx.constructor.name);
console.log('Proven tx serialized length:', provenTx.serialize().length);
console.log('Proven tx identifiers:', provenTx.identifiers());
console.log('Proven tx imbalances:', provenTx.imbalances(0, spendFeeUnits));
