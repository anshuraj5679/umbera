import { describe, expect, it } from "vitest";
import { Wallet } from "ethers";
import { verifySignedHeader } from "./auth.js";

function runMiddleware(matcherAddress: string, headers: Record<string, string | undefined>) {
  let statusCode = 200;
  let body: unknown;
  let nextCalled = false;
  const req = { header: (name: string) => headers[name.toLowerCase()] } as any;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  } as any;
  verifySignedHeader(matcherAddress)(req, res, () => { nextCalled = true; });
  return { statusCode, body, nextCalled };
}

describe("verifySignedHeader", () => {
  it("accepts a challenge signed by the matcher key", async () => {
    const wallet = Wallet.createRandom();
    const message = "publish batch 1";
    const signature = await wallet.signMessage(message);

    const result = runMiddleware(wallet.address, {
      "x-message": message,
      "x-signature": signature,
    });

    expect(result.nextCalled).toBe(true);
    expect(result.statusCode).toBe(200);
  });

  it("rejects a signature from a different wallet", async () => {
    const matcher = Wallet.createRandom();
    const other = Wallet.createRandom();
    const message = "publish batch 1";
    const signature = await other.signMessage(message);

    const result = runMiddleware(matcher.address, {
      "x-message": message,
      "x-signature": signature,
    });

    expect(result.nextCalled).toBe(false);
    expect(result.statusCode).toBe(403);
  });
});
