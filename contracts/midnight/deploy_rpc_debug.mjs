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
  const env = {};
  for (const line of fs.readFileSync('d:/midnight/.env','utf8').split('\n')) {
    const t = line.trim();
    if (t && !t.startsWith('#')) {
      const i = t.indexOf('=');
      if (i !== -1) {
        let v = t.slice(i+1).trim();
        if ((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
        env[t.slice(0,i).trim()] = v;
      }
    }
  }
  return env;
}
const env = loadEnv();
const lp = ledger.LedgerParameters.initialParameters();
const seed = bip39.mnemonicToSeedSync(env.MIDNIGHT_DEPLOYER_SEED.trim());
const root = HDKey.fromMasterSeed(seed);
const dustSecretKey = ledger.DustSecretKey.fromSeed(root.derive("m/44'/2400'/0'/2/0").privateKey);
const dkeys = SecretKeys.fromSeed(root.derive("m/44'/2400'/0'/3/0").privateKey);

const tu = JSON.parse(fs.readFileSync('d:/midnight/contracts/midnight/tree_updates.json','utf8'));
let ls = new ledger.DustLocalState(lp.dust);
ls = ls.applyGenerationCollapsedUpdate(ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(tu.genUpdate.update,'hex')));
ls = ls.applyCommitmentCollapsedUpdate(ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(Buffer.from(tu.commUpdate.update,'hex')));
const EV='6d69646e696768743a6576656e745b76395d3a0400c103cc01793be7ee36a6c94b0aa951c26fc95a6f4567b4f40691819afc555d00c85c00000100050fffaf68efc3920a735ce2e6097a85648610ab426b50e26cd44286cf0cde9c9da05a00da5f6015580673b703f51df0fc04830c92098e354ccd5ccaf1cf6fa35fabf7088707239d6a012300034aa39b6a98ed47b7e048b309aec26fdd52d3cf18a7d4e3fd463d35f6d215e097e3083906aa9205000700f2052a01735ce2e6097a85648610ab426b50e26cd44286cf0cde9c9da05a00da5f6015580698ed47b7e048b309aec26fdd52d3cf18a7d4e3fd463d35f6d215e097e308390613ffffffffffffffffedbf0362a39b6a';
const rr = ls.replayRawEvents(dustSecretKey, Buffer.from(EV,'hex'));
ls = rr.state;
const utxo = ls.utxos[0];
console.log('DUST UTXO mtIndex:', utxo.mtIndex, 'balance:', ls.walletBalance(new Date()));

const distDir = 'd:/midnight/contracts/midnight/dist';
const zk = { async getZKIR(id){ const b=path.join(distDir,'zkir',`${id}.bzkir`),z=path.join(distDir,'zkir',`${id}.zkir`); return new Uint8Array(fs.readFileSync(fs.existsSync(b)?b:z)); }, async getProverKey(id){ return new Uint8Array(fs.readFileSync(path.join(distDir,'keys',`${id}.prover`))); }, async getVerifierKey(id){ return new Uint8Array(fs.readFileSync(path.join(distDir,'keys',`${id}.verifier`))); }, async get(id){ const [a,b,c]=await Promise.all([this.getZKIR(id),this.getProverKey(id),this.getVerifierKey(id)]); return{zkir:a,proverKey:b,verifierKey:c}; } };
const pp = httpClientProofProvider('http://localhost:6300', zk);
const psp = levelPrivateStateProvider({ midnightDbName:`umbra-rpc-${Date.now()}`, accountId:'deployer', privateStoragePasswordProvider:async()=>'pass' });
const wp = { getCoinPublicKey:()=>dkeys.coinPublicKey, getEncryptionPublicKey:()=>dkeys.encryptionPublicKey };
const cm = await import(pathToFileURL(path.join(distDir,'contract/index.js')).href);
let cc = CompiledContract.make('umbra', cm.Contract);
cc = CompiledContract.withVacantWitnesses(cc);
cc = CompiledContract.withCompiledFileAssets(cc, distDir);

console.log('Building unproven tx...');
const ud = await createUnprovenDeployTx({zkConfigProvider:zk,walletProvider:wp,privateStateProvider:psp,proofProvider:pp},{compiledContract:cc});
const utx = ud.private.unprovenTx;
const ca = ud.public.contractAddress;
console.log('Contract address:', ca);

const now = new Date();
const fee = utx.feesWithMargin(lp,5);
console.log('Fee:', fee.toString());
const [,ds] = ls.spend(dustSecretKey, utxo, fee, now);
const da = new ledger.DustActions('signature','pre-proof',now,[ds],[]);
const fi = ledger.Intent.new(new Date(now.getTime()+3600000));
fi.dustActions = da;
const used = new Set(utx.intents.keys());
let seg=1; while(used.has(seg))seg++;
const ft = ledger.Transaction.fromParts('preview').addIntent({tag:'specific',value:seg},fi);
const mt = utx.merge(ft);
console.log('Proving...');
const ptx = await pp.proveTx(mt);
console.log('Proved!', ptx.serialize().length, 'bytes');

// Serialize the proven tx
const txBytes = ptx.serialize();
const txHex = '0x' + Buffer.from(txBytes).toString('hex');
console.log('TX hex length:', txHex.length);

// Submit via direct JSON-RPC with dryRun first
const bk = env.BLOCKFROST_PROJECT_ID;
const nodeUrl = env.MIDNIGHT_NODE_URL || 'https://rpc.midnight-preview.blockfrost.io';

// Try system_dryRun first (tests tx without broadcasting)
console.log('\n--- Trying system_dryRun ---');
const dryRes = await fetch(nodeUrl, {
  method: 'POST',
  headers: { 'project_id': bk, 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'system_dryRun', params:[txHex] })
});
const dryData = await dryRes.json();
console.log('dryRun result:', JSON.stringify(dryData, null, 2));

// Try author_submitExtrinsic
console.log('\n--- Trying author_submitExtrinsic ---');
const subRes = await fetch(nodeUrl, {
  method: 'POST',
  headers: { 'project_id': bk, 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc:'2.0', id:2, method:'author_submitExtrinsic', params:[txHex] })
});
const subData = await subRes.json();
console.log('submitExtrinsic result:', JSON.stringify(subData, null, 2));