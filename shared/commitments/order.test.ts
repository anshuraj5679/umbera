import { describe, expect, it } from "vitest";
import { orderCommitmentAndNullifier, type OrderCommitmentInput } from "./order.js";

const baseInput: OrderCommitmentInput = {
  chainId: 421614,
  dexAddress: "0x3640FbFaA5FD8e0ADFf88F755953a91332B3e390",
  trader: "0x6b3a924379B9408D8110f10F084ca809863B378A",
  pairId: 0,
  batchId: 3n,
  orderId: 7n,
  encBaseDepositHandle: "101",
  encQuoteDepositHandle: "102",
  encBaseRequestHandle: "103",
  encQuoteRequestHandle: "104",
  expiry: 1779953005n,
  salt: "0x1111111111111111111111111111111111111111111111111111111111111111",
};

describe("order commitments", () => {
  it("is deterministic for the same private order envelope", () => {
    expect(orderCommitmentAndNullifier(baseInput)).toEqual(orderCommitmentAndNullifier(baseInput));
  });

  it("changes when the domain changes", () => {
    const left = orderCommitmentAndNullifier(baseInput);
    const right = orderCommitmentAndNullifier({ ...baseInput, chainId: 31337 });

    expect(right.commitment).not.toBe(left.commitment);
    expect(right.nullifier).not.toBe(left.nullifier);
  });

  it("changes when the order salt changes", () => {
    const left = orderCommitmentAndNullifier(baseInput);
    const right = orderCommitmentAndNullifier({
      ...baseInput,
      salt: "0x2222222222222222222222222222222222222222222222222222222222222222",
    });

    expect(right.commitment).not.toBe(left.commitment);
    expect(right.nullifier).not.toBe(left.nullifier);
  });

  it("changes when an account commitment is attached", () => {
    const left = orderCommitmentAndNullifier(baseInput);
    const right = orderCommitmentAndNullifier({
      ...baseInput,
      accountCommitment: "0x3333333333333333333333333333333333333333333333333333333333333333",
    });

    expect(right.commitment).not.toBe(left.commitment);
    expect(right.nullifier).not.toBe(left.nullifier);
  });
});
