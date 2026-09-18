"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import {
  connectLace,
  connectSimulatedLace,
  disconnectLace,
  isLaceAvailable,
  isLaceEnabled,
  signOrderWithLace,
  getStoredDustBalance,
  refillStoredDustBalance,
  deductStoredDustBalance,
  fetchLaceLiveBalance,
  type MidnightWalletState,
} from "./wallet";
import { createMidnightProviders, getDefaultConfig, type MidnightClientConfig } from "./client";
import { PRIVACY_CLASSIFICATION, createPrivateOrder, type PrivateOrderInput, type OrderPrivacyState } from "./privacy";
import {
  getStoredBatchId,
  setStoredBatchId,
  getStoredBatchStartTime,
  setStoredBatchStartTime,
  getStoredBatchOrders,
  addStoredBatchOrder,
  BATCH_DURATION_SECONDS,
  type BatchOrder,
} from "./batch";
import { LaceConnectModal } from "../components/LaceConnectModal";
import { toast } from "sonner";

type MidnightContextType = {
  wallet: MidnightWalletState;
  dustBalance: number;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  connectSimulatedWallet: () => void;
  isConnectModalOpen: boolean;
  openConnectModal: () => void;
  closeConnectModal: () => void;
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
  refreshLaceBalance: () => Promise<void>;

  // Batch Auction Lifecycle
  batchId: bigint;
  batchOpen: boolean;
  remainingSeconds: number;
  orderCount: bigint;
  ordersInBatch: BatchOrder[];
  closeBatch: () => Promise<void>;
  addBatchOrder: (order: { commitment: string; side: number; amount: string; price: string }) => void;
};

const MidnightContext = createContext<MidnightContextType>({
  wallet: { connected: false, address: null, networkId: null, error: null, dustBalance: 25000.0 },
  dustBalance: 25000.0,
  connectWallet: async () => {},
  disconnectWallet: () => {},
  connectSimulatedWallet: () => {},
  isConnectModalOpen: false,
  openConnectModal: () => {},
  closeConnectModal: () => {},
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
  refreshLaceBalance: async () => {},

  batchId: 1n,
  batchOpen: true,
  remainingSeconds: 300,
  orderCount: 2n,
  ordersInBatch: [],
  closeBatch: async () => {},
  addBatchOrder: () => {},
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
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [proofStatus, setProofStatus] = useState<"idle" | "generating" | "verified" | "error">("idle");
  const [txStatus, setTxStatus] = useState<"idle" | "submitting" | "confirmed" | "error">("idle");
  const config = getDefaultConfig();

  // Batch auction state
  const [batchId, setBatchId] = useState<bigint>(1n);
  const [batchStartTime, setBatchStartTime] = useState<number>(0);
  const [now, setNow] = useState<number>(0);
  const [ordersInBatch, setOrdersInBatch] = useState<BatchOrder[]>([]);

  useEffect(() => {
    let unmounted = false;

    // 1. Sync initial stored balance
    const initialBal = getStoredDustBalance();
    setDustBalance(initialBal);

    // 2. Sync batch state from storage
    const storedId = getStoredBatchId();
    const storedStart = getStoredBatchStartTime();
    const initialOrders = getStoredBatchOrders(storedId);
    setBatchId(storedId);
    setBatchStartTime(storedStart);
    setOrdersInBatch(initialOrders);

    const curNow = Math.floor(Date.now() / 1000);
    setNow(curNow);

    const timer = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 1000);
    
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
      // Check if simulated demo wallet was previously active
      if (typeof window !== "undefined" && localStorage.getItem("umbra_simulated_wallet_connected") === "true") {
        const sim = connectSimulatedLace(config.networkId);
        if (!unmounted) {
          setWallet(sim);
          setDustBalance(sim.dustBalance ?? 25000.0);
        }
      } else if (isLaceAvailable()) {
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
      clearInterval(timer);
    };
  }, [config.networkId]);

  // Periodic polling for Lace Wallet live balance if real wallet connected
  useEffect(() => {
    if (!wallet.connected || !wallet.api || wallet.api?.isSimulated) return;

    let cancel = false;
    const pollBalance = async () => {
      try {
        const res = await fetchLaceLiveBalance(wallet.api);
        if (!cancel && res && res.dustBalance !== undefined) {
          setDustBalance(res.dustBalance);
          setWallet((prev) => ({ ...prev, dustBalance: res.dustBalance, isRealWallet: true }));
        }
      } catch (err) {
        console.warn("[Lace Poll] notice:", err);
      }
    };

    const interval = setInterval(pollBalance, 6000);
    return () => {
      cancel = true;
      clearInterval(interval);
    };
  }, [wallet.connected, wallet.api]);

  const handleRefreshLaceBalance = useCallback(async () => {
    if (!wallet.api) return;
    try {
      const res = await fetchLaceLiveBalance(wallet.api);
      if (res && res.dustBalance !== undefined) {
        setDustBalance(res.dustBalance);
        setWallet((prev) => ({ ...prev, dustBalance: res.dustBalance, isRealWallet: true }));
        toast.success("Lace Wallet Balance Synced", {
          description: `Current live balance: ${res.dustBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tDUST`,
        });
      }
    } catch (err: any) {
      toast.error("Failed to sync Lace balance", { description: err?.message });
    }
  }, [wallet.api]);

  // Batch timing computation
  const elapsed = now > 0 && batchStartTime > 0 ? Math.max(0, now - batchStartTime) : 0;
  const remainingSeconds = Math.max(0, BATCH_DURATION_SECONDS - elapsed);
  const batchOpen = remainingSeconds > 0;

  const handleCloseBatch = useCallback(async () => {
    const nextId = batchId + 1n;
    const newStart = Math.floor(Date.now() / 1000);
    setBatchId(nextId);
    setStoredBatchId(nextId);
    setBatchStartTime(newStart);
    setStoredBatchStartTime(newStart);
    const newOrders = getStoredBatchOrders(nextId);
    setOrdersInBatch(newOrders);
    toast.success(`Batch #${batchId.toString()} Sealed`, {
      description: `Advancing to Batch #${nextId.toString()}. New 5-minute sealed window opened.`,
    });
  }, [batchId]);

  const handleAddBatchOrder = useCallback((orderData: { commitment: string; side: number; amount: string; price: string }) => {
    const order: BatchOrder = {
      id: "ord-" + Date.now() + "-" + Math.random().toString(16).slice(2, 6),
      batchId: batchId.toString(),
      commitment: orderData.commitment,
      side: orderData.side === 0 ? "BUY" : "SELL",
      amount: parseFloat(orderData.amount || "0"),
      price: parseFloat(orderData.price || "0"),
      timestamp: Date.now(),
      isUserOrder: true,
      status: "SEALED",
    };
    const updated = addStoredBatchOrder(batchId, order);
    setOrdersInBatch(updated);
  }, [batchId]);

  const handleConnectWallet = useCallback(async () => {
    setWallet((prev) => ({ ...prev, error: null }));
    const available = isLaceAvailable();
    if (!available) {
      setIsConnectModalOpen(true);
      return;
    }
    const res = await connectLace(config.networkId);
    setWallet(res);
    if (res.connected) {
      if (res.dustBalance !== undefined) {
        setDustBalance(res.dustBalance);
      }
      setIsConnectModalOpen(false);
    } else {
      setIsConnectModalOpen(true);
    }
  }, [config.networkId]);

  const handleConnectSimulatedWallet = useCallback(() => {
    const sim = connectSimulatedLace(config.networkId);
    setWallet(sim);
    if (sim.dustBalance !== undefined) {
      setDustBalance(sim.dustBalance);
    }
    setIsConnectModalOpen(false);
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
        connectSimulatedWallet: handleConnectSimulatedWallet,
        isConnectModalOpen,
        openConnectModal: () => setIsConnectModalOpen(true),
        closeConnectModal: () => setIsConnectModalOpen(false),
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
        refreshLaceBalance: handleRefreshLaceBalance,

        batchId,
        batchOpen,
        remainingSeconds,
        orderCount: BigInt(ordersInBatch.length),
        ordersInBatch,
        closeBatch: handleCloseBatch,
        addBatchOrder: handleAddBatchOrder,
      }}
    >
      {children}
      <LaceConnectModal />
    </MidnightContext.Provider>
  );
}

export function useMidnight() {
  return useContext(MidnightContext);
}
