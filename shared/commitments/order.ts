import { encodeAbiParameters, getAddress, keccak256, parseAbiParameters, type Hex } from "viem";

const ORDER_COMMITMENT_VERSION = "obsidian.order.commitment.v1";
const ORDER_NULLIFIER_VERSION = "obsidian.order.nullifier.v1";
const ZERO_ACCOUNT_COMMITMENT = "0x0000000000000000000000000000000000000000000000000000000000000000";

export type OrderCommitmentInput = {
  chainId: number;
  dexAddress: `0x${string}`;
  trader: `0x${string}`;
  accountCommitment?: Hex | null;
  pairId: number;
  batchId: bigint;
  orderId: bigint;
  encBaseDepositHandle: string;
  encQuoteDepositHandle: string;
  encBaseRequestHandle: string;
  encQuoteRequestHandle: string;
  expiry: bigint;
  salt: Hex;
};

const orderCommitmentAbi = parseAbiParameters(
  "string version,uint256 chainId,address dexAddress,address trader,bytes32 accountCommitment,uint256 pairId,uint256 batchId,uint256 orderId,string encBaseDepositHandle,string encQuoteDepositHandle,string encBaseRequestHandle,string encQuoteRequestHandle,uint256 expiry,bytes32 salt",
);

const nullifierAbi = parseAbiParameters(
  "string version,bytes32 commitment,bytes32 salt",
);

export function orderCommitment(input: OrderCommitmentInput): Hex {
  return keccak256(encodeAbiParameters(orderCommitmentAbi, [
    ORDER_COMMITMENT_VERSION,
    BigInt(input.chainId),
    getAddress(input.dexAddress),
    getAddress(input.trader),
    normalizeBytes32((input.accountCommitment ?? ZERO_ACCOUNT_COMMITMENT) as Hex),
    BigInt(input.pairId),
    input.batchId,
    input.orderId,
    input.encBaseDepositHandle,
    input.encQuoteDepositHandle,
    input.encBaseRequestHandle,
    input.encQuoteRequestHandle,
    input.expiry,
    normalizeBytes32(input.salt),
  ]));
}

export function orderNullifier(input: { commitment: Hex; salt: Hex }): Hex {
  return keccak256(encodeAbiParameters(nullifierAbi, [
    ORDER_NULLIFIER_VERSION,
    normalizeBytes32(input.commitment),
    normalizeBytes32(input.salt),
  ]));
}

export function orderCommitmentAndNullifier(input: OrderCommitmentInput) {
  const commitment = orderCommitment(input);
  return {
    commitment,
    nullifier: orderNullifier({ commitment, salt: input.salt }),
  };
}

function normalizeBytes32(value: Hex): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("expected bytes32 hex value");
  }
  return value.toLowerCase() as Hex;
}
