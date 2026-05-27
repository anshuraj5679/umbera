import { describe, expect, it } from "vitest";
import { createSessionAccountSchema, publicSessionAccountRow } from "./session.js";

describe("session account privacy", () => {
  it("requires an owner commitment or private owner material", () => {
    const parsed = createSessionAccountSchema.safeParse({
      sessionPublicKey: "0x6b3a924379B9408D8110f10F084ca809863B378A",
    });

    expect(parsed.success).toBe(false);
  });

  it("does not expose owner commitment or session public key in public rows", () => {
    const row = publicSessionAccountRow({
      id: "acct_1234",
      address: "0xsession",
      chainId: 421614,
      dexAddress: "0xdex",
      ownerCommitment: "0xowner",
      sessionPublicKey: "0xsession",
      accountCommitment: "0xcommitment",
      accountNullifier: "0xnullifier",
      labelHash: "sha256:label",
      createdTxHash: "0xtx",
      lastSeenAt: new Date("2026-05-27T00:00:00.000Z"),
      status: "ACTIVE",
      createdAt: new Date("2026-05-27T00:00:00.000Z"),
      updatedAt: new Date("2026-05-27T00:01:00.000Z"),
    });

    expect(row).toEqual({
      id: "acct_1234",
      chainId: 421614,
      dexAddress: "0xdex",
      accountCommitment: "0xcommitment",
      labelHash: "sha256:label",
      status: "ACTIVE",
      createdTxHash: "0xtx",
      lastSeenAt: "2026-05-27T00:00:00.000Z",
      createdAt: "2026-05-27T00:00:00.000Z",
      updatedAt: "2026-05-27T00:01:00.000Z",
    });
    expect("ownerCommitment" in row).toBe(false);
    expect("accountNullifier" in row).toBe(false);
    expect("sessionPublicKey" in row).toBe(false);
    expect("address" in row).toBe(false);
  });
});
