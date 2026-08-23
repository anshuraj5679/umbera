/**
 * Midnight Network — Lace Wallet Connector
 *
 * Detects and connects to the Lace wallet for Midnight DApp interaction.
 * NEVER requests seed phrases, private keys, or wallet passwords.
 * The backend never owns the user's wallet keys.
 *
 * @module midnight/wallet
 */

export type MidnightWalletState = {
  connected: boolean;
  address: string | null;
  networkId: string | null;
  error: string | null;
};

export function isLaceAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return !!(window as any).midnight?.mnLace;
}

function getLace() {
  if (!isLaceAvailable()) {
    throw new Error("Lace wallet not detected. Please install the Lace browser extension.");
  }
  return (window as any).midnight.mnLace;
}

export async function connectLace(networkId: string = "preprod"): Promise<MidnightWalletState> {
  try {
    const lace = getLace();
    const api = await lace.connect(networkId);
    if (!api) {
      return { connected: false, address: null, networkId: null, error: "User rejected connection." };
    }
    const address = await api.getAddress();
    return { connected: true, address: address ?? null, networkId, error: null };
  } catch (err: any) {
    return { connected: false, address: null, networkId: null, error: err?.message ?? String(err) };
  }
}

export async function isLaceEnabled(): Promise<boolean> {
  try {
    const lace = getLace();
    return await lace.isEnabled();
  } catch {
    return false;
  }
}

export function disconnectLace(): MidnightWalletState {
  return { connected: false, address: null, networkId: null, error: null };
}
