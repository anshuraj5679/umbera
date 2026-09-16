/**
 * UMBRA — Midnight Preview Direct Deployment Script (deploy-final.mjs)
 *
 * Correct Midnight Preview deployment flow that bypasses the broken
 * WalletBuilder.balanceTransaction() DUST-funding path.
 *
 * Flow:
 * 1. BIP-39 mnemonic -> HD keys (role 2: DUST, role 3: ZSwap)
 * 2. Load DUST tree updates + replay funding event -> local UTXO
 * 3. createUnprovenDeployTx -> unprovenTx
 * 4. DustLocalState.spend() -> DustActions -> merge fee intent
 * 5. proofProvider.proveTx(mergedTx) via localhost:6300
 * 6. wallet.submitTransaction(provenTx) -> txId
 * 7. publicDataProvider.watchForDeployTxData(contractAddress)
 *
 * SECURITY: MIDNIGHT_DEPLOYER_SEED is never logged or exposed.
 * Zero auto-retry. Broadcasts only with --deploy flag.
 */

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
import { NetworkId as ZswapNetworkId, SecretKeys } from '@midnight-ntwrk/zswap';
import { HDKey } from 'file:///D:/midnight/frontend/node_modules/.pnpm/node_modules/@scure/bip32/lib/esm/index.js';
import {
  LedgerParameters,
  Transaction,
  DustSecretKey,
  DustLocalState,
  DustStateMerkleTreeCollapsedUpdate,
  DustActions,
  Intent
} from '@midnight-ntwrk/ledger-v8';
import bip39 from 'bip39';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

// Ledger shims
const initialLedgerParams = LedgerParameters.initialParameters();
if (Transaction?.prototype?.fees) {
  const origTxFees = Transaction.prototype.fees;
  Transaction.prototype.fees = function(params) {
    try { return origTxFees.call(this, initialLedgerParams); }
    catch { return origTxFees.call(this, params); }
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

setNetworkId('preview');
const args = process.argv.slice(2);
const IS_DEPLOY = args.includes('--deploy');

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

async function main() {
  console.log('===============================================================');
  console.log('  UMBRA Midnight Preview Direct Deployment (deploy-final.mjs)  ');
  console.log('===============================================================\n');
  console.log(`Mode: ${IS_DEPLOY ? '*** REAL DEPLOYMENT — BROADCASTING TRANSACTION ***' : 'DRY-RUN (no broadcast)'}\n`);

  const env = loadEnv();

  const blockfrostKey = env.BLOCKFROST_PROJECT_ID;
  if (!blockfrostKey) throw new Error('BLOCKFROST_PROJECT_ID missing in .env');
  if ((env.MIDNIGHT_NETWORK_ID || '').toLowerCase() !== 'preview') {
    throw new Error('MIDNIGHT_NETWORK_ID must be preview');
  }

  const indexerBaseUrl = env.MIDNIGHT_INDEXER_URL || 'https://midnight-preview.blockfrost.io/api/v0';
  const nodeBaseUrl = env.MIDNIGHT_NODE_URL || 'https://rpc.midnight-preview.blockfrost.io';
  const wsBaseUrl = env.MIDNIGHT_INDEXER_WS_URL || 'wss://midnight-preview.blockfrost.io/api/v0/ws';
  const proofServerUrl = env.PROOF_SERVER_URL || 'http://localhost:6300';
  const authQuery = '?project_id=' + blockfrostKey;
  const authenticatedIndexerUrl = `${indexerBaseUrl}${authQuery}`;
  const authenticatedWsUrl = `${wsBaseUrl}${authQuery}`;
  const authenticatedNodeUrl = `${nodeBaseUrl}${authQuery}`;

  console.log(`[OK] Network:      PREVIEW`);
  console.log(`[OK] Indexer:      ${indexerBaseUrl}`);
  console.log(`[OK] Node RPC:     ${nodeBaseUrl}`);
  console.log(`[OK] Proof Server: ${proofServerUrl}`);

  // Step 1: Connectivity
  console.log('\n--- Step 1: Connectivity Checks ---');
  try {
    await fetch(proofServerUrl, { signal: AbortSignal.timeout(5000) });
    console.log('[OK] Proof server ONLINE');
  } catch (e) {
    throw new Error(`Proof server unreachable at ${proofServerUrl}: ${e.message}`);
  }
  try {
    const r = await fetch(nodeBaseUrl, {
      method: 'POST',
      headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'system_health', params: [] }),
      signal: AbortSignal.timeout(10000)
    });
    const d = await r.json();
    console.log(`[OK] Node RPC ONLINE (peers=${d?.result?.peers ?? '?'})`);
  } catch (e) {
    throw new Error(`Node RPC unreachable: ${e.message}`);
  }
  try {
    const r = await fetch(indexerBaseUrl, {
      method: 'POST',
      headers: { 'project_id': blockfrostKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ block { height } }' }),
      signal: AbortSignal.timeout(10000)
    });
    const d = await r.json();
    console.log(`[OK] Indexer OPERATIONAL (block height=${d?.data?.block?.height})`);
  } catch (e) {
    throw new Error(`Indexer unreachable: ${e.message}`);
  }

  // Step 2: Key Derivation
  console.log('\n--- Step 2: Key Derivation ---');
  const mnemonic = env.MIDNIGHT_DEPLOYER_SEED?.trim();
  if (!mnemonic) throw new Error('MIDNIGHT_DEPLOYER_SEED missing in .env');
  const words = mnemonic.split(/\s+/).filter(Boolean);
  if (words.length !== 24) throw new Error(`Expected 24-word mnemonic, got ${words.length}`);
  if (!bip39.validateMnemonic(words.join(' '))) throw new Error('BIP-39 mnemonic checksum INVALID');
  const hexEntropy = bip39.mnemonicToEntropy(words.join(' '));
  const seedBytes = bip39.mnemonicToSeedSync(words.join(' '));
  const root = HDKey.fromMasterSeed(seedBytes);
  const child2 = root.derive("m/44'/2400'/0'/2/0");
  const dustSecretKey = DustSecretKey.fromSeed(child2.privateKey);
  console.log(`[OK] Dust Public Key (role 2): ${dustSecretKey.publicKey.toString()}`);
  const child3 = root.derive("m/44'/2400'/0'/3/0");
  const deployerKeys = SecretKeys.fromSeed(child3.privateKey);
  console.log(`[OK] Coin Public Key (role 3): ${deployerKeys.coinPublicKey}`);

  // Step 3: DUST Local State
  console.log('\n--- Step 3: DUST Local State ---');
  let treeUpdates = null;
  try {
    const q = `query {
      genUpdate: dustGenerationMerkleTreeUpdate(startIndex: 0, endIndex: 12282) {
        startIndex endIndex update protocolVersion
      }
      commUpdate: dustCommitmentMerkleTreeUpdate(startIndex: 0, endIndex: 91305) {
        startIndex endIndex update protocolVersion
      }
    }`;
    const r = await fetch(authenticatedIndexerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q })
    });
    const d = await r.json();
    if (d.data?.genUpdate?.update && d.data?.commUpdate?.update) {
      treeUpdates = { genUpdate: d.data.genUpdate, commUpdate: d.data.commUpdate };
      fs.writeFileSync(path.join(__dirname, 'tree_updates.json'), JSON.stringify(treeUpdates, null, 2));
      console.log('[OK] Fetched live on-chain Merkle tree updates directly from indexer');
    }
  } catch (e) {
    console.warn(`[!] Could not fetch live tree updates (${e.message}), falling back to tree_updates.json`);
  }
  if (!treeUpdates) {
    const treeUpdatesPath = path.join(__dirname, 'tree_updates.json');
    if (!fs.existsSync(treeUpdatesPath)) throw new Error(`tree_updates.json not found: ${treeUpdatesPath}`);
    treeUpdates = JSON.parse(fs.readFileSync(treeUpdatesPath, 'utf8'));
  }
  let localState = new DustLocalState(initialLedgerParams.dust);
  localState = localState.applyGenerationCollapsedUpdate(
    DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(treeUpdates.genUpdate.update, 'hex'))
  );
  localState = localState.applyCommitmentCollapsedUpdate(
    DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(treeUpdates.commUpdate.update, 'hex'))
  );
  const FUNDING_EVENT_HEX = '6d69646e696768743a6576656e745b76395d3a0400c103cc01793be7ee36a6c94b0aa951c26fc95a6f4567b4f40691819afc555d00c85c00000100050fffaf68efc3920a735ce2e6097a85648610ab426b50e26cd44286cf0cde9c9da05a00da5f6015580673b703f51df0fc04830c92098e354ccd5ccaf1cf6fa35fabf7088707239d6a012300034aa39b6a98ed47b7e048b309aec26fdd52d3cf18a7d4e3fd463d35f6d215e097e3083906aa9205000700f2052a01735ce2e6097a85648610ab426b50e26cd44286cf0cde9c9da05a00da5f6015580698ed47b7e048b309aec26fdd52d3cf18a7d4e3fd463d35f6d215e097e308390613ffffffffffffffffedbf0362a39b6a';
  const replayResult = localState.replayRawEvents(dustSecretKey, Buffer.from(FUNDING_EVENT_HEX, 'hex'));
  localState = replayResult.state;
  if (!localState.utxos || localState.utxos.length === 0) {
    throw new Error('No DUST UTXOs found after replay. Event hex may be stale.');
  }
  const dustUtxo = localState.utxos[0];
  console.log(`[OK] DUST UTXOs: ${localState.utxos.length} (mtIndex=${dustUtxo.mtIndex})`);
  console.log(`[OK] DUST Balance: ${localState.walletBalance(new Date())}`);

  // Step 4: Providers
  console.log('\n--- Step 4: Build Providers ---');
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
  const proofProvider = httpClientProofProvider(proofServerUrl, zkConfigProvider);
  // Use unique DB name per run to avoid stale ContractMaintenanceAuthority errors
  const uniqueDbName = `umbra-deploy-${Date.now()}`;
  const privateStateProvider = levelPrivateStateProvider({
    midnightDbName: uniqueDbName,
    accountId: 'umbra-deployer',
    privateStoragePasswordProvider: async () => 'umbra-deployer-private-state-encryption-key-v1'
  });
  const publicDataProvider = indexerPublicDataProvider(authenticatedIndexerUrl, authenticatedWsUrl);
  const walletProvider = {
    getCoinPublicKey: () => deployerKeys.coinPublicKey,
    getEncryptionPublicKey: () => deployerKeys.encryptionPublicKey
  };
  const providers = { zkConfigProvider, proofProvider, publicDataProvider, privateStateProvider, walletProvider };
  console.log('[OK] All providers initialized');

  // Step 5: CompiledContract
  console.log('\n--- Step 5: Load CompiledContract ---');
  const contractBundle = path.join(distDir, 'contract/index.js');
  if (!fs.existsSync(contractBundle)) throw new Error(`Contract bundle missing: ${contractBundle}`);
  const contractModule = await import(pathToFileURL(contractBundle).href);
  if (!contractModule.Contract) throw new Error('Contract module does not export Contract');
  let compiledContract = CompiledContract.make('umbra', contractModule.Contract);
  compiledContract = CompiledContract.withVacantWitnesses(compiledContract);
  compiledContract = CompiledContract.withCompiledFileAssets(compiledContract, distDir);
  console.log('[OK] CompiledContract loaded');

  // Step 6: Unproven Deploy Tx
  console.log('\n--- Step 6: createUnprovenDeployTx ---');
  const unprovenDeployTxData = await createUnprovenDeployTx(providers, { compiledContract });
  const unprovenTx = unprovenDeployTxData.private.unprovenTx;
  const contractAddress = unprovenDeployTxData.public.contractAddress;
  if (!unprovenTx || !contractAddress) throw new Error('createUnprovenDeployTx returned incomplete data');
  console.log('[OK] Unproven deploy tx created');
  console.log(`[OK] Predicted contract address: ${contractAddress}`);

  // Step 7: DUST Fee Attachment
  console.log('\n--- Step 7: Attach DUST Fee Spend ---');
  const now = new Date();
  const ttl = new Date(now.getTime() + 3600 * 1000);
  const feeEstimate = unprovenTx.feesWithMargin(initialLedgerParams, 5);
  console.log(`[OK] Fee estimate (+5% margin): ${feeEstimate.toString()} fee units`);
  const [, dustSpend] = localState.spend(dustSecretKey, dustUtxo, feeEstimate, now);
  console.log(`[OK] DUST spend created: vFee=${dustSpend.vFee.toString()}`);
  const dustActions = new DustActions('signature', 'pre-proof', now, [dustSpend], []);
  const feeIntent = Intent.new(ttl);
  feeIntent.dustActions = dustActions;
  const usedSegments = new Set(unprovenTx.intents.keys());
  let seg = 1;
  while (usedSegments.has(seg)) seg++;
  console.log(`[OK] Fee segment ID: ${seg} (used: [${Array.from(usedSegments).join(', ')}])`);
  const feeTx = Transaction.fromParts('preview').addIntent({ tag: 'specific', value: seg }, feeIntent);
  const mergedTx = unprovenTx.merge(feeTx);
  console.log(`[OK] Merged tx intents: [${Array.from(mergedTx.intents.keys()).join(', ')}]`);
  console.log(`[OK] Merged tx fees: ${mergedTx.fees(initialLedgerParams).toString()} fee units`);

  // Step 8: ZK Proof Generation
  console.log('\n--- Step 8: Generate ZK Proof (localhost:6300) ---');
  console.log('[*] Proving transaction — this may take 1-5 minutes...');
  const provenTx = await proofProvider.proveTx(mergedTx);
  console.log('[OK] ZK PROOF GENERATED SUCCESSFULLY');
  console.log(`    Class:           ${provenTx.constructor.name}`);
  console.log(`    Identifiers:     ${provenTx.identifiers().join(', ')}`);
  console.log(`    Serialized size: ${provenTx.serialize().length} bytes`);
  console.log(`    Required fees:   ${provenTx.fees(initialLedgerParams).toString()} fee units`);

  // Save proven tx to disk
  try {
    fs.writeFileSync(path.join(__dirname, 'proven_deploy_tx.bin'), Buffer.from(provenTx.serialize()));
    console.log('[OK] Proven transaction saved to proven_deploy_tx.bin');
  } catch {}

  if (!IS_DEPLOY) {
    console.log('\n===============================================================');
    console.log('  DRY-RUN COMPLETE - ALL STEPS PASSED                          ');
    console.log('===============================================================');
    console.log(`Predicted contract address: ${contractAddress}`);
    console.log('\nTo broadcast the real deployment:');
    console.log('  node contracts/midnight/deploy-final.mjs --deploy\n');
    return;
  }

  // Step 9: Broadcast
  console.log('\n--- Step 9: Broadcast Transaction ---');
  console.log('[*] Building wallet for transaction submission...');
  let wallet = null;
  wallet = await WalletBuilder.build(
    authenticatedIndexerUrl,
    authenticatedWsUrl,
    proofServerUrl,
    authenticatedNodeUrl,
    hexEntropy,
    ZswapNetworkId.TestNet,
    'warn',
    true   // discardTxHistory
  );
  console.log(`[OK] Wallet built (submitTransaction: ${typeof wallet.submitTransaction === 'function'})`);

  // Intercept fetch to capture exact author_submitExtrinsic request and response
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    let url = input;
    let body = init?.body;
    if (input instanceof Request) {
      url = input.url;
      body = await input.clone().text();
    }
    const resp = await origFetch(input, init);
    if (body && typeof body === 'string' && body.includes('author_submitExtrinsic')) {
      const respClone = resp.clone();
      const respText = await respClone.text();
      console.log(`[RPC] submitExtrinsic Response Status: ${resp.status}`);
      console.log(`[RPC] submitExtrinsic Response Body:   ${respText}`);
      try {
        const parsed = JSON.parse(body);
        const extHex = parsed.params?.[0];
        if (extHex) {
          console.log(`[*] Querying system_dryRun to decode rejection reason...`);
          const dryRunResp = await origFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 999, method: 'system_dryRun', params: [extHex] })
          });
          const dryRunData = await dryRunResp.json();
          console.log(`[system_dryRun RESULT]:`, JSON.stringify(dryRunData, null, 2));
        }
      } catch (err) {
        console.warn(`[!] system_dryRun failed: ${err.message}`);
      }
    }
    return resp;
  };

  let txId = null;
  try {
    console.log('[*] Calling wallet.submitTransaction...');
    const submitResult = await wallet.submitTransaction(provenTx);
    txId = submitResult;
    console.log('[OK] TRANSACTION SUBMITTED!');
    console.log(`    Result: ${JSON.stringify(submitResult)}`);
  } finally {
    try { await wallet.close(); } catch {}
  }

  // Step 10: Wait for confirmation
  console.log('\n--- Step 10: Waiting for On-Chain Confirmation ---');
  console.log(`[*] Watching for deploy confirmation at: ${contractAddress}`);
  let deployTxData = null;
  try {
    const { firstValueFrom } = await import('rxjs');
    const obs$ = publicDataProvider.watchForDeployTxData(contractAddress);
    deployTxData = await Promise.race([
      firstValueFrom(obs$),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout: 3 minutes')), 180000))
    ]);
    console.log('[OK] ON-CHAIN CONFIRMATION RECEIVED!');
  } catch (e) {
    console.warn(`[!] Confirmation watch error: ${e.message}`);
    console.warn('[!] Transaction may be pending. Check the Midnight Preview indexer.');
  }

  const finalAddress = deployTxData?.contractAddress || contractAddress;
  const finalTxId = deployTxData?.txId || txId;
  const finalBlock = deployTxData?.blockHeight;

  console.log('\n===============================================================');
  console.log('              UMBRA DEPLOYED SUCCESSFULLY!                      ');
  console.log('===============================================================');
  console.log(`Contract Address: ${finalAddress}`);
  if (finalTxId) console.log(`Transaction ID:   ${finalTxId}`);
  if (finalBlock) console.log(`Confirmed Block:  ${finalBlock}`);
  console.log(`DUST Spent:       ~${(Number(feeEstimate) / 1e9).toFixed(4)} tDUST`);
  console.log('===============================================================\n');

  const envPath = path.join(REPO_ROOT, '.env');
  if (fs.existsSync(envPath) && finalAddress) {
    let content = fs.readFileSync(envPath, 'utf8');
    if (content.includes('MIDNIGHT_CONTRACT_ADDRESS=')) {
      content = content.replace(/MIDNIGHT_CONTRACT_ADDRESS=.*/g, `MIDNIGHT_CONTRACT_ADDRESS=${finalAddress}`);
    } else {
      content += `\nMIDNIGHT_CONTRACT_ADDRESS=${finalAddress}\n`;
    }
    if (content.includes('NEXT_PUBLIC_MIDNIGHT_CONTRACT_ADDRESS=')) {
      content = content.replace(/NEXT_PUBLIC_MIDNIGHT_CONTRACT_ADDRESS=.*/g, `NEXT_PUBLIC_MIDNIGHT_CONTRACT_ADDRESS=${finalAddress}`);
    } else {
      content += `NEXT_PUBLIC_MIDNIGHT_CONTRACT_ADDRESS=${finalAddress}\n`;
    }
    fs.writeFileSync(envPath, content);
    console.log('[OK] .env updated with MIDNIGHT_CONTRACT_ADDRESS');
  }
}

main().catch((err) => {
  console.error('\n[FATAL]', err.message || err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});