import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

type Runtime = {
  client: any;
  Encryptable: any;
  FheTypes: any;
  account: Address;
};

let runtime: Runtime | null = null;

export async function initCofhe(opts: { privateKey: `0x${string}`; rpcUrl: string; chainId: number }) {
  if (runtime) return runtime;
  if (opts.chainId !== arbitrumSepolia.id) {
    throw new Error(`unsupported CoFHE matcher chain ${opts.chainId}`);
  }

  installMemoryLocalStorage();

  const [nodeSdk, sdk, chains] = await Promise.all([
    import("@cofhe/sdk/node"),
    import("@cofhe/sdk"),
    import("@cofhe/sdk/chains"),
  ]);

  const account = privateKeyToAccount(opts.privateKey);
  const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(opts.rpcUrl) });
  const walletClient = createWalletClient({ chain: arbitrumSepolia, transport: http(opts.rpcUrl), account });
  const client = nodeSdk.createCofheClient(nodeSdk.createCofheConfig({ supportedChains: [chains.arbSepolia] }));

  await client.connect(publicClient as any, walletClient as any);
  await client.permits.getOrCreateSelfPermit(arbitrumSepolia.id, account.address, {
    issuer: account.address,
    name: "Obsidian Matcher Daemon",
  });

  runtime = { client, Encryptable: sdk.Encryptable, FheTypes: sdk.FheTypes, account: account.address };
  console.log("[fhe] CoFHE matcher runtime ready", account.address);
  return runtime;
}

export function getCofheRuntime() {
  if (!runtime) throw new Error("CoFHE matcher runtime not initialized");
  return runtime;
}

export async function generatePermit(_dexAddr: string) {
  return getCofheRuntime().client.permits.getActivePermit();
}

function installMemoryLocalStorage() {
  const data = new Map<string, string>();
  const storage = {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
}
