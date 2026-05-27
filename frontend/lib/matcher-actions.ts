import { type PublicClient } from "viem";
import { dexAbi, deployment } from "@/lib/dex";

export type BatchOrder = {
  orderId: bigint;
  trader: `0x${string}`;
  pairId: number;
  status: number;
  baseDepositHandle: bigint;
  quoteDepositHandle: bigint;
  baseRequestHandle: bigint;
  quoteRequestHandle: bigint;
};

const DEPLOY_BLOCK = 269_080_000n;

export async function fetchClosedBatchesAwaitingMatching(client: PublicClient): Promise<bigint[]> {
  const dep = deployment();
  const dexAddr = dep.dex as `0x${string}`;
  const cur = await client.readContract({ abi: dexAbi, address: dexAddr, functionName: "getCurrentBatch" }) as any[];
  const currentId = cur[0] as bigint;
  // Closed batches: 0 .. currentId-1 (since current is always open after rotation; closeBatch increments)
  const closed: bigint[] = [];
  for (let i = 0n; i < currentId; i++) closed.push(i);
  return closed;
}

export async function fetchOrdersInBatch(client: PublicClient, batchId: bigint): Promise<BatchOrder[]> {
  const dep = deployment();
  const dexAddr = dep.dex as `0x${string}`;
  const submittedEvent = (dexAbi as any[]).find((e) => e.type === "event" && e.name === "OrderSubmitted");
  if (!submittedEvent) throw new Error("OrderSubmitted abi missing");

  const logs = await client.getLogs({
    address: dexAddr,
    event: submittedEvent,
    args: { batchId },
    fromBlock: DEPLOY_BLOCK,
    toBlock: "latest",
  });

  const out: BatchOrder[] = [];
  for (const l of logs as any[]) {
    const orderId = l.args.orderId as bigint;
    const [info, legs] = await Promise.all([
      client.readContract({ address: dexAddr, abi: dexAbi, functionName: "getOrderInfo", args: [orderId] }) as Promise<any[]>,
      client.readContract({ address: dexAddr, abi: dexAbi, functionName: "getOrderLegs", args: [orderId] }) as Promise<any[]>,
    ]);
    out.push({
      orderId,
      trader: info[0] as `0x${string}`,
      pairId: Number(info[1]),
      status: Number(info[5]),
      baseDepositHandle: legs[0] as bigint,
      quoteDepositHandle: legs[1] as bigint,
      baseRequestHandle: legs[2] as bigint,
      quoteRequestHandle: legs[3] as bigint,
    });
  }
  return out;
}
