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
  shieldedAddress?: string | null;
  unshieldedAddress?: string | null;
  hasDust?: boolean;
  dustBalance?: number;
  isRealWallet?: boolean;
  api?: any;
};

let activeLaceApi: any = null;

const STORAGE_KEY_DUST_BALANCE = "umbra_lace_tdust_balance";
const STORAGE_KEY_IS_REAL = "umbra_is_real_lace_connected";
const STORAGE_KEY_TOTAL_DEDUCTED = "umbra_lace_cumulative_deductions";
const STORAGE_KEY_RAW_LACE_BALANCE = "umbra_lace_raw_onchain_balance";
const DEFAULT_FAUCET_DUST = 25000.0;

export function getCumulativeOrderDeductions(): number {
  if (typeof window === "undefined") return 0;
  try {
    const v = localStorage.getItem(STORAGE_KEY_TOTAL_DEDUCTED);
    const n = parseFloat(v || "0");
    return isNaN(n) ? 0 : n;
  } catch {
    return 0;
  }
}

export function recordOrderDeduction(amount: number): number {
  if (amount <= 0) return getStoredDustBalance();
  const currentDeductions = getCumulativeOrderDeductions();
  const newDeductions = Math.round((currentDeductions + amount) * 100) / 100;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY_TOTAL_DEDUCTED, newDeductions.toFixed(2));
    } catch {}
  }
  return deductStoredDustBalance(amount);
}

export function resetOrderDeductions(): void {
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY_TOTAL_DEDUCTED);
    } catch {}
  }
}

export function getStoredDustBalance(): number {
  if (typeof window === "undefined") return DEFAULT_FAUCET_DUST;
  try {
    const isReal = localStorage.getItem(STORAGE_KEY_IS_REAL) === "true";
    const val = localStorage.getItem(STORAGE_KEY_DUST_BALANCE);
    if (!val) {
      if (!isReal) {
        localStorage.setItem(STORAGE_KEY_DUST_BALANCE, DEFAULT_FAUCET_DUST.toFixed(2));
        return DEFAULT_FAUCET_DUST;
      }
      return 0;
    }
    const parsed = parseFloat(val);
    if (isNaN(parsed)) {
      return isReal ? 0 : DEFAULT_FAUCET_DUST;
    }
    return parsed;
  } catch {
    return DEFAULT_FAUCET_DUST;
  }
}

export function saveStoredDustBalance(amount: number, isReal: boolean = true): void {
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY_DUST_BALANCE, amount.toFixed(2));
      if (isReal) {
        localStorage.setItem(STORAGE_KEY_IS_REAL, "true");
      }
    } catch {}
  }
}

export function deductStoredDustBalance(amount: number): number {
  const current = getStoredDustBalance();
  const next = Math.max(0, Math.round((current - amount) * 100) / 100);
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY_DUST_BALANCE, next.toFixed(2));
    } catch {}
  }
  return next;
}

export function refillStoredDustBalance(amount: number = DEFAULT_FAUCET_DUST): number {
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(STORAGE_KEY_TOTAL_DEDUCTED);
      localStorage.setItem(STORAGE_KEY_DUST_BALANCE, amount.toFixed(2));
    } catch {}
  }
  return amount;
}

function applyNetLiveBalance(rawBalance: number): { dustBalance: number; isReal: boolean } {
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY_RAW_LACE_BALANCE, rawBalance.toFixed(2));
    } catch {}
  }
  const deductions = getCumulativeOrderDeductions();
  const net = Math.max(0, Math.round((rawBalance - deductions) * 100) / 100);
  saveStoredDustBalance(net, true);
  return { dustBalance: net, isReal: true };
}

/**
 * Directly queries the connected Lace DApp connector for real on-chain tDUST balance.
 * Supports Midnight DApp connector v4.x (getDustBalance, getShieldedBalances, getUnshieldedBalances)
 * as well as CIP-30 / Cardano and legacy connector versions.
 */
export async function fetchLaceLiveBalance(api: any = activeLaceApi): Promise<{ dustBalance: number; isReal: boolean } | null> {
  if (!api) return null;

  try {
    // 1. Primary: Midnight DApp Connector v4.x getDustBalance()
    if (typeof api.getDustBalance === "function") {
      try {
        const res = await api.getDustBalance();
        console.log("[Lace] api.getDustBalance() result:", res);
        const raw = typeof res === "object" && res !== null ? (res.balance ?? res.amount ?? res.dust) : res;
        if (raw !== undefined && raw !== null) {
          const num = typeof raw === "bigint" ? Number(raw) / 1_000_000 : (Number(raw) > 100_000 ? Number(raw) / 1_000_000 : Number(raw));
          if (!isNaN(num) && num >= 0) {
            return applyNetLiveBalance(num);
          }
        }
      } catch (e) {
        console.warn("[Lace] getDustBalance() call notice:", e);
      }
    }

    // 2. Midnight getShieldedBalances() (returns Record<TokenType, bigint>)
    if (typeof api.getShieldedBalances === "function") {
      try {
        const balances = await api.getShieldedBalances();
        console.log("[Lace] api.getShieldedBalances() result:", balances);
        if (balances && typeof balances === "object") {
          for (const [_, val] of Object.entries(balances)) {
            if (val !== undefined && val !== null) {
              const rawVal = typeof val === "bigint" ? Number(val) : Number(val);
              const formatted = rawVal > 100_000 ? rawVal / 1_000_000 : rawVal;
              if (!isNaN(formatted) && formatted >= 0) {
                return applyNetLiveBalance(formatted);
              }
            }
          }
        }
      } catch (e) {
        console.warn("[Lace] getShieldedBalances() call notice:", e);
      }
    }

    // 3. Midnight getUnshieldedBalances()
    if (typeof api.getUnshieldedBalances === "function") {
      try {
        const balances = await api.getUnshieldedBalances();
        console.log("[Lace] api.getUnshieldedBalances() result:", balances);
        if (balances && typeof balances === "object") {
          for (const [_, val] of Object.entries(balances)) {
            if (val !== undefined && val !== null) {
              const rawVal = typeof val === "bigint" ? Number(val) : Number(val);
              const formatted = rawVal > 100_000 ? rawVal / 1_000_000 : rawVal;
              if (!isNaN(formatted) && formatted >= 0) {
                return applyNetLiveBalance(formatted);
              }
            }
          }
        }
      } catch (e) {
        console.warn("[Lace] getUnshieldedBalances() call notice:", e);
      }
    }

    // 4. CIP-30 getBalance()
    if (typeof api.getBalance === "function") {
      try {
        const balRes = await api.getBalance();
        console.log("[Lace] api.getBalance() result:", balRes);
        if (balRes !== undefined && balRes !== null) {
          if (typeof balRes === "string" && /^[0-9a-fA-F]+$/.test(balRes)) {
            try {
              const parsedInt = BigInt("0x" + balRes);
              const num = Number(parsedInt) / 1_000_000;
              if (!isNaN(num) && num >= 0) {
                return applyNetLiveBalance(num);
              }
            } catch {}
          } else if (typeof balRes === "number" || typeof balRes === "bigint") {
            const num = typeof balRes === "bigint" ? Number(balRes) / 1_000_000 : balRes;
            if (!isNaN(num) && num >= 0) {
              return applyNetLiveBalance(num);
            }
          }
        }
      } catch (e) {
        console.warn("[Lace] getBalance() call notice:", e);
      }
    }

    // 5. Legacy state()
    if (typeof api.state === "function") {
      try {
        const stRes = api.state();
        const st = typeof stRes?.then === "function" ? await stRes : stRes;
        if (st && st.balances && typeof st.balances === "object") {
          for (const [_, val] of Object.entries(st.balances)) {
            if (val !== undefined && val !== null) {
              const num = typeof val === "bigint" ? Number(val) / 1_000_000 : Number(val);
              if (!isNaN(num) && num >= 0) {
                return applyNetLiveBalance(num);
              }
            }
          }
        }
      } catch (e) {
        console.warn("[Lace] state() call notice:", e);
      }
    }
  } catch (err) {
    console.error("[Lace] Balance query error:", err);
  }

  return null;
}

export function getActiveLaceApi(): any {
  return activeLaceApi;
}

export function getLaceProvider(): any {
  if (typeof window === "undefined") return null;
  const w = window as any;

  // 1. Direct standard Midnight Lace provider
  if (w.midnight?.mnLace) return w.midnight.mnLace;

  // 2. Enumerate window.midnight keys dynamically (UUIDs, custom keys, etc.)
  if (w.midnight && typeof w.midnight === "object") {
    if (typeof w.midnight.enable === "function" || typeof w.midnight.connect === "function") {
      return w.midnight;
    }
    const keys = Object.keys(w.midnight);
    for (const key of keys) {
      const candidate = w.midnight[key];
      if (
        candidate &&
        (typeof candidate.enable === "function" ||
          typeof candidate.connect === "function" ||
          typeof candidate.isEnabled === "function")
      ) {
        return candidate;
      }
    }
  }

  // 3. Fallback namespaces
  if (w.lace?.midnight) return w.lace.midnight;
  if (w.cardano?.lace) return w.cardano.lace;

  return null;
}

export function isLaceAvailable(): boolean {
  return !!getLaceProvider();
}

function getLace() {
  const provider = getLaceProvider();
  if (!provider) {
    throw new Error(
      "Lace Wallet provider not detected. Please ensure the Lace extension (Midnight edition) is installed, unlocked, and site access is permitted for this site."
    );
  }
  return provider;
}

export function isUserDeclined(err: any): boolean {
  if (!err) return false;
  const msg = (err?.message ?? err?.info ?? (typeof err === "string" ? err : "")).toLowerCase();
  const code = err?.code;
  return (
    code === 2 || // CIP-30 UserDeclined
    code === -32000 || // RPC user rejected
    code === 4001 || // EIP-1193 user rejected
    msg.includes("reject") ||
    msg.includes("cancel") ||
    msg.includes("decline") ||
    msg.includes("denied") ||
    msg.includes("refused") ||
    msg.includes("abort") ||
    msg.includes("closed")
  );
}

export async function connectLace(networkId: string = "preview"): Promise<MidnightWalletState> {
  try {
    const lace = getLace();
    
    // Enable/connect according to Midnight DApp connector standard
    let api: any = null;

    if (typeof lace.connect === "function") {
      try {
        api = await lace.connect(networkId);
      } catch (cErr: any) {
        console.warn("[Lace] lace.connect(networkId) notice:", cErr?.message);
        try {
          api = await lace.connect();
        } catch {}
      }
    }

    if (!api && typeof lace.enable === "function") {
      try {
        api = await lace.enable();
      } catch (eErr: any) {
        console.warn("[Lace] lace.enable() notice:", eErr?.message);
      }
    }

    if (!api) {
      return {
        connected: false,
        address: null,
        networkId: null,
        error: "User rejected wallet connection or Lace is locked.",
      };
    }

    activeLaceApi = api;

    let shieldedAddr: string | null = null;
    let unshieldedAddr: string | null = null;
    let primaryAddress: string | null = null;

    // A. Query Shielded Address (preferred for Midnight private transactions)
    if (typeof api.getShieldedAddresses === "function") {
      try {
        const res = await api.getShieldedAddresses();
        if (Array.isArray(res) && res.length > 0) {
          shieldedAddr = typeof res[0] === "string" ? res[0] : res[0]?.shieldedAddress ?? res[0]?.address ?? JSON.stringify(res[0]);
        } else if (typeof res === "string") {
          shieldedAddr = res;
        } else if (typeof res === "object" && res !== null) {
          shieldedAddr = res.shieldedAddress ?? res.shieldedCoinPublicKey ?? null;
        }
      } catch (e) {
        console.warn("[Lace] getShieldedAddresses notice:", e);
      }
    }

    // B. Query Unshielded Address (needed for signing operations)
    if (typeof api.getUnshieldedAddress === "function") {
      try {
        const res = await api.getUnshieldedAddress();
        if (typeof res === "string") unshieldedAddr = res;
        else if (Array.isArray(res) && res.length > 0) unshieldedAddr = typeof res[0] === "string" ? res[0] : res[0]?.address;
      } catch (e) {
        console.warn("[Lace] getUnshieldedAddress notice:", e);
      }
    }
    if (!unshieldedAddr && typeof api.getUnshieldedAddresses === "function") {
      try {
        const res = await api.getUnshieldedAddresses();
        if (typeof res === "string") unshieldedAddr = res;
        else if (Array.isArray(res) && res.length > 0) unshieldedAddr = typeof res[0] === "string" ? res[0] : res[0]?.address;
      } catch (e) {
        console.warn("[Lace] getUnshieldedAddresses notice:", e);
      }
    }

    // C. Query Live Balance directly from Lace Wallet Extension
    const liveBal = await fetchLaceLiveBalance(api);
    const dustBalance = liveBal ? liveBal.dustBalance : getStoredDustBalance();
    const isRealWallet = liveBal?.isReal ?? true;

    // D. CIP-30 / Cardano Fallbacks for addresses
    if (!unshieldedAddr && typeof api.getUsedAddresses === "function") {
      try {
        const used = await api.getUsedAddresses();
        unshieldedAddr = Array.isArray(used) ? used[0] : used;
      } catch {}
    }
    if (!unshieldedAddr && typeof api.getChangeAddress === "function") {
      try {
        unshieldedAddr = await api.getChangeAddress();
      } catch {}
    }
    if (!primaryAddress && !shieldedAddr && !unshieldedAddr) {
      if (typeof api.getAddress === "function") {
        try {
          primaryAddress = await api.getAddress();
        } catch {}
      }
    }

    const finalAddress = shieldedAddr ?? unshieldedAddr ?? primaryAddress ?? "midnight-lace-connected";

    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem("umbra_simulated_wallet_connected");
        localStorage.setItem(STORAGE_KEY_IS_REAL, "true");
      } catch {}
    }

    return {
      connected: true,
      address: finalAddress,
      shieldedAddress: shieldedAddr,
      unshieldedAddress: unshieldedAddr,
      networkId,
      hasDust: true,
      dustBalance,
      isRealWallet,
      api,
      error: null,
    };
  } catch (err: any) {
    return {
      connected: false,
      address: null,
      networkId: null,
      dustBalance: getStoredDustBalance(),
      error: err?.message ?? String(err),
    };
  }
}

export async function signOrderWithLace(
  address: string,
  commitment: string,
  orderMetadata?: { side: number; amount: string; price: string; deductAmount?: number },
  unshieldedAddress?: string | null
): Promise<{ success: boolean; signature?: string; error?: string; txHash?: string; amountDeducted?: number; newBalance?: number }> {
  try {
    let api = activeLaceApi;
    const laceProvider = getLaceProvider();

    // If API is not active or is simulated while real Lace extension is present, connect real Lace
    if (!api || (api?.isSimulated && laceProvider)) {
      if (laceProvider) {
        console.log("[Lace] Initializing real Lace connection for order authorization...");
        const conn = await connectLace("preview");
        if (conn.connected && conn.api) {
          api = conn.api;
          activeLaceApi = api;
        }
      }
    }

    if (!api) {
      throw new Error("Lace wallet is not connected. Please connect Lace first.");
    }

    // Resolve unshielded / signing address
    let signingAddress: string | null = unshieldedAddress || null;
    if (!signingAddress || signingAddress.startsWith("mn_shield")) {
      if (typeof api.getUnshieldedAddress === "function") {
        try {
          const u = await api.getUnshieldedAddress();
          signingAddress = Array.isArray(u) ? u[0] : (typeof u === "string" ? u : u?.address ?? null);
        } catch {}
      }
    }
    if (!signingAddress && typeof api.getUnshieldedAddresses === "function") {
      try {
        const u = await api.getUnshieldedAddresses();
        signingAddress = Array.isArray(u) ? u[0] : (typeof u === "string" ? u : u?.address ?? null);
      } catch {}
    }
    if (!signingAddress && typeof api.getUsedAddresses === "function") {
      try {
        const used = await api.getUsedAddresses();
        signingAddress = Array.isArray(used) ? used[0] : used;
      } catch {}
    }
    if (!signingAddress && typeof api.getChangeAddress === "function") {
      try {
        signingAddress = await api.getChangeAddress();
      } catch {}
    }
    if (!signingAddress && typeof api.getDustAddress === "function") {
      try {
        signingAddress = await api.getDustAddress();
      } catch {}
    }
    if (!signingAddress && address && !address.startsWith("mn_shield")) {
      signingAddress = address;
    }

    console.log("[Lace] Authorizing confidential order:", {
      commitment,
      signingAddress,
      shieldedAddress: address,
      orderMetadata,
    });

    // Check if running purely in demo simulation mode without real Lace extension
    if (api.isSimulated && !laceProvider) {
      console.log("[Lace] Demo mode active without Lace extension. Simulating order confirmation...");
      await new Promise((r) => setTimeout(r, 600));
      const deductAmount = orderMetadata?.deductAmount ?? 0;
      const newBalance = deductAmount > 0 ? recordOrderDeduction(deductAmount) : getStoredDustBalance();
      return {
        success: true,
        signature: `lace-sim-sig-${commitment.slice(0, 16)}`,
        txHash: `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`,
        amountDeducted: deductAmount,
        newBalance,
      };
    }

    const orderSideStr = orderMetadata?.side === 0 ? "BUY" : "SELL";
    const orderAmt = orderMetadata?.amount || "0";
    const orderPrice = orderMetadata?.price || "0";
    const humanReadableMessage = `[Umbera Dark Pool]\nAuthorize Confidential Order Commitment:\nCommitment: ${commitment}\nSide: ${orderSideStr}\nAmount: ${orderAmt}\nLimit Price: ${orderPrice}\nTimestamp: ${Date.now()}`;
    const textPayloadHex = Buffer.from(humanReadableMessage, "utf8").toString("hex");
    const cleanCommitment = commitment.startsWith("0x") ? commitment.slice(2) : commitment;

    let signature: string | undefined;
    let txHash: string | undefined;

    // STEP 1: If Lace supports signData, this is the primary mechanism that opens the native confirmation popup
    if (typeof api.signData === "function") {
      // 1A. Try Midnight DApp Connector v4 format: api.signData(data, { encoding: "text" })
      try {
        console.log("[Lace] Prompting user confirmation via signData(text)...");
        const res = await api.signData(humanReadableMessage, { encoding: "text" });
        if (res) {
          signature = typeof res === "string" ? res : (res.signature ?? JSON.stringify(res));
          console.log("[Lace] User confirmed via signData text:", signature);
        }
      } catch (errText: any) {
        if (isUserDeclined(errText)) {
          return { success: false, error: "Order authorization was declined in Lace wallet." };
        }
        console.warn("[Lace] signData text format notice:", errText?.message);
        
        // 1B. Try Midnight v4 hex encoding: api.signData(cleanCommitment, { encoding: "hex" })
        try {
          console.log("[Lace] Prompting user confirmation via signData(hex)...");
          const resHex = await api.signData(cleanCommitment, { encoding: "hex" });
          if (resHex) {
            signature = typeof resHex === "string" ? resHex : (resHex.signature ?? JSON.stringify(resHex));
            console.log("[Lace] User confirmed via signData hex:", signature);
          }
        } catch (errHex: any) {
          if (isUserDeclined(errHex)) {
            return { success: false, error: "Order authorization was declined in Lace wallet." };
          }
          console.warn("[Lace] signData hex format notice:", errHex?.message);
        }
      }

      // 1C. If not signed yet, try CIP-30 format: api.signData(targetAddr, hexPayload)
      if (!signature) {
        const targetSigningAddr = signingAddress || (address && !address.startsWith("mn_shield") ? address : null);
        if (targetSigningAddr) {
          try {
            console.log("[Lace] Prompting user confirmation via CIP-30 signData(address, textPayloadHex)...", { targetSigningAddr });
            const resCip = await api.signData(targetSigningAddr, textPayloadHex);
            if (resCip) {
              signature = typeof resCip === "string" ? resCip : (resCip.signature ?? JSON.stringify(resCip));
              console.log("[Lace] User confirmed via CIP-30 signData:", signature);
            }
          } catch (cipErr: any) {
            if (isUserDeclined(cipErr)) {
              return { success: false, error: "Order authorization was declined in Lace wallet." };
            }
            console.warn("[Lace] CIP-30 signData text notice:", cipErr?.message);
            try {
              console.log("[Lace] Prompting user confirmation via CIP-30 signData(address, cleanCommitment)...");
              const resCipRaw = await api.signData(targetSigningAddr, cleanCommitment);
              if (resCipRaw) {
                signature = typeof resCipRaw === "string" ? resCipRaw : (resCipRaw.signature ?? JSON.stringify(resCipRaw));
                console.log("[Lace] User confirmed via CIP-30 raw signData:", signature);
              }
            } catch (cipRawErr: any) {
              if (isUserDeclined(cipRawErr)) {
                return { success: false, error: "Order authorization was declined in Lace wallet." };
              }
              console.warn("[Lace] CIP-30 signData raw notice:", cipRawErr?.message);
            }
          }
        }
      }
    }

    // STEP 2: Try Lace signTx if signData was not supported
    if (!signature && typeof api.signTx === "function") {
      try {
        console.log("[Lace] Prompting user confirmation via signTx...");
        const resTx = await api.signTx(cleanCommitment, true);
        if (resTx) {
          signature = typeof resTx === "string" ? resTx : JSON.stringify(resTx);
        }
      } catch (txErr: any) {
        if (isUserDeclined(txErr)) {
          return { success: false, error: "Order authorization was declined in Lace wallet." };
        }
        console.warn("[Lace] signTx notice:", txErr?.message);
      }
    }

    // STEP 3: Try Lace transferTransaction if available
    if (!signature && typeof api.transferTransaction === "function") {
      try {
        console.log("[Lace] Prompting user confirmation via transferTransaction...");
        const amtUnits = BigInt(Math.floor(parseFloat(orderMetadata?.amount || "10") * 1_000_000));
        const resTransfer = await api.transferTransaction([
          {
            amount: amtUnits,
            type: "tDUST",
            receiverAddress: signingAddress || address,
          },
        ]);
        signature = typeof resTransfer === "string" ? resTransfer : "lace-transfer-approved";
      } catch (tErr: any) {
        if (isUserDeclined(tErr)) {
          return { success: false, error: "Order authorization was declined in Lace wallet." };
        }
        console.warn("[Lace] transferTransaction notice:", tErr?.message);
      }
    }

    // STEP 4: If Lace has submitTx / submitTransaction
    if (typeof api.submitTx === "function" || typeof api.submitTransaction === "function") {
      try {
        const fn = api.submitTx ?? api.submitTransaction;
        const res = await fn({ commitment });
        const resId = typeof res === "string" ? res : res?.transactionId ?? null;
        if (resId) txHash = resId;
      } catch (err: any) {
        console.warn("[Lace] submitTx notice:", err?.message);
      }
    }

    // STEP 5: Validate that signature was obtained
    if (!signature) {
      if (laceProvider && !api.isSimulated) {
        return {
          success: false,
          error: "Lace wallet did not approve the confidential order. Please ensure Lace is unlocked and permissions are granted.",
        };
      }
      signature = `lace-auth-${cleanCommitment.slice(0, 16)}`;
    }

    // STEP 6: Record Persistent Deduction and Return Result
    const deductAmount = orderMetadata?.deductAmount ?? 0;
    let newBalance = getStoredDustBalance();
    if (deductAmount > 0) {
      newBalance = recordOrderDeduction(deductAmount);
    }

    return {
      success: true,
      signature,
      txHash,
      amountDeducted: deductAmount,
      newBalance,
    };
  } catch (err: any) {
    console.error("[Lace] User signature / approval notice:", err);
    if (isUserDeclined(err)) {
      return {
        success: false,
        error: "Order authorization was declined in Lace wallet.",
      };
    }
    return {
      success: false,
      error: err?.message ?? "Failed to authorize order with Lace wallet.",
    };
  }
}

export async function isLaceEnabled(): Promise<boolean> {
  try {
    const lace = getLaceProvider();
    if (!lace) return false;
    if (typeof lace.isEnabled === "function") return await lace.isEnabled();
    return true;
  } catch {
    return false;
  }
}

export function connectSimulatedLace(networkId: string = "preview"): MidnightWalletState {
  let savedAddr: string | null = null;
  if (typeof window !== "undefined") {
    try {
      savedAddr = localStorage.getItem("umbra_simulated_shielded_addr");
    } catch {}
  }
  const dummyShielded =
    savedAddr ||
    ("mn_shielded_testnet02_" +
      Math.random().toString(16).slice(2, 10) +
      Math.random().toString(16).slice(2, 10));
  const dummyUnshielded = "mn_unshielded_testnet02_" + dummyShielded.slice(-8);
  const balance = getStoredDustBalance();

  activeLaceApi = {
    isSimulated: true,
    getShieldedAddresses: async () => [dummyShielded],
    getUnshieldedAddress: async () => dummyUnshielded,
    state: async () => ({
      address: dummyShielded,
      shieldedAddress: dummyShielded,
      unshieldedAddress: dummyUnshielded,
      balances: { tDUST: balance },
    }),
    signData: async (_addr: string, payload: string) => `lace-sig-${payload.slice(0, 16)}`,
  };

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem("umbra_simulated_wallet_connected", "true");
      localStorage.setItem("umbra_simulated_shielded_addr", dummyShielded);
    } catch {}
  }

  return {
    connected: true,
    address: dummyShielded,
    shieldedAddress: dummyShielded,
    unshieldedAddress: dummyUnshielded,
    networkId,
    hasDust: true,
    dustBalance: balance,
    api: activeLaceApi,
    error: null,
  };
}

export function disconnectLace(): MidnightWalletState {
  activeLaceApi = null;
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem("umbra_simulated_wallet_connected");
    } catch {}
  }
  return {
    connected: false,
    address: null,
    networkId: null,
    shieldedAddress: null,
    unshieldedAddress: null,
    hasDust: false,
    api: null,
    error: null,
  };
}
