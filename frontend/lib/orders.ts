import { type PublicClient } from "viem";
import { dexAbi, deployment } from "@/lib/dex";

export type ChainOrder = {
  orderId: bigint;
  pairId: bigint;
  batchId: bigint;
  trader: `0x${string}`;
  side: "PRIVATE";
  status: number; // 0 ACTIVE, 1 MATCHED, 2 SETTLED, 3 CANCELLED
  createdAt: bigint;
  expiry: bigint;
  txHash: `0x${string}`;
};

export const STATUS_LABEL = ["ACTIVE", "MATCHED", "SETTLED", "CANCELLED"] as const;
export const SIDE_LABEL = { PRIVATE: "PRIVATE" } as const;

const DEPLOY_BLOCK = 269000000n; // approximate; queries go forward from here

export async function fetchTraderOrders(client: PublicClient, trader: `0x${string}`): Promise<ChainOrder[]> {
  const dep = deployment();
  const dexAddr = dep.dex as `0x${string}`;
  const submittedEvent = (dexAbi as any[]).find((e) => e.type === "event" && e.name === "OrderSubmitted");
  if (!submittedEvent) throw new Error("OrderSubmitted abi missing");

  // viem getLogs with indexed `trader` arg requires matching the position.
  // OrderSubmitted has indexed: orderId, pairId, batchId; trader is non-indexed,
  // so we filter by trader after fetching logs.
  const logs = await client.getLogs({
    address: dexAddr,
    event: submittedEvent,
    fromBlock: DEPLOY_BLOCK,
    toBlock: "latest",
  });

  const typedLogs = logs as any[];
  const mine = typedLogs.filter((l: any) => l.args?.trader?.toLowerCase() === trader.toLowerCase());
  const out: ChainOrder[] = [];
  for (const l of mine) {
    const orderId = l.args!.orderId as bigint;
    const info = await client.readContract({
      address: dexAddr, abi: dexAbi, functionName: "getOrderInfo", args: [orderId],
    }) as any[];
    out.push({
      orderId,
      pairId: info[1] as bigint,
      batchId: info[2] as bigint,
      trader: info[0] as `0x${string}`,
      side: "PRIVATE",
      status: Number(info[5]),
      createdAt: info[3] as bigint,
      expiry: info[4] as bigint,
      txHash: l.transactionHash!,
    });
  }
  out.sort((a, b) => (a.orderId < b.orderId ? 1 : -1));
  return out;
}
