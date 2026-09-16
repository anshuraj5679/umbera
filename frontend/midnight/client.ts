/**
 * Midnight Network — Client Provider Configuration
 *
 * Configures the Midnight.js provider stack:
 * - Public Data Provider (GraphQL indexer)
 * - Private State Provider (AES-256-GCM encrypted local storage)
 * - Proof Provider (local Docker proof server on port 6300)
 *
 * @module midnight/client
 */

export type MidnightClientConfig = {
  networkId: string;
  indexerUrl: string;
  indexerWsUrl: string;
  nodeUrl: string;
  proofServerUrl: string;
  blockfrostProjectId?: string;
};

export function getDefaultConfig(): MidnightClientConfig {
  return {
    networkId: process.env.NEXT_PUBLIC_MIDNIGHT_NETWORK_ID ?? "preview",
    indexerUrl: process.env.MIDNIGHT_INDEXER_URL ?? "https://midnight-preview.blockfrost.io/api/v0",
    indexerWsUrl: process.env.MIDNIGHT_INDEXER_WS_URL ?? "wss://midnight-preview.blockfrost.io/api/v0/ws",
    nodeUrl: process.env.MIDNIGHT_NODE_URL ?? "https://rpc.midnight-preview.blockfrost.io",
    proofServerUrl: process.env.PROOF_SERVER_URL ?? "http://localhost:6300",
    blockfrostProjectId: process.env.BLOCKFROST_PROJECT_ID ?? undefined,
  };
}

export async function createMidnightProviders(config?: MidnightClientConfig) {
  const cfg = config ?? getDefaultConfig();
  let publicDataProvider: any = null;
  let privateStateProvider: any = null;
  let proofProvider: any = null;
  let isFullyConnected = false;

  try {
    if (typeof window !== "undefined") {
      const indexerModName = "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
      const proofModName = "@midnight-ntwrk/midnight-js-http-client-proof-provider";
      const levelModName = "@midnight-ntwrk/midnight-js-level-private-state-provider";

      const [indexerPkg, proofPkg, levelPkg] = await Promise.allSettled([
        import(/* webpackIgnore: true */ indexerModName),
        import(/* webpackIgnore: true */ proofModName),
        import(/* webpackIgnore: true */ levelModName),
      ]);

      if (indexerPkg.status === "fulfilled") {
        const mod = indexerPkg.value as any;
        publicDataProvider = typeof mod.indexerPublicDataProvider === "function"
          ? mod.indexerPublicDataProvider(cfg.indexerUrl, cfg.indexerWsUrl)
          : typeof mod.IndexerPublicDataProvider === "function"
          ? new mod.IndexerPublicDataProvider(cfg.indexerUrl, cfg.indexerWsUrl)
          : null;
      }
      if (proofPkg.status === "fulfilled") {
        const mod = proofPkg.value as any;
        proofProvider = typeof mod.httpClientProofProvider === "function"
          ? mod.httpClientProofProvider(cfg.proofServerUrl)
          : typeof mod.HttpClientProofProvider === "function"
          ? new mod.HttpClientProofProvider(cfg.proofServerUrl)
          : null;
      }
      if (levelPkg.status === "fulfilled") {
        const mod = levelPkg.value as any;
        privateStateProvider = typeof mod.levelPrivateStateProvider === "function"
          ? mod.levelPrivateStateProvider({
              midnightDbName: "umbra-private-state",
              accountId: "umbra-account",
              privateStoragePasswordProvider: () => "umbra-secure-password-16char",
            })
          : typeof mod.LevelPrivateStateProvider === "function"
          ? new mod.LevelPrivateStateProvider({ dbName: "umbra-private-state" })
          : null;
      }
      isFullyConnected = !!(publicDataProvider && proofProvider && privateStateProvider);
    }
  } catch (err) {
    console.warn("[midnight-client] Provider init warning:", err);
  }

  return { config: cfg, publicDataProvider, privateStateProvider, proofProvider, ready: isFullyConnected };
}
