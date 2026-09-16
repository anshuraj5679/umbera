import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

setNetworkId('preview');

const stateHex = fs.readFileSync('d:/midnight/contracts/midnight/confirmed_state.hex', 'utf8').trim();
console.log('Confirmed state hex length:', stateHex.length);

const distDir = 'd:/midnight/contracts/midnight/dist';
const contractBundle = path.join(distDir, 'contract/index.js');
const contractModule = await import(pathToFileURL(contractBundle).href);
let compiledContract = CompiledContract.make('umbra', contractModule.Contract);
compiledContract = CompiledContract.withVacantWitnesses(compiledContract);
compiledContract = CompiledContract.withCompiledFileAssets(compiledContract, distDir);

console.log('Contract loaded successfully');
const contractState = ledger.ContractState.deserialize(Buffer.from(stateHex, 'hex'));
console.log('ContractState deserialized successfully!');
console.log('ContractState operations / methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(contractState)));

const data = contractState.data;
console.log('ContractState data length:', data?.length);

// Check order commitment presence
const testCommitmentHex = '2505384e1285f13b32d6b65924642855e071cbcd0176a5095074a7cd11e36e50';
console.log(`Checking commitment ${testCommitmentHex} in state...`);
const stateStr = stateHex.toLowerCase();
console.log('Contains order commitment bytes in state:', stateStr.includes(testCommitmentHex));
