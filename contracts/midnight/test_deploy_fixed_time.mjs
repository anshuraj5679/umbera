import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { createUnprovenDeployTx } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
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

// Ledger shims
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

async function run() {
  console.log('=== TESTING DEPLOY TRANSACTION VALIDATION WITH CHAIN TIME ===\n');

  console.log('1. Fetching current on-chain block and tree tips...');
  const qBlock = `query {
    block {
      height
      hash
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
  const dBlock = await rBlock.json();
  const b = dBlock.data.block;
  const blockTime = new Date(b.timestamp);
  console.log(`[OK] Current Block: ${b.height} | Time: ${blockTime.toISOString()} | Hash: ${b.hash}`);
  console.log(`[OK] GenTip: ${b.dustGenerationEndIndex} | CommTip: ${b.dustCommitmentEndIndex}`);

  console.log('\n2. Fetching Merkle tree updates...');
  const q = `query {
    gen0: dustGenerationMerkleTreeUpdate(startIndex: 0, endIndex: 12282) { update }
    comm0: dustCommitmentMerkleTreeUpdate(startIndex: 0, endIndex: 91305) { update }
    gen1: dustGenerationMerkleTreeUpdate(startIndex: 12284, endIndex: 13106) { update }
    comm1: dustCommitmentMerkleTreeUpdate(startIndex: 91307, endIndex: 115343) { update }
    gen2: dustGenerationMerkleTreeUpdate(startIndex: 13107, endIndex: ${b.dustGenerationEndIndex - 1}) { update }
    comm2: dustCommitmentMerkleTreeUpdate(startIndex: 115345, endIndex: ${b.dustCommitmentEndIndex}) { update }
  }`;
  const r = await fetch(indexerUrl, {
    method: 'POST',
    headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q })
  });
  const d = await r.json();

  console.log('\n3. Building fully synced DustLocalState...');
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

  if (d.data.gen2?.update) {
    localState = localState.applyGenerationCollapsedUpdate(
      ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(d.data.gen2.update, 'hex'))
    );
  }
  if (d.data.comm2?.update) {
    localState = localState.applyCommitmentCollapsedUpdate(
      ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(d.data.comm2.update, 'hex'))
    );
  }

  const dustUtxo = localState.utxos[0];
  console.log(`[OK] UTXO mtIndex: ${dustUtxo.mtIndex}`);
  const hexGen = localState.generatingTreeRoot().toString(16).padStart(64, '0');
  const actualGen = '73' + Buffer.from(Buffer.from(hexGen, 'hex')).reverse().toString('hex');
  const hexComm = localState.commitmentTreeRoot().toString(16).padStart(64, '0');
  const actualComm = '73' + Buffer.from(Buffer.from(hexComm, 'hex')).reverse().toString('hex');
  console.log(`[OK] Gen Root Match:  ${actualGen === b.dustGenerationMerkleTreeRoot}`);
  console.log(`[OK] Comm Root Match: ${actualComm === b.dustCommitmentMerkleTreeRoot}`);

  console.log('\n4. Setting chain-aligned timestamps and shimming Date.now...');
  const now = blockTime;
  const ttl = new Date(blockTime.getTime() + 1800 * 1000);
  console.log(`[OK] now (ctime): ${now.toISOString()}`);
  console.log(`[OK] ttl:         ${ttl.toISOString()}`);

  // Shim Date.now so createUnprovenDeployTx's internal ttlOneHour() uses blockTime - 60s
  const origDateNow = Date.now;
  Date.now = () => blockTime.getTime() - 60_000;
  console.log(`[OK] Shimmed Date.now() to: ${new Date(Date.now()).toISOString()}`);

  console.log('\n5. Loading contract and creating deploy transaction...');
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
  const privateStateProvider = levelPrivateStateProvider({
    midnightDbName: `umbra-deploy-${Date.now()}`,
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

  const unprovenDeployTxData = await createUnprovenDeployTx(
    { zkConfigProvider, proofProvider, privateStateProvider, walletProvider },
    { compiledContract }
  );
  const unprovenTx = unprovenDeployTxData.private.unprovenTx;
  const contractAddress = unprovenDeployTxData.public.contractAddress;
  Date.now = origDateNow;
  console.log(`[OK] Predicted contract address: ${contractAddress}`);

  // Align deploy intent TTL with chain-aligned ttl
  for (const [k, intent] of unprovenTx.intents) {
    intent.ttl = ttl;
    console.log(`[OK] Updated intent ${k} TTL to: ${intent.ttl.toISOString()}`);
  }

  console.log('\n6. Attaching DUST fee spend...');
  const feeEstimate = unprovenTx.feesWithMargin(lp, 5);
  console.log(`[OK] Fee estimate: ${feeEstimate.toString()}`);

  const [, dustSpend] = localState.spend(dustSecretKey, dustUtxo, feeEstimate, now);
  const dustActions = new ledger.DustActions('signature', 'pre-proof', now, [dustSpend], []);
  const feeIntent = ledger.Intent.new(ttl);
  feeIntent.dustActions = dustActions;

  const usedSegments = new Set(unprovenTx.intents.keys());
  let seg = 1;
  while (usedSegments.has(seg)) seg++;
  const feeTx = ledger.Transaction.fromParts('preview').addIntent({ tag: 'specific', value: seg }, feeIntent);
  const mergedTx = unprovenTx.merge(feeTx);

  console.log('\n7. Generating ZK proof (localhost:6300)...');
  const provenTx = await proofProvider.proveTx(mergedTx);
  console.log('[OK] ZK Proof generated!');

  console.log('\n8. Binding transaction...');
  const boundTx = provenTx.bind();
  console.log('[OK] Transaction bound!');
  const rawTxBytes = Buffer.from(boundTx.serialize());
  console.log(`[OK] Serialized length: ${rawTxBytes.length} bytes`);

  // Local wellFormed check
  const blank = ledger.LedgerState.blank('preview');
  const strictness = new ledger.WellFormedStrictness();
  const verified = boundTx.wellFormed(blank, strictness, now);
  console.log(`[OK] Local wellFormed: PASSED (${verified.constructor.name})`);

  // Local apply check
  const tc = new ledger.TransactionContext(blank, {
    secondsSinceEpoch: Math.floor(now.getTime() / 1000),
    secondsSinceEpochErr: 0,
    parentBlockHash: '00'.repeat(32),
    lastBlockTime: Math.floor(now.getTime() / 1000) - 6
  }, null);
  const nextState = blank.apply(verified, tc);
  console.log('[OK] Local LedgerState.apply: PASSED!');

  // Check against node's TaggedTransactionQueue_validate_transaction
  console.log('\n9. Testing validation on Midnight Preview node...');
  const callData = Buffer.concat([
    Buffer.from([4]),
    Buffer.from([5]),
    Buffer.from([0]),
    Buffer.from(scale.compact.enc(rawTxBytes.length)),
    rawTxBytes
  ]);
  const fullExtrinsic = Buffer.concat([Buffer.from(scale.compact.enc(callData.length)), callData]);

  // Fetch current head for validation
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

  if (dataVal.result?.startsWith('0x00')) {
    console.log('\n*** VALIDATION PASSED! TRANSACTION IS ACCEPTED BY VALIDATOR! ***\n');
    console.log('Now submitting via author_submitExtrinsic...');
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
  } else {
    console.warn('\n[!] Validation returned error:', dataVal.result);
  }
}

run().catch(console.error);
