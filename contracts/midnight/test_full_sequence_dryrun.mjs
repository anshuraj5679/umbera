import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { createUnprovenDeployTx } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { WalletBuilder } from '@midnight-ntwrk/wallet';
import { SecretKeys } from '@midnight-ntwrk/zswap';
import { HDKey } from 'file:///D:/midnight/frontend/node_modules/.pnpm/node_modules/@scure/bip32/lib/esm/index.js';
import {
  LedgerParameters,
  Transaction,
  DustSecretKey,
  DustLocalState,
  DustStateMerkleTreeCollapsedUpdate,
  DustActions,
  Intent,
  Event as LedgerEvent
} from '@midnight-ntwrk/ledger-v8';
import bip39 from 'bip39';

setNetworkId('preview');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

function loadEnv() {
  const envPath = path.join(REPO_ROOT, '.env');
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
const initialLedgerParams = LedgerParameters.initialParameters();

// Shims
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

async function testDryRun() {
  console.log('=== Step 1 & 2: Key Derivation ===');
  const seedBytes = bip39.mnemonicToSeedSync(env.MIDNIGHT_DEPLOYER_SEED.trim());
  const root = HDKey.fromMasterSeed(seedBytes);

  const child2 = root.derive("m/44'/2400'/0'/2/0");
  const dustSecretKey = DustSecretKey.fromSeed(child2.privateKey);
  console.log('Dust Public Key:', dustSecretKey.publicKey.toString());

  const child3 = root.derive("m/44'/2400'/0'/3/0");
  const deployerKeys = SecretKeys.fromSeed(child3.privateKey);

  console.log('=== Step 3: Discover / Initialize Dust State ===');
  const treeUpdates = JSON.parse(fs.readFileSync('d:/midnight/contracts/midnight/tree_updates.json', 'utf8'));
  let localState = new DustLocalState(initialLedgerParams.dust);

  const genUpdate = DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(treeUpdates.genUpdate.update, 'hex'));
  localState = localState.applyGenerationCollapsedUpdate(genUpdate);

  const commUpdate = DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(treeUpdates.commUpdate.update, 'hex'));
  localState = localState.applyCommitmentCollapsedUpdate(commUpdate);

  const rawHex = '6d69646e696768743a6576656e745b76395d3a0400c103cc01793be7ee36a6c94b0aa951c26fc95a6f4567b4f40691819afc555d00c85c00000100050fffaf68efc3920a735ce2e6097a85648610ab426b50e26cd44286cf0cde9c9da05a00da5f6015580673b703f51df0fc04830c92098e354ccd5ccaf1cf6fa35fabf7088707239d6a012300034aa39b6a98ed47b7e048b309aec26fdd52d3cf18a7d4e3fd463d35f6d215e097e3083906aa9205000700f2052a01735ce2e6097a85648610ab426b50e26cd44286cf0cde9c9da05a00da5f6015580698ed47b7e048b309aec26fdd52d3cf18a7d4e3fd463d35f6d215e097e308390613ffffffffffffffffedbf0362a39b6a';
  const res = localState.replayRawEvents(dustSecretKey, Buffer.from(rawHex, 'hex'));
  localState = res.state;
  const dustUtxo = localState.utxos[0];
  console.log('Dust UTXO loaded. mtIndex:', dustUtxo.mtIndex);
  console.log('Available dust balance:', localState.walletBalance(new Date()));

  console.log('=== Step 4: Construct UMBRA deployment transaction ===');
  const distDir = path.join(REPO_ROOT, 'contracts/midnight/dist');
  const zkirDir = path.join(distDir, 'zkir');
  const keysDir = path.join(distDir, 'keys');
  const zkConfigProvider = {
    async getZKIR(circuitId) {
      const bzkirPath = path.join(zkirDir, `${circuitId}.bzkir`);
      const zkirPath = path.join(zkirDir, `${circuitId}.zkir`);
      return new Uint8Array(fs.readFileSync(fs.existsSync(bzkirPath) ? bzkirPath : zkirPath));
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
    midnightDbName: 'umbra-test-deployer-private-state',
    accountId: 'umbra-deployer',
    privateStoragePasswordProvider: async () => 'umbra-deployer-password'
  });

  const walletProvider = {
    getCoinPublicKey: () => deployerKeys.coinPublicKey,
    getEncryptionPublicKey: () => deployerKeys.encryptionPublicKey
  };

  const contractBundle = path.join(distDir, 'contract/index.js');
  const contractModule = await import(pathToFileURL(contractBundle).href);
  let compiledContract = CompiledContract.make('umbra', contractModule.Contract);
  compiledContract = CompiledContract.withVacantWitnesses(compiledContract);
  compiledContract = CompiledContract.withCompiledFileAssets(compiledContract, distDir);

  const unprovenDeployTxData = await createUnprovenDeployTx(
    { zkConfigProvider, walletProvider, privateStateProvider },
    { compiledContract }
  );

  const unprovenTx = unprovenDeployTxData.private.unprovenTx;
  const contractAddress = unprovenDeployTxData.public.contractAddress;
  console.log('Unproven deploy tx created!');
  console.log('Contract Address:', contractAddress);

  console.log('=== Step 5: Attach DUST fee spend ===');
  const now = new Date();
  const ttl = new Date(now.getTime() + 3600 * 1000);

  // Fee calculation
  // Let's compute fee for unprovenTx with margin
  const feeEstimate = unprovenTx.feesWithMargin(initialLedgerParams, 5);
  console.log('Fee with margin estimate:', feeEstimate.toString(), 'fee units');

  // Let's create the spend
  const [newState, dustSpend] = localState.spend(dustSecretKey, dustUtxo, feeEstimate, now);
  console.log('Dust spend created: vFee =', dustSpend.vFee.toString());

  const dustActions = new DustActions('signature', 'pre-proof', now, [dustSpend], []);
  const feeIntent = Intent.new(ttl);
  feeIntent.dustActions = dustActions;

  const usedSegments = new Set(unprovenTx.intents.keys());
  console.log('Used segments in unproven deploy tx:', Array.from(usedSegments));
  let seg = 1;
  while (usedSegments.has(seg)) seg++;
  console.log('Using available segment id for fee:', seg);

  const feeTx = Transaction.fromParts('preview').addIntent({ tag: 'specific', value: seg }, feeIntent);
  const unprovenTxWithFee = unprovenTx.merge(feeTx);

  console.log('Unproven tx with fee merged!');
  console.log('Intents in unproven tx:', Array.from(unprovenTxWithFee.intents.keys()));
  console.log('Required fees:', unprovenTxWithFee.fees(initialLedgerParams).toString());
  console.log('Imbalances:', unprovenTxWithFee.imbalances(0, feeEstimate));

  console.log('=== Step 6: Generate ZK proof via localhost:6300 ===');
  console.log('Proving full transaction (deployment + DUST fee spend)...');
  const provenTx = await proofProvider.proveTx(unprovenTxWithFee);
  console.log('*** ZK PROOF GENERATION SUCCEEDED! ***');
  console.log('Proven tx class:', provenTx.constructor.name);
  console.log('Proven tx identifiers:', provenTx.identifiers());
  console.log('Proven tx serialized size:', provenTx.serialize().length, 'bytes');

  console.log('=== Step 6b: Testing eraseProofs + merge fee + re-prove (the balanceTx pattern) ===');
  // First prove pure unproven deploy tx (like submitTxCore does)
  console.log('Proving pure deploy tx...');
  const firstProvenTx = await proofProvider.proveTx(unprovenTx);
  console.log('Pure deploy tx proven. Identifiers:', firstProvenTx.identifiers());

  // Now simulate balanceTx:
  const feeEstimate2 = firstProvenTx.feesWithMargin(initialLedgerParams, 5);
  console.log('Fee estimate with margin:', feeEstimate2.toString());

  const [newState2, dustSpend2] = localState.spend(dustSecretKey, dustUtxo, feeEstimate2, now);
  const dustActions2 = new DustActions('signature', 'pre-proof', now, [dustSpend2], []);
  const feeIntent2 = Intent.new(ttl);
  feeIntent2.dustActions = dustActions2;

  const feeTx2 = Transaction.fromParts('preview').addIntent({ tag: 'specific', value: seg }, feeIntent2);
  const reUnprovenTx = firstProvenTx.eraseProofs().merge(feeTx2);

  console.log('Re-proving merged tx via proof server...');
  const reProvenTx = await proofProvider.proveTx(reUnprovenTx);
  console.log('*** RE-PROVEN TX SUCCEEDED! ***');
  console.log('Re-proven tx serialized size:', reProvenTx.serialize().length);
  console.log('Re-proven tx identifiers:', reProvenTx.identifiers());
  console.log('Re-proven tx imbalances:', reProvenTx.imbalances(0, feeEstimate2));
}

testDryRun().catch(console.error);
