/**
 * Midnight Dark Pool — Batch Lifecycle Management
 *
 * Coordinates 5-minute discrete sealed batch auction windows,
 * tracking commitments, clearing stages, and batch transitions.
 *
 * @module midnight/batch
 */

export type BatchOrderStatus = "SEALED" | "PROVED" | "MATCHED" | "SETTLED";

export interface BatchOrder {
  id: string;
  batchId: string;
  commitment: string;
  side: "BUY" | "SELL";
  amount: number;
  price: number;
  timestamp: number;
  isUserOrder: boolean;
  status: BatchOrderStatus;
}

const STORAGE_BATCH_ID = "umbra_current_batch_id";
const STORAGE_BATCH_START = "umbra_batch_start_timestamp";
const STORAGE_BATCH_ORDERS_PREFIX = "umbra_batch_orders_v2_";
export const BATCH_DURATION_SECONDS = 300; // 5 minutes sealed window

// Initial seeded dummy orders for demo/testing so order count starts at 2
const SEED_ORDERS_BATCH_1: BatchOrder[] = [
  {
    id: "seed-order-1",
    batchId: "1",
    commitment: "0x8f2a9c1e45bd2830f14d88e02511ca7b827e49d21e0854cb016629df48d009e1",
    side: "BUY",
    amount: 150,
    price: 1.02,
    timestamp: Date.now() - 120_000,
    isUserOrder: false,
    status: "SEALED",
  },
  {
    id: "seed-order-2",
    batchId: "1",
    commitment: "0x3e1790bd551fa088cb1032890ae47c8d99804e331b26c04f9810ac95eb8812fa",
    side: "SELL",
    amount: 150,
    price: 0.98,
    timestamp: Date.now() - 60_000,
    isUserOrder: false,
    status: "SEALED",
  },
];

export function getStoredBatchId(): bigint {
  if (typeof window === "undefined") return 1n;
  try {
    const raw = localStorage.getItem(STORAGE_BATCH_ID);
    if (!raw) {
      localStorage.setItem(STORAGE_BATCH_ID, "1");
      return 1n;
    }
    const val = BigInt(raw);
    return val > 0n ? val : 1n;
  } catch {
    return 1n;
  }
}

export function setStoredBatchId(id: bigint): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_BATCH_ID, id.toString());
  } catch {}
}

export function getStoredBatchStartTime(): number {
  if (typeof window === "undefined") return Math.floor(Date.now() / 1000);
  try {
    const raw = localStorage.getItem(STORAGE_BATCH_START);
    if (!raw) {
      const now = Math.floor(Date.now() / 1000);
      localStorage.setItem(STORAGE_BATCH_START, now.toString());
      return now;
    }
    const val = parseInt(raw, 10);
    return isNaN(val) ? Math.floor(Date.now() / 1000) : val;
  } catch {
    return Math.floor(Date.now() / 1000);
  }
}

export function setStoredBatchStartTime(time: number): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_BATCH_START, time.toString());
  } catch {}
}

export function getStoredBatchOrders(batchId: bigint): BatchOrder[] {
  if (typeof window === "undefined") return batchId === 1n ? SEED_ORDERS_BATCH_1 : [];
  try {
    const key = `${STORAGE_BATCH_ORDERS_PREFIX}${batchId.toString()}`;
    const raw = localStorage.getItem(key);
    if (!raw) {
      if (batchId === 1n) {
        localStorage.setItem(key, JSON.stringify(SEED_ORDERS_BATCH_1));
        return SEED_ORDERS_BATCH_1;
      }
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return batchId === 1n ? SEED_ORDERS_BATCH_1 : [];
  }
}

export function addStoredBatchOrder(batchId: bigint, order: BatchOrder): BatchOrder[] {
  if (typeof window === "undefined") return [order];
  try {
    const key = `${STORAGE_BATCH_ORDERS_PREFIX}${batchId.toString()}`;
    const current = getStoredBatchOrders(batchId);
    const next = [...current, order];
    localStorage.setItem(key, JSON.stringify(next));
    return next;
  } catch {
    return [order];
  }
}
