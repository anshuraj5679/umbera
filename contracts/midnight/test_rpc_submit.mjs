import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { createUnprovenDeployTx } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { SecretKeys } from '@midnight-ntwrk/zswap';
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
const lp = ledger.LedgerParameters.initialParameters();

if (ledger.Transaction?.prototype?.fees) {
  const orig = ledger.Transaction.prototype.fees;
  ledger.Transaction.prototype.fees = function(p) { try { return orig.call(this, lp); } catch { return orig.call(this, p); } };
}

const mnemonic = env.MIDNIGHT_DEPLOYER_SEED.trim();
const seedBytes = bip39.mnemonicToSeedSync(mnemonic);
const root = HDKey.fromMasterSeed(seedBytes);
const child2 = root.derive("m/44'/2400'/0'/2/0");
const dustSecretKey = ledger.DustSecretKey.fromSeed(child2.privateKey);
const child3 = root.derive("m/44'/2400'/0'/3/0");
const deployerKeys = SecretKeys.fromSeed(child3.privateKey);

const treeUpdates = JSON.parse(fs.readFileSync('d:/midnight/contracts/midnight/tree_updates.json', 'utf8'));
let localState = new ledger.DustLocalState(lp.dust);
localState = localState.applyGenerationCollapsedUpdate(
  ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(treeUpdates.genUpdate.update, 'hex'))
);
localState = localState.applyCommitmentCollapsedUpdate(
  ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(treeUpdates.commUpdate.update, 'hex'))
);

const FUNDING_EVENT_HEX = '6d69646e696768743a6576656e745b76395d3a0400c103cc01793be7ee36a6c94b0aa951c26fc95a6f4567b4f40691819afc555d00c85c00000100050fffaf68efc3920a735ce2e6097a85648610ab426b50e26cd44286cf0cde9c9da05a00da5f6015580673b703f51df0fc04830c92098e354ccd5ccaf1cf6fa35fabf7088707239d6a012300034aa39b6a98ed47b7e048b309aec26fdd52d3cf18a7d4e3fd463d35f6d215e097e3083906aa9205000700f2052a01735ce2e6097a85648610ab426b50e26cd44286cf0cde9c9da05a00da5f6015580698ed47b7e048b309aec26fdd52d3cf18a7d4e3fd463d35f6d215e097e308390613ffffffffffffffffedbf0362a39b6a';
const res = localState.replayRawEvents(dustSecretKey, Buffer.from(FUNDING_EVENT_HEX, 'hex'));
localState = res.state;
const dustUtxo = localState.utxos[0];

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
    const [zkir, pk, vk] = await Promise.all([this.getZKIR(id), this.getProverKey(id), this.getVerifierKey(id)]);
    return { zkir, proverKey: pk, verifierKey: vk };
  }
};
const proofProvider = httpClientProofProvider('http://localhost:6300', zkConfigProvider);
const privateStateProvider = levelPrivateStateProvider({
  midnightDbName: 'umbra-deployer-private-state',
  accountId: 'umbra-deployer',
  privateStoragePasswordProvider: async () => 'umbra-deployer-private-state-encryption-key-v1'
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

console.log('Creating unproven deploy tx...');
const unprovenDeployTxData = await createUnprovenDeployTx(
  { zkConfigProvider, walletProvider, privateStateProvider },
  { compiledContract }
);
const unprovenTx = unprovenDeployTxData.private.unprovenTx;
const contractAddress = unprovenDeployTxData.public.contractAddress;
console.log('Contract address:', contractAddress);

const now = new Date();
const ttl = new Date(now.getTime() + 3600 * 1000);
const feeEstimate = unprovenTx.feesWithMargin(lp, 5);
console.log('Fee estimate:', feeEstimate);

const [, dustSpend] = localState.spend(dustSecretKey, dustUtxo, feeEstimate, now);
const dustActions = new ledger.DustActions('signature', 'pre-proof', now, [dustSpend], []);
const feeIntent = ledger.Intent.new(ttl);
feeIntent.dustActions = dustActions;

const usedSegments = new Set(unprovenTx.intents.keys());
let seg = 1;
while (usedSegments.has(seg)) seg++;
const feeTx = ledger.Transaction.fromParts('preview').addIntent({ tag: 'specific', value: seg }, feeIntent);
const mergedTx = unprovenTx.merge(feeTx);

console.log('Proving...');
const provenTx = await proofProvider.proveTx(mergedTx);

console.log('\n=== PROVEN TX DETAILS ===');
const serialized = provenTx.serialize();
console.log('Serialized bytes:', serialized.length);
// Save the serialized tx for inspection
fs.writeFileSync('d:/midnight/contracts/midnight/proven_tx.bin', Buffer.from(serialized));
console.log('Saved proven_tx.bin');

// Now try to submit via direct RPC call to inspect the error
const blockfrostKey = env.BLOCKFROST_PROJECT_ID;
const nodeBaseUrl = env.MIDNIGHT_NODE_URL || 'https://rpc.midnight-preview.blockfrost.io';
const txHex = '0x' + Buffer.from(serialized).toString('hex');
console.log('TX hex length:', txHex.length);
console.log('First 100 chars of tx hex:', txHex.slice(0, 100));

const rpcRes = await fetch(nodeBaseUrl, {
  method: 'POST',
  headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0', id: 1,
    method: 'author_submitExtrinsic',
    params: [txHex]
  })
});
const rpcData = await rpcRes.json();
console.log('\nRPC submit result:', JSON.stringify(rpcData, null, 2));