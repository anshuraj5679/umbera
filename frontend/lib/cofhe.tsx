"use client";

import { createCofheClient, createCofheConfig } from "@cofhe/sdk/web";
import { Encryptable, FheTypes, type CofheClient } from "@cofhe/sdk";
import { arbSepolia } from "@cofhe/sdk/chains";
import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from "react";
import { useAccount, useWalletClient, usePublicClient } from "wagmi";

type Ctx = {
  ready: boolean;
  error: string | null;
  encrypt128: (values: bigint[]) => Promise<any[]>;
  unsealUint128: (handle: bigint) => Promise<bigint>;
  decryptForViewUint128: (handle: bigint) => Promise<bigint>;
  decryptForTxUint128: (handle: bigint) => Promise<{ ctHash: bigint | string; decryptedValue: bigint; signature: `0x${string}` }>;
};

const CofheCtx = createContext<Ctx>({
  ready: false,
  error: null,
  encrypt128: async () => { throw new Error("cofhe not ready"); },
  unsealUint128: async () => { throw new Error("cofhe not ready"); },
  decryptForViewUint128: async () => { throw new Error("cofhe not ready"); },
  decryptForTxUint128: async () => { throw new Error("cofhe not ready"); },
});

function formatError(stage: string, e: any): string {
  const msg = e?.message ?? String(e);
  const cause = e?.cause ? ` · cause: ${e.cause.message ?? String(e.cause)}` : "";
  return `${stage}: ${msg}${cause}`;
}

export function CofheProvider({ children }: { children: ReactNode }) {
  const { address, isConnected, chain } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const client = useMemo<CofheClient | null>(() => {
    try {
      // Override Fhenix testnet URLs with same-origin proxy paths to bypass
      // CORS + COEP CORP requirements in the browser.
      const proxyOrigin = typeof window !== "undefined" ? window.location.origin : "";
      const proxiedArbSepolia = {
        ...arbSepolia,
        coFheUrl: `${proxyOrigin}/cofhe-proxy/main`,
        verifierUrl: `${proxyOrigin}/cofhe-proxy/vrf`,
        thresholdNetworkUrl: `${proxyOrigin}/cofhe-proxy/tn`,
      };
      const cfg = createCofheConfig({ supportedChains: [proxiedArbSepolia] });
      return createCofheClient(cfg);
    } catch (e) {
      console.error("[cofhe] config failed", e);
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);
    if (!client || !isConnected || !walletClient || !publicClient || !address) return;

    (async () => {
      let stage = "connect";
      try {
        await client.connect(publicClient as any, walletClient as any);
        console.log("[cofhe] connected", { account: address, chainId: chain?.id });

        // Permit is shared by decryptForView and decryptForTx; pre-warm so users sign once.
        stage = "permit";
        try {
          await client.permits.getOrCreateSelfPermit(chain?.id, address);
          console.log("[cofhe] permit ready");
        } catch (pe) {
          console.warn("[cofhe] permit pre-warm failed (will retry on first decrypt)", pe);
        }

        if (!cancelled) {
          setReady(true);
          console.log("[cofhe] READY");
        }
      } catch (e: any) {
        const msg = formatError(stage, e);
        if (!cancelled) setError(msg);
        console.error("[cofhe] init failed", { stage, error: e, message: msg, stack: e?.stack });
      }
    })();

    return () => { cancelled = true; };
  }, [client, isConnected, walletClient, publicClient, address, chain?.id]);

  const encrypt128 = useCallback(async (values: bigint[]) => {
    if (!client) throw new Error("cofhe client not initialized");
    const builder = client.encryptInputs(values.map((v) => Encryptable.uint128(v)));
    const encrypted = await builder.execute();
    return encrypted as any[];
  }, [client]);

  const decryptForViewUint128 = useCallback(async (handle: bigint) => {
    if (!client) throw new Error("cofhe client not initialized");
    const r = await client.decryptForView(handle, FheTypes.Uint128).execute();
    return BigInt(r as any);
  }, [client]);

  const decryptForTxUint128 = useCallback(async (handle: bigint) => {
    if (!client) throw new Error("cofhe client not initialized");
    const r = await client.decryptForTx(handle).withPermit().execute();
    return {
      ctHash: r.ctHash,
      decryptedValue: BigInt(r.decryptedValue),
      signature: r.signature,
    };
  }, [client]);

  const unsealUint128 = decryptForViewUint128;

  return (
    <CofheCtx.Provider value={{ ready, error, encrypt128, unsealUint128, decryptForViewUint128, decryptForTxUint128 }}>
      {children}
    </CofheCtx.Provider>
  );
}

export function useCofhe() {
  return useContext(CofheCtx);
}

/** @deprecated Use useCofhe().encrypt128 inside a component instead. */
export async function encrypt128(_values: bigint[]): Promise<any[]> {
  throw new Error("standalone encrypt128 deprecated — use useCofhe().encrypt128");
}
