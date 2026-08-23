"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { connectLace, disconnectLace, isLaceAvailable, isLaceEnabled, type MidnightWalletState } from "./wallet";
import { createMidnightProviders, getDefaultConfig, type MidnightClientConfig } from "./client";
import { PRIVACY_CLASSIFICATION, createPrivateOrder, type PrivateOrderInput, type OrderPrivacyState } from "./privacy";

type MidnightContextType = {
  wallet: MidnightWalletState;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  isLaceAvailable: boolean;
  providersReady: boolean;
  config: MidnightClientConfig;
  privacyClassification: typeof PRIVACY_CLASSIFICATION;
  createOrderState: (input: PrivateOrderInput) => OrderPrivacyState;
  proofStatus: "idle" | "generating" | "verified" | "error";
  txStatus: "idle" | "submitting" | "confirmed" | "error";
  setProofStatus: (status: "idle" | "generating" | "verified" | "error") => void;
  setTxStatus: (status: "idle" | "submitting" | "confirmed" | "error") => void;
};

const MidnightContext = createContext<MidnightContextType>({
  wallet: { connected: false, address: null, networkId: null, error: null },
  connectWallet: async () => {},
  disconnectWallet: () => {},
  isLaceAvailable: false,
  providersReady: false,
  config: getDefaultConfig(),
  privacyClassification: PRIVACY_CLASSIFICATION,
  createOrderState: () => { throw new Error("Provider not initialized"); },
  proofStatus: "idle",
  txStatus: "idle",
  setProofStatus: () => {},
  setTxStatus: () => {},
});

export function MidnightProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<MidnightWalletState>({
    connected: false,
    address: null,
    networkId: null,
    error: null,
  });
  const [providersReady, setProvidersReady] = useState(false);
  const [proofStatus, setProofStatus] = useState<"idle" | "generating" | "verified" | "error">("idle");
  const [txStatus, setTxStatus] = useState<"idle" | "submitting" | "confirmed" | "error">("idle");
  const config = getDefaultConfig();

  useEffect(() => {
    let unmounted = false;
    async function init() {
      if (isLaceAvailable()) {
        const enabled = await isLaceEnabled();
        if (enabled && !unmounted) {
          const res = await connectLace(config.networkId);
          if (!unmounted) setWallet(res);
        }
      }
      const p = await createMidnightProviders(config);
      if (!unmounted) setProvidersReady(p.ready);
    }
    init();
    return () => { unmounted = true; };
  }, [config.networkId]);

  const handleConnectWallet = useCallback(async () => {
    setWallet((prev) => ({ ...prev, error: null }));
    const res = await connectLace(config.networkId);
    setWallet(res);
  }, [config.networkId]);

  const handleDisconnectWallet = useCallback(() => {
    const res = disconnectLace();
    setWallet(res);
  }, []);

  const createOrderState = useCallback((input: PrivateOrderInput) => {
    return createPrivateOrder(input);
  }, []);

  return (
    <MidnightContext.Provider
      value={{
        wallet,
        connectWallet: handleConnectWallet,
        disconnectWallet: handleDisconnectWallet,
        isLaceAvailable: isLaceAvailable(),
        providersReady,
        config,
        privacyClassification: PRIVACY_CLASSIFICATION,
        createOrderState,
        proofStatus,
        txStatus,
        setProofStatus,
        setTxStatus,
      }}
    >
      {children}
    </MidnightContext.Provider>
  );
}

export function useMidnight() {
  return useContext(MidnightContext);
}
