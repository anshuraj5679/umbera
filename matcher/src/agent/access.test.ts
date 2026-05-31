import { describe, expect, it } from "vitest";
import { consumeAgentAccessToken, issueAgentAccessToken, publicAgentAccessGrant } from "./access.js";

describe("agent access tokens", () => {
  it("issues opaque bearer tokens and stores only token hashes", async () => {
    const db = fakeAccessDb();

    const grant = await issueAgentAccessToken(db as any, {
      secret: "test-access-secret-123",
      chainId: 421614,
      dexAddress: "0x1111111111111111111111111111111111111111",
      ttlSec: 600,
      maxUses: 1,
      subjectHash: "sha256:subject",
    });

    expect(grant.token).toMatch(/^obsat_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(db.rows[0].tokenHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(db.rows)).not.toContain(grant.token);
    expect(publicAgentAccessGrant(grant)).toMatchObject({
      ok: true,
      tokenType: "Bearer",
      scope: "agent:order",
      chainId: 421614,
      maxUses: 1,
    });
  });

  it("consumes a valid token once and rejects malformed tokens before DB use", async () => {
    const db = fakeAccessDb();
    const secret = "test-access-secret-123";
    const grant = await issueAgentAccessToken(db as any, {
      secret,
      chainId: 421614,
      dexAddress: "0x1111111111111111111111111111111111111111",
      ttlSec: 600,
      maxUses: 1,
    });

    await expect(consumeAgentAccessToken(db as any, {
      token: "bad-token",
      secret,
      chainId: 421614,
      dexAddress: "0x1111111111111111111111111111111111111111",
    })).rejects.toMatchObject({ code: "agent_access_token_malformed" });

    const consumed = await consumeAgentAccessToken(db as any, {
      token: grant.token,
      secret,
      chainId: 421614,
      dexAddress: "0x1111111111111111111111111111111111111111",
    });

    expect(consumed.remainingUses).toBe(0);
    expect(db.rows[0].usedCount).toBe(1);
    expect(db.rows[0].status).toBe("USED");
  });
});

function fakeAccessDb() {
  const rows: any[] = [];
  return {
    rows,
    insert() {
      return {
        values(value: any) {
          rows.push(value);
          return Promise.resolve();
        },
      };
    },
    select() {
      return {
        from() {
          return {
            where() {
              return {
                limit() {
                  const active = rows.find((row) =>
                    row.status === "ACTIVE"
                    && row.expiresAt > new Date()
                    && row.usedCount < row.maxUses
                  );
                  return Promise.resolve(active ? [active] : []);
                },
              };
            },
          };
        },
      };
    },
    update() {
      return {
        set(value: any) {
          return {
            where() {
              if (rows[0]) {
                rows[0].usedCount += 1;
                rows[0].lastUsedAt = value.lastUsedAt;
                rows[0].status = value.status;
              }
              return Promise.resolve();
            },
          };
        },
      };
    },
  };
}
