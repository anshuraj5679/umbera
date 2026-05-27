import { describe, expect, it } from "vitest";
import {
  accountCommitmentAndNullifier,
  accountSalt,
  ownerCommitment,
} from "./account.js";

const chainId = 421614;
const dexAddress = "0x3640FbFaA5FD8e0ADFf88F755953a91332B3e390";
const ownerAddress = "0x060613A360fFe3213818c022b404E5AA9D755611";
const sessionPublicKey = "0x6b3a924379B9408D8110f10F084ca809863B378A";
const ownerSalt = "0x1111111111111111111111111111111111111111111111111111111111111111";

describe("account commitments", () => {
  it("derives deterministic account commitment and nullifier without exposing owner address", () => {
    const owner = ownerCommitment({ chainId, dexAddress, ownerAddress, salt: ownerSalt });
    const account = accountCommitmentAndNullifier({ chainId, dexAddress, ownerCommitment: owner, sessionPublicKey });
    const repeated = accountCommitmentAndNullifier({ chainId, dexAddress, ownerCommitment: owner, sessionPublicKey });

    expect(account).toEqual(repeated);
    expect(account.commitment).toMatch(/^0x[0-9a-f]{64}$/);
    expect(account.nullifier).toMatch(/^0x[0-9a-f]{64}$/);
    expect(account.salt).toBe(accountSalt({ chainId, dexAddress, ownerCommitment: owner, sessionPublicKey }));
    expect(JSON.stringify(account).toLowerCase()).not.toContain(ownerAddress.toLowerCase().slice(2));
  });

  it("changes commitment when the owner salt changes", () => {
    const firstOwner = ownerCommitment({ chainId, dexAddress, ownerAddress, salt: ownerSalt });
    const secondOwner = ownerCommitment({
      chainId,
      dexAddress,
      ownerAddress,
      salt: "0x2222222222222222222222222222222222222222222222222222222222222222",
    });

    expect(firstOwner).not.toBe(secondOwner);
    expect(accountCommitmentAndNullifier({
      chainId,
      dexAddress,
      ownerCommitment: firstOwner,
      sessionPublicKey,
    }).commitment).not.toBe(accountCommitmentAndNullifier({
      chainId,
      dexAddress,
      ownerCommitment: secondOwner,
      sessionPublicKey,
    }).commitment);
  });
});
