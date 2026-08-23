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
    networkId: process.env.NEXT_PUBLIC_MIDNIGHT_NETWORK_ID ?? "preprod",
    indexerUrl: process.env.MIDNIGHT_INDEXER_URL ?? "https://midnight-preprod.blockfrost.io/api/v0",
    indexerWsUrl: process.env.MIDNIGHT_INDEXER_WS_URL ?? "wss://midnight-preprod.blockfrost.io/api/v0/ws",
    nodeUrl: process.env.MIDNIGHT_NODE_URL ?? "https://rpc.midnight-preprod.blockfrost.io",
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
        publicDataProvider = new (indexerPkg.value as any).IndexerPublicDataProvider(cfg.indexerUrl, cfg.indexerWsUrl);
      }
      if (proofPkg.status === "fulfilled") {
        proofProvider = new (proofPkg.value as any).HttpClientProofProvider(cfg.proofServerUrl);
      }
      if (levelPkg.status === "fulfilled") {
        privateStateProvider = new (levelPkg.value as any).LevelPrivateStateProvider({ dbName: "umbra-private-state" });
      }
      isFullyConnected = !!(publicDataProvider && proofProvider && privateStateProvider);
    }
  } catch (err) {
    console.warn("[midnight-client] Provider init warning:", err);
  }

  return { config: cfg, publicDataProvider, privateStateProvider, proofProvider, ready: isFullyConnected };
}
