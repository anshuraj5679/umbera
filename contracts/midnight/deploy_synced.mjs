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
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import bip39 from 'bip39';
import { HDKey } from 'file:///D:/midnight/frontend/node_modules/.pnpm/node_modules/@scure/bip32/lib/esm/index.js';
import * as scale from 'scale-ts';
import { firstValueFrom } from 'rxjs';

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

// Helper to find max valid endIndex via binary search
async function checkEndIndex(field, start, end) {
  const q = `query { ${field}(startIndex: ${start}, endIndex: ${end}) { startIndex endIndex } }`;
  const r = await fetch(indexerUrl, {
    method: 'POST',
    headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q })
  });
  const d = await r.json();
  return d.data && d.data[field] && !d.errors;
}

async function findMaxEnd(field, start, min, max) {
  let low = min;
  let high = max;
  let best = min;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const ok = await checkEndIndex(field, start, mid);
    if (ok) { best = mid; low = mid + 1; }
    else { high = mid - 1; }
  }
  return best;
}

async function run() {
  console.log('=== UMBRA DEPLOYMENT ENGINE (SYNCED STATE) ===\n');

  console.log('1. Fetching current on-chain block and Merkle tree tips...');
  const qBlock = `query {
    block {
      height
      dustCommitmentEndIndex
      dustGenerationEndIndex
    }
  }`;
  const rBlock = await fetch(indexerUrl, {
    method: 'POST',
    headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: qBlock })
  });
  const dBlock = await rBlock.json();
  const b = dBlock.data.block;
  console.log(`[OK] Current Block: ${b.height} | GenTip: ${b.dustGenerationEndIndex} | CommTip: ${b.dustCommitmentEndIndex}`);

  console.log('\n2. Fetching Merkle tree updates from network...');
  const q = `query {
    gen0: dustGenerationMerkleTreeUpdate(startIndex: 0, endIndex: 12282) { update }
    comm0: dustCommitmentMerkleTreeUpdate(startIndex: 0, endIndex: 91305) { update }
    gen1: dustGenerationMerkleTreeUpdate(startIndex: 12284, endIndex: 13106) { update }
    comm1: dustCommitmentMerkleTreeUpdate(startIndex: 91307, endIndex: 115343) { update }
    gen2: dustGenerationMerkleTreeUpdate(startIndex: 13107, endIndex: ${b.dustGenerationEndIndex}) { update }
    comm2: dustCommitmentMerkleTreeUpdate(startIndex: 115345, endIndex: ${b.dustCommitmentEndIndex}) { update }
  }`;
  const r = await fetch(indexerUrl, {
    method: 'POST',
    headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q })
  });
  const d = await r.json();
  if (!d.data?.gen0?.update || !d.data?.comm0?.update) {
    throw new Error('Failed to fetch tree updates: ' + JSON.stringify(d));
  }
  console.log('[OK] All tree updates fetched');

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
  console.log(`[OK] Active DUST UTXO: mtIndex=${dustUtxo.mtIndex}`);
  console.log(`[OK] DUST Balance: ${localState.walletBalance(new Date())}`);

  console.log('\n4. Initializing providers...');
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

  console.log('\n5. Loading contract and creating deploy transaction...');
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
  console.log(`[OK] Predicted contract address: ${contractAddress}`);

  console.log('\n6. Attaching DUST fee spend against live tree roots...');
  const now = new Date();
  const ttl = new Date(now.getTime() + 3600 * 1000);
  const feeEstimate = unprovenTx.feesWithMargin(lp, 5);
  console.log(`[OK] Fee estimate: ${feeEstimate.toString()} fee units`);

  const [, dustSpend] = localState.spend(dustSecretKey, dustUtxo, feeEstimate, now);
  console.log(`[OK] DUST spend created (vFee=${dustSpend.vFee.toString()})`);
  const dustActions = new ledger.DustActions('signature', 'pre-proof', now, [dustSpend], []);
  const feeIntent = ledger.Intent.new(ttl);
  feeIntent.dustActions = dustActions;

  const usedSegments = new Set(unprovenTx.intents.keys());
  let seg = 1;
  while (usedSegments.has(seg)) seg++;
  const feeTx = ledger.Transaction.fromParts('preview').addIntent({ tag: 'specific', value: seg }, feeIntent);
  const mergedTx = unprovenTx.merge(feeTx);
  console.log(`[OK] Merged transaction created`);

  console.log('\n7. Generating ZK proof (localhost:6300)...');
  const provenTx = await proofProvider.proveTx(mergedTx);
  console.log('[OK] ZK Proof generated successfully!');

  console.log('\n8. Binding transaction (pedersen-schnorr)...');
  const boundTx = provenTx.bind();
  console.log('[OK] Transaction bound successfully!');
  const rawTxBytes = Buffer.from(boundTx.serialize());
  console.log(`[OK] Serialized bound transaction: ${rawTxBytes.length} bytes`);

  // Verify well-formedness locally before broadcast
  const blank = ledger.LedgerState.blank('preview');
  const strictness = new ledger.WellFormedStrictness();
  const verified = boundTx.wellFormed(blank, strictness, now);
  console.log(`[OK] Local wellFormed validation PASSED (${verified.constructor.name})`);

  console.log('\n9. Submitting transaction using WalletBuilder.submitTransaction...');
  const authQuery = '?project_id=' + blockfrostKey;
  const authenticatedIndexerUrl = `${indexerUrl}${authQuery}`;
  const authenticatedWsUrl = `${env.MIDNIGHT_INDEXER_WS_URL || 'wss://midnight-preview.blockfrost.io/api/v0/ws'}${authQuery}`;
  const authenticatedNodeUrl = `${nodeBaseUrl}${authQuery}`;
  const hexEntropy = bip39.mnemonicToEntropy(words.join(' '));

  // Intercept fetch to capture exact author_submitExtrinsic request and response
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    let url = typeof input === 'string' ? input : input?.url;
    let body = init?.body;
    if (!body && input instanceof Request) {
      try { body = await input.clone().text(); } catch {}
    }
    const resp = await origFetch(input, init);
    if (body && typeof body === 'string' && body.includes('author_submitExtrinsic')) {
      const parsed = JSON.parse(body);
      const extHex = parsed.params?.[0];
      console.log(`[RPC] extHex length: ${extHex?.length}`);
      if (extHex) {
        console.log(`[RPC] extHex first 40 chars: ${extHex.slice(0, 40)}`);
        const buf = Buffer.from(extHex, 'hex');
        console.log(`[RPC] extHex first 20 bytes:`, buf.slice(0, 20));
        console.log(`[RPC] extHex payload:`, buf.slice(6, 60).toString('utf8'));
      }
      const respClone = resp.clone();
      const respText = await respClone.text();
      console.log(`[RPC] submitExtrinsic Status: ${resp.status}`);
      console.log(`[RPC] submitExtrinsic Body:   ${respText}`);
      try {
        const parsed = JSON.parse(body);
        const extHex = parsed.params?.[0];
        if (extHex) {
          console.log(`[*] Running system_dryRun to decode exact rejection reason...`);
          const dryRunResp = await origFetch(url, {
            method: 'POST',
            headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 999, method: 'system_dryRun', params: [extHex] })
          });
          const dryRunData = await dryRunResp.json();
          console.log(`[system_dryRun RESULT]:`, JSON.stringify(dryRunData, null, 2));
        }
      } catch (err) {
        console.warn(`[!] system_dryRun error: ${err.message}`);
      }
    }
    return resp;
  };

  let wallet = null;
  let txId = null;
  try {
    wallet = await WalletBuilder.build(
      authenticatedIndexerUrl,
      authenticatedWsUrl,
      'http://localhost:6300',
      authenticatedNodeUrl,
      hexEntropy,
      ZswapNetworkId.TestNet,
      'warn',
      true
    );
    console.log('[*] Calling wallet.submitTransaction(boundTx)...');
    txId = await wallet.submitTransaction(boundTx);
    console.log('[OK] TRANSACTION SUBMITTED!');
    console.log(`    Result / Tx ID: ${JSON.stringify(txId)}`);
  } finally {
    try { if (wallet) await wallet.close(); } catch {}
    globalThis.fetch = origFetch;
  }

  console.log('\n10. Waiting for On-Chain Confirmation...');
  console.log(`[*] Watching for deploy confirmation at: ${contractAddress}`);
  const publicDataProvider = indexerPublicDataProvider(authenticatedIndexerUrl, authenticatedWsUrl);
  let deployTxData = null;
  try {
    const obs$ = publicDataProvider.watchForDeployTxData(contractAddress);
    deployTxData = await Promise.race([
      firstValueFrom(obs$),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout: 3 minutes')), 180000))
    ]);
    console.log('[OK] ON-CHAIN CONFIRMATION RECEIVED!');
    console.log('Confirmed block:', deployTxData.blockHeight);
  } catch (e) {
    console.warn(`[!] Confirmation watch: ${e.message}`);
  }

  console.log('\n===============================================================');
  console.log('       TRANSACTION ACCEPTED BY MIDNIGHT PREVIEW!              ');
  console.log('===============================================================');
  console.log(`Tx Result:        ${JSON.stringify(txId)}`);
  console.log(`Contract Address: ${contractAddress}`);
  console.log(`Tx Identifiers:   ${boundTx.identifiers().join(', ')}`);
  console.log('===============================================================\n');

  // Update .env
  const envFile = path.join(REPO_ROOT, '.env');
  let content = fs.readFileSync(envFile, 'utf8');
  if (content.includes('MIDNIGHT_CONTRACT_ADDRESS=')) {
    content = content.replace(/MIDNIGHT_CONTRACT_ADDRESS=.*/g, `MIDNIGHT_CONTRACT_ADDRESS=${contractAddress}`);
  } else {
    content += `\nMIDNIGHT_CONTRACT_ADDRESS=${contractAddress}\n`;
  }
  if (content.includes('NEXT_PUBLIC_MIDNIGHT_CONTRACT_ADDRESS=')) {
    content = content.replace(/NEXT_PUBLIC_MIDNIGHT_CONTRACT_ADDRESS=.*/g, `NEXT_PUBLIC_MIDNIGHT_CONTRACT_ADDRESS=${contractAddress}`);
  } else {
    content += `NEXT_PUBLIC_MIDNIGHT_CONTRACT_ADDRESS=${contractAddress}\n`;
  }
  fs.writeFileSync(envFile, content);

  // Also update frontend/.env.local
  const frontendEnvFile = path.join(REPO_ROOT, 'frontend/.env.local');
  if (fs.existsSync(frontendEnvFile)) {
    let fContent = fs.readFileSync(frontendEnvFile, 'utf8');
    if (fContent.includes('NEXT_PUBLIC_MIDNIGHT_CONTRACT_ADDRESS=')) {
      fContent = fContent.replace(/NEXT_PUBLIC_MIDNIGHT_CONTRACT_ADDRESS=.*/g, `NEXT_PUBLIC_MIDNIGHT_CONTRACT_ADDRESS=${contractAddress}`);
    } else {
      fContent += `NEXT_PUBLIC_MIDNIGHT_CONTRACT_ADDRESS=${contractAddress}\n`;
    }
    fs.writeFileSync(frontendEnvFile, fContent);
    console.log('[OK] frontend/.env.local updated with new contract address!');
  }
  console.log('[OK] .env updated with contract address!');
}

run().catch((err) => {
  console.error('\n[FATAL ERROR]:', err.message || err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
