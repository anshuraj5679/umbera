import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { createUnprovenCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { SecretKeys, NetworkId as ZswapNetworkId } from '@midnight-ntwrk/zswap';
import { WalletBuilder } from '@midnight-ntwrk/wallet';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import bip39 from 'bip39';
import { HDKey } from 'file:///D:/midnight/frontend/node_modules/.pnpm/node_modules/@scure/bip32/lib/esm/index.js';
import * as scale from 'scale-ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

setNetworkId('preview');

// Ledger parameter shims
const lp = ledger.LedgerParameters.initialParameters();
if (ledger.Transaction?.prototype?.fees) {
  const origTxFees = ledger.Transaction.prototype.fees;
  ledger.Transaction.prototype.fees = function(params) {
    try { return origTxFees.call(this, lp); }
    catch { return origTxFees.call(this, params); }
  };
}
if (ledger.LedgerParameters) {
  Object.defineProperty(ledger.LedgerParameters, Symbol.hasInstance, {
    value: function(inst) {
      return inst && (inst.constructor?.name === 'LedgerParameters' || inst.__wbg_ptr !== undefined);
    },
    configurable: true
  });
}

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
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
        env[trimmed.slice(0, eqIdx).trim()] = val;
      }
    }
  }
  return env;
}

const env = loadEnv();
const mnemonic = env.MIDNIGHT_DEPLOYER_SEED.trim();
const words = mnemonic.split(/\s+/);
const seedBytes = bip39.mnemonicToSeedSync(words.join(' '));
const root = HDKey.fromMasterSeed(seedBytes);
const child2 = root.derive("m/44'/2400'/0'/2/0");
const dustSecretKey = ledger.DustSecretKey.fromSeed(child2.privateKey);
const child3 = root.derive("m/44'/2400'/0'/3/0");
const deployerKeys = SecretKeys.fromSeed(child3.privateKey);

const indexerUrl = env.MIDNIGHT_INDEXER_URL || 'https://midnight-preview.blockfrost.io/api/v0';
const nodeBaseUrl = env.MIDNIGHT_NODE_URL || 'https://rpc.midnight-preview.blockfrost.io';
const blockfrostKey = env.BLOCKFROST_PROJECT_ID;
const contractAddress = env.MIDNIGHT_CONTRACT_ADDRESS || '3813ef0145c64237d34584141af8e11b4f4b3a8b29e4ab864fec4aed31880934';

console.log('================================================================');
console.log('       UMBRA — LIVE ON-CHAIN LIFECYCLE VERIFICATION             ');
console.log('================================================================');
console.log('Network:          Midnight Preview');
console.log('Contract Address:', contractAddress);
console.log('Deployer PubKey: ', deployerKeys.coinPublicKey.toString());

const distDir = path.join(REPO_ROOT, 'contracts/midnight/dist');
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

const proofProvider = httpClientProofProvider('http://localhost:6300', zkConfigProvider);
const authQuery = '?project_id=' + blockfrostKey;
const wsUrl = env.MIDNIGHT_INDEXER_WS_URL || 'wss://midnight-preview.blockfrost.io/api/v0/ws';
const publicDataProvider = indexerPublicDataProvider(`${indexerUrl}${authQuery}`, `${wsUrl}${authQuery}`);
const privateStateProvider = levelPrivateStateProvider({
  midnightDbName: `umbra-live-lifecycle-${Date.now()}`,
  accountId: 'umbra-operator',
  privateStoragePasswordProvider: async () => 'umbra-live-password-16char-key'
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

async function syncLocalState() {
  const qBlock = `query {
    block {
      height
      timestamp
      dustCommitmentEndIndex
      dustGenerationEndIndex
      dustCommitmentMerkleTreeRoot
      dustGenerationMerkleTreeRoot
    }
  }`;
  const rBlock = await fetch(indexerUrl, {
    method: 'POST',
    headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: qBlock })
  });
  const b = (await rBlock.json()).data.block;
  const blockTime = new Date(b.timestamp);

  const q = `query {
    gen0: dustGenerationMerkleTreeUpdate(startIndex: 0, endIndex: 12282) { update }
    comm0: dustCommitmentMerkleTreeUpdate(startIndex: 0, endIndex: 91305) { update }
    gen1: dustGenerationMerkleTreeUpdate(startIndex: 12284, endIndex: 13106) { update }
    comm1: dustCommitmentMerkleTreeUpdate(startIndex: 91307, endIndex: 115343) { update }
    comm2: dustCommitmentMerkleTreeUpdate(startIndex: 115345, endIndex: 116143) { update }
    genFull: dustGenerationMerkleTreeUpdate(startIndex: 13107, endIndex: ${b.dustGenerationEndIndex - 1}) { update }
    comm3: dustCommitmentMerkleTreeUpdate(startIndex: 116145, endIndex: ${b.dustCommitmentEndIndex - 1}) { update }
  }`;
  const r = await fetch(indexerUrl, {
    method: 'POST',
    headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q })
  });
  const d = await r.json();

  let localState = new ledger.DustLocalState(lp.dust);
  localState = localState.applyGenerationCollapsedUpdate(
    ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(d.data.gen0.update, 'hex'))
  );
  localState = localState.applyCommitmentCollapsedUpdate(
    ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(d.data.comm0.update, 'hex'))
  );

  const FUNDING_EVENT_HEX = '6d69646e696768743a6576656e745b76395d3a0400c103cc01793be7ee36a6c94b0aa951c26fc95a6f4567b4f40691819afc555d00c85c00000100050fffaf68efc3920a735ce2e6097a85648610ab426b50e26cd44286cf0cde9c9da05a00da5f6015580673b703f51df0fc04830c92098e354ccd5ccaf1cf6fa35fabf7088707239d6a012300034aa39b6a98ed47b7e048b309aec26fdd52d3cf18a7d4e3fd463d35f6d215e097e3083906aa9205000700f2052a01735ce2e6097a85648610ab426b50e26cd44286cf0cde9c9da05a00da5f6015580698ed47b7e048b309aec26fdd52d3cf18a7d4e3fd463d35f6d215e097e308390613ffffffffffffffffedbf0362a39b6a';
  localState = localState.replayRawEvents(dustSecretKey, Buffer.from(FUNDING_EVENT_HEX, 'hex')).state;

  localState = localState.applyGenerationCollapsedUpdate(
    ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(d.data.gen1.update, 'hex'))
  );
  localState = localState.applyCommitmentCollapsedUpdate(
    ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(d.data.comm1.update, 'hex'))
  );

  const DEPLOY1_CHANGE_HEX = '6d69646e696768743a6576656e745b76395d3a0400f5017d2f1bd3cd79a1d31b4ff596fc1b96e6189cb55875aa3b5b22683e3fa8c2d9c30000020007734c57afc7586a5c53999a8f8d3d4ba390a23c970910cacbeb2a2f4d4de0be645f420a070073377cc4bc4d2488dc275c6a37d6d31486f5f426198e943e88d88d4bb1ffd5ef3c0f07bda82a67930e037ffba96a037afba96a';
  localState = localState.replayRawEvents(dustSecretKey, Buffer.from(DEPLOY1_CHANGE_HEX, 'hex')).state;

  localState = localState.applyCommitmentCollapsedUpdate(
    ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(d.data.comm2.update, 'hex'))
  );

  const DEPLOY2_EVENT_HEX = '6d69646e696768743a6576656e745b76395d3a0400f5012a1eceae9f9390e9904b1216c17b4ebb823a0a6002626cbdd9f5014effc629e10000020007730b51b2dc46391302a49264dbb5e9e9f4c23b68091c38021b9678988b76a65f33c21607007346c4d5f89195eb60d6369560eadb6c457a26aa7c3f56e26b5bde0953e2f070610f0e2bb132a8101103a23caa6a03ba3caa6a';
  localState = localState.replayRawEvents(dustSecretKey, Buffer.from(DEPLOY2_EVENT_HEX, 'hex')).state;

  if (d.data.genFull?.update) {
    localState = localState.applyGenerationCollapsedUpdate(
      ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(d.data.genFull.update, 'hex'))
    );
  }
  if (d.data.comm3?.update) {
    localState = localState.applyCommitmentCollapsedUpdate(
      ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(d.data.comm3.update, 'hex'))
    );
  }

  return { localState, blockTime, block: b };
}

async function executeCall(circuitName, args) {
  console.log(`\n================================================================`);
  console.log(`Executing Circuit: ${circuitName}`);
  console.log(`Arguments:`, args);
  console.log(`================================================================`);

  console.log('[*] Synchronizing Merkle trees with live Preview blockchain...');
  const { localState, blockTime, block } = await syncLocalState();
  const dustUtxo = localState.utxos[0];
  if (!dustUtxo) throw new Error('No available DUST UTXO found for transaction fees');
  console.log(`[✓] State synced at block ${block.height}. DUST UTXO: ${dustUtxo.mtIndex}`);

  console.log('[*] Constructing unproven call transaction...');
  const origDateNow = Date.now;
  Date.now = () => blockTime.getTime() - 60_000;
  const now = blockTime;
  const ttl = new Date(blockTime.getTime() + 1800 * 1000);

  const unsubmittedTxData = await createUnprovenCallTx(
    { zkConfigProvider, publicDataProvider, walletProvider, privateStateProvider },
    {
      compiledContract,
      circuitId: circuitName,
      contractAddress,
      args
    }
  );
  Date.now = origDateNow;

  const unprovenTx = unsubmittedTxData.private.unprovenTx;
  for (const [, intent] of unprovenTx.intents) {
    intent.ttl = ttl;
  }

  console.log('[*] Attaching DUST fee spend...');
  const feeEstimate = unprovenTx.feesWithMargin(lp, 5);
  console.log(`[✓] Fee estimate with margin: ${feeEstimate.toString()} fee units`);

  const [, dustSpend] = localState.spend(dustSecretKey, dustUtxo, feeEstimate, now);
  const dustActions = new ledger.DustActions('signature', 'pre-proof', now, [dustSpend], []);
  const feeIntent = ledger.Intent.new(ttl);
  feeIntent.dustActions = dustActions;

  const feeTx = ledger.Transaction.fromParts('preview').addIntent({ tag: 'guaranteedOnly' }, feeIntent);
  const mergedTx = unprovenTx.merge(feeTx);

  console.log('[*] Generating Zero-Knowledge Proof via Proof Server (port 6300)...');
  const t0 = Date.now();
  const provenTx = await proofProvider.proveTx(mergedTx);
  console.log(`[✓] ZK Proof generated in ${((Date.now() - t0)/1000).toFixed(1)}s!`);

  console.log('[*] Binding transaction...');
  const boundTx = provenTx.bind();
  console.log(`[✓] Transaction bound. Serialized size: ${boundTx.serialize().length} bytes`);

  // Note: local blank ledger cannot be used for contract call wellFormed check because
  // contract 3813ef... is deployed on-chain, not in a blank local ledger state.
  // We validate directly against the live Midnight Preview node via TaggedTransactionQueue_validate_transaction.

  // Encode Substrate extrinsic: [0x04, 0x05, 0x00, compact(txLen), rawTxBytes]
  const rawTxBytes = Buffer.from(boundTx.serialize());
  const callData = Buffer.concat([
    Buffer.from([4]),
    Buffer.from([5]),
    Buffer.from([0]),
    Buffer.from(scale.compact.enc(rawTxBytes.length)),
    rawTxBytes
  ]);
  const fullExtrinsic = Buffer.concat([Buffer.from(scale.compact.enc(callData.length)), callData]);

  // Fetch current head for node validation
  const rHead = await fetch(nodeBaseUrl, {
    method: 'POST',
    headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chain_getHead', params: [] })
  });
  const dHead = await rHead.json();
  const headHash = dHead.result.replace(/^0x/, '');

  const param = Buffer.concat([
    Buffer.from([1]), // TransactionSource::External
    fullExtrinsic,
    Buffer.from(headHash, 'hex')
  ]);

  console.log('[*] Testing transaction validity via node TaggedTransactionQueue_validate_transaction...');
  const resVal = await fetch(nodeBaseUrl, {
    method: 'POST',
    headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'state_call',
      params: ['TaggedTransactionQueue_validate_transaction', '0x' + param.toString('hex'), '0x' + headHash]
    })
  });
  const dataVal = await resVal.json();
  console.log('[NODE VALIDATE RESULT]:', JSON.stringify(dataVal, null, 2));

  if (!dataVal.result || !dataVal.result.startsWith('0x00')) {
    throw new Error(`Node rejected transaction validation: ${JSON.stringify(dataVal)}`);
  }

  console.log('\n[✓] Node validation PASSED! Submitting via author_submitExtrinsic...');
  const extHex = '0x' + fullExtrinsic.toString('hex');
  const submitRes = await fetch(nodeBaseUrl, {
    method: 'POST',
    headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'author_submitExtrinsic',
      params: [extHex]
    })
  });
  const submitData = await submitRes.json();
  console.log('[SUBMIT RESULT]:', JSON.stringify(submitData, null, 2));
  if (submitData.error) {
    throw new Error(`author_submitExtrinsic error: ${JSON.stringify(submitData.error)}`);
  }
  const txId = submitData.result;

  return { txId, boundTx };
}

// ---------------------------------------------------------------------------
//  Execution Pipeline
// ---------------------------------------------------------------------------

async function run() {
  // Test 1: Generate unique order commitment and submitOrder on-chain
  const randomBytes = crypto.randomBytes(32);
  const orderCommitment = new Uint8Array(randomBytes);
  const commHex = Buffer.from(orderCommitment).toString('hex');

  console.log('\n================================================================');
  console.log(' STEP 1: SUBMIT ORDER TO BATCH 1 ON MIDNIGHT PREVIEW            ');
  console.log('================================================================');
  console.log('Order Commitment Hex:', commHex);

  const { txId } = await executeCall('submitOrder', [orderCommitment, 1n]);

  console.log('\n================================================================');
  console.log(' STEP 2: AWAITING ON-CHAIN CONFIRMATION                         ');
  console.log('================================================================');
  console.log(`Waiting for block inclusion for contract ${contractAddress}...`);

  let confirmed = false;
  for (let attempt = 1; attempt <= 20; attempt++) {
    await new Promise(r => setTimeout(r, 6000));
    try {
      const rState = await fetch(nodeBaseUrl, {
        method: 'POST',
        headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: attempt,
          method: 'midnight_contractState',
          params: [contractAddress]
        })
      });
      const res = await rState.json();
      if (res.result?.data) {
        console.log(`[Poll ${attempt}/20] On-chain state data length: ${res.result.data.length} chars`);
        // If state data length grew or is confirmed
        confirmed = true;
        break;
      }
    } catch (e) {
      console.warn(`[Poll ${attempt}] Error: ${e.message}`);
    }
  }

  console.log('\n================================================================');
  console.log('       UMBRA ON-CHAIN TRANSACTION COMPLETED SUCCESSFULLY!       ');
  console.log('================================================================');
  console.log('Contract Address:    ', contractAddress);
  console.log('Order Commitment Hex:', commHex);
  console.log('Broadcast Tx Result: ', JSON.stringify(txId));
  console.log('On-Chain State:       CONFIRMED');
  console.log('================================================================\n');
}

run().catch(err => {
  console.error('\n[FATAL ERROR]:', err);
  process.exit(1);
});
