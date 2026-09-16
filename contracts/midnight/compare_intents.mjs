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
const zkConfigProvider = {
  async getZKIR(id) {
    const bz = path.join(distDir, 'zkir', `${id}.bzkir`);
    const z = path.join(distDir, 'zkir', `${id}.zkir`);
    return new Uint8Array(fs.readFileSync(fs.existsSync(bz) ? bz : z));
  },
  async getProverKey(id) { return new Uint8Array(fs.readFileSync(path.join(distDir, 'keys', `${id}.prover`))); },
  async getVerifierKey(id) { return new Uint8Array(fs.readFileSync(path.join(distDir, 'keys', `${id}.verifier`))); },
  async get(id) {
    const [zkir, proverKey, verifierKey] = await Promise.all([this.getZKIR(id), this.getProverKey(id), this.getVerifierKey(id)]);
    return { zkir, proverKey, verifierKey };
  }
};

const contractAddress = env.MIDNIGHT_CONTRACT_ADDRESS;
const authQuery = '?project_id=' + env.BLOCKFROST_PROJECT_ID;
const publicDataProvider = indexerPublicDataProvider(`${env.MIDNIGHT_INDEXER_URL}${authQuery}`, `${env.MIDNIGHT_INDEXER_WS_URL || 'wss://midnight-preview.blockfrost.io/api/v0/ws'}${authQuery}`);
const privateStateProvider = levelPrivateStateProvider({
  midnightDbName: `umbra-debug-${Date.now()}`,
  accountId: 'umbra-debug-op',
  privateStoragePasswordProvider: async () => 'umbra-debug-pass-16chars'
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
console.log('UnprovenTx intent segments:', Array.from(unprovenTx.intents.keys()));

const lp = ledger.LedgerParameters.initialParameters();
console.log('UnprovenTx fees:', unprovenTx.fees(lp).toString());

// Now let's test what deploy tx does
import { createUnprovenDeployTx } from '@midnight-ntwrk/midnight-js-contracts';
const deployTxData = await createUnprovenDeployTx(
  { zkConfigProvider, walletProvider, privateStateProvider },
  { compiledContract }
);
const deployTx = deployTxData.private.unprovenTx;
console.log('DeployTx intent segments:', Array.from(deployTx.intents.keys()));
console.log('DeployTx fees:', deployTx.fees(lp).toString());
