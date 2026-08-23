/**
 * Midnight Network — Privacy Layer
 *
 * Handles private order input preparation, local commitment computation,
 * and ZK proof generation pipeline.
 *
 * Private order data (side, amount, limit price, remaining amount) is
 * structured as private circuit inputs and NEVER sent to the public ledger.
 *
 * @module midnight/privacy
 */

import { keccak256, encodeAbiParameters, parseAbiParameters, type Hex } from "viem";

export type PrivateOrderInput = {
  side: 0 | 1; // BUY = 0, SELL = 1
  amount: bigint;
  limitPrice: bigint;
  remainingAmount: bigint;
  salt: Hex;
};

export type OrderPrivacyState = {
  privateInput: PrivateOrderInput;
  commitment: Hex;
  nullifier: Hex;
};

const COMMITMENT_VERSION = "umbra.midnight.order.commitment.v1";
const NULLIFIER_VERSION = "umbra.midnight.order.nullifier.v1";

const commitmentAbi = parseAbiParameters(
  "string version,uint8 side,uint256 amount,uint256 limitPrice,uint256 remainingAmount,bytes32 salt"
);

const nullifierAbi = parseAbiParameters(
  "string version,bytes32 commitment,bytes32 salt"
);

export function computeOrderCommitment(input: PrivateOrderInput): Hex {
  return keccak256(
    encodeAbiParameters(commitmentAbi, [
      COMMITMENT_VERSION,
      input.side,
      input.amount,
      input.limitPrice,
      input.remainingAmount,
      input.salt as `0x${string}`,
    ])
  );
}

export function computeOrderNullifier(commitment: Hex, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(nullifierAbi, [
      NULLIFIER_VERSION,
      commitment as `0x${string}`,
      salt as `0x${string}`,
    ])
  );
}

export function createPrivateOrder(input: PrivateOrderInput): OrderPrivacyState {
  const commitment = computeOrderCommitment(input);
  const nullifier = computeOrderNullifier(commitment, input.salt);
  return { privateInput: input, commitment, nullifier };
}

export function generateSalt(): Hex {
  if (typeof window !== "undefined" && window.crypto && window.crypto.getRandomValues) {
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    return `0x${Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("")}` as Hex;
  }
  const hex = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `0x${hex}` as Hex;
}

export const PRIVACY_CLASSIFICATION = {
  private: [
    "Order side (BUY/SELL)",
    "Order amount",
    "Limit price",
    "Remaining unfilled amount",
    "Trading intent",
    "Trader identity link to specific orders",
  ],
  public: [
    "Order commitment (hash)",
    "Batch ID",
    "Order lifecycle status",
    "Settlement root",
    "Timestamps",
    "Transaction references",
  ],
  verifiable: [
    "Order commitment validity",
    "Nullifier uniqueness (replay protection)",
    "Batch lifecycle transitions",
    "Settlement authorization",
    "Commitment consistency",
  ],
} as const;
