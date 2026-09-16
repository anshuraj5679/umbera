"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import {
  connectLace,
  disconnectLace,
  isLaceAvailable,
  isLaceEnabled,
  signOrderWithLace,
  getStoredDustBalance,
  refillStoredDustBalance,
  deductStoredDustBalance,
  type MidnightWalletState,
} from "./wallet";
import { createMidnightProviders, getDefaultConfig, type MidnightClientConfig } from "./client";
import { PRIVACY_CLASSIFICATION, createPrivateOrder, type PrivateOrderInput, type OrderPrivacyState } from "./privacy";

type MidnightContextType = {
  wallet: MidnightWalletState;
  dustBalance: number;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  isLaceAvailable: boolean;
  providersReady: boolean;
  config: MidnightClientConfig;
  privacyClassification: typeof PRIVACY_CLASSIFICATION;
  createOrderState: (input: PrivateOrderInput) => OrderPrivacyState;
  signOrderCommitment: (
    commitment: string,
    metadata?: { side: number; amount: string; price: string; deductAmount?: number }
  ) => Promise<{ success: boolean; signature?: string; error?: string; txHash?: string; amountDeducted?: number; newBalance?: number }>;
  proofStatus: "idle" | "generating" | "verified" | "error";
  txStatus: "idle" | "submitting" | "confirmed" | "error";
  setProofStatus: (status: "idle" | "generating" | "verified" | "error") => void;
  setTxStatus: (status: "idle" | "submitting" | "confirmed" | "error") => void;
  updateDustBalance: (newBalance: number) => void;
  refillDustBalance: (amount?: number) => void;
};

const MidnightContext = createContext<MidnightContextType>({
  wallet: { connected: false, address: null, networkId: null, error: null, dustBalance: 25000.0 },
  dustBalance: 25000.0,
  connectWallet: async () => {},
  disconnectWallet: () => {},
  isLaceAvailable: false,
  providersReady: false,
  config: getDefaultConfig(),
  privacyClassification: PRIVACY_CLASSIFICATION,
  createOrderState: () => { throw new Error("Provider not initialized"); },
  signOrderCommitment: async () => ({ success: false, error: "Provider not initialized" }),
  proofStatus: "idle",
  txStatus: "idle",
  setProofStatus: () => {},
  setTxStatus: () => {},
  updateDustBalance: () => {},
  refillDustBalance: () => {},
});

export function MidnightProvider({ children }: { children: ReactNode }) {
  const [dustBalance, setDustBalance] = useState<number>(25000.0);
  const [wallet, setWallet] = useState<MidnightWalletState>({
    connected: false,
    address: null,
    networkId: null,
    dustBalance: 25000.0,
    error: null,
  });
  const [providersReady, setProvidersReady] = useState(false);
  const [laceAvailable, setLaceAvailable] = useState(false);
  const [proofStatus, setProofStatus] = useState<"idle" | "generating" | "verified" | "error">("idle");
  const [txStatus, setTxStatus] = useState<"idle" | "submitting" | "confirmed" | "error">("idle");
  const config = getDefaultConfig();

  useEffect(() => {
    let unmounted = false;
    // Sync initial stored balance
    const initialBal = getStoredDustBalance();
    setDustBalance(initialBal);
    
    // Check Lace availability with retries for late injection
    const checkAvailability = () => {
      const avail = isLaceAvailable();
      if (avail && !unmounted) {
        setLaceAvailable(true);
      }
      return avail;
    };

    if (!checkAvailability()) {
      const interval = setInterval(() => {
        if (checkAvailability() || unmounted) {
          clearInterval(interval);
        }
      }, 500);
      setTimeout(() => clearInterval(interval), 6000);
    }

    async function init() {
      if (isLaceAvailable()) {
        setLaceAvailable(true);
        const enabled = await isLaceEnabled();
        if (enabled && !unmounted) {
          const res = await connectLace(config.networkId);
          if (!unmounted) {
            setWallet(res);
            if (res.dustBalance !== undefined) {
              setDustBalance(res.dustBalance);
            }
          }
        }
      }
      const p = await createMidnightProviders(config);
      if (!unmounted) setProvidersReady(p.ready);
    }
    init();
    return () => {
      unmounted = true;
    };
  }, [config.networkId]);

  const handleConnectWallet = useCallback(async () => {
    setWallet((prev) => ({ ...prev, error: null }));
    const res = await connectLace(config.networkId);
    setWallet(res);
    if (res.dustBalance !== undefined) {
      setDustBalance(res.dustBalance);
    }
  }, [config.networkId]);

  const handleDisconnectWallet = useCallback(() => {
    const res = disconnectLace();
    setWallet(res);
  }, []);

  const handleUpdateDustBalance = useCallback((newBal: number) => {
    setDustBalance(newBal);
    setWallet((prev) => ({ ...prev, dustBalance: newBal }));
  }, []);

  const handleRefillDustBalance = useCallback((amount: number = 25000.0) => {
    const next = refillStoredDustBalance(amount);
    setDustBalance(next);
    setWallet((prev) => ({ ...prev, dustBalance: next }));
  }, []);

  const createOrderState = useCallback((input: PrivateOrderInput) => {
    return createPrivateOrder(input);
  }, []);

  const handleSignOrder = useCallback(
    async (
      commitment: string,
      metadata?: { side: number; amount: string; price: string; deductAmount?: number }
    ) => {
      if (!wallet.address) {
        return { success: false, error: "Lace wallet is not connected" };
      }
      const res = await signOrderWithLace(wallet.address, commitment, metadata);
      if (res.newBalance !== undefined) {
        setDustBalance(res.newBalance);
        setWallet((prev) => ({ ...prev, dustBalance: res.newBalance }));
      }
      return res;
    },
    [wallet.address]
  );

  return (
    <MidnightContext.Provider
      value={{
        wallet,
        dustBalance,
        connectWallet: handleConnectWallet,
        disconnectWallet: handleDisconnectWallet,
        isLaceAvailable: laceAvailable || isLaceAvailable(),
        providersReady,
        config,
        privacyClassification: PRIVACY_CLASSIFICATION,
        createOrderState,
        signOrderCommitment: handleSignOrder,
        proofStatus,
        txStatus,
        setProofStatus,
        setTxStatus,
        updateDustBalance: handleUpdateDustBalance,
        refillDustBalance: handleRefillDustBalance,
      }}
    >
      {children}
    </MidnightContext.Provider>
  );
}

export function useMidnight() {
  return useContext(MidnightContext);
}
