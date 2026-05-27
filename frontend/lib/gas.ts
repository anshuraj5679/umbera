import type { PublicClient, TransactionReceipt } from "viem";

const MIN_PRIORITY_FEE = 100_000n;

export async function txOptions(publicClient: PublicClient | undefined, gas: bigint) {
  const fees = await paddedFees(publicClient);
  return { ...fees, gas };
}

export async function waitForTransactionSuccess(
  publicClient: PublicClient | undefined,
  hash: `0x${string}`,
): Promise<TransactionReceipt> {
  if (!publicClient) throw new Error("Network client not ready");
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Transaction reverted");
  return receipt;
}

export function receiptHasLogFrom(receipt: TransactionReceipt, address: `0x${string}`) {
  return receipt.logs.some((log) => log.address.toLowerCase() === address.toLowerCase());
}

export async function paddedFees(publicClient: PublicClient | undefined) {
  if (!publicClient) return {};
  try {
    const [block, estimate] = await Promise.all([
      publicClient.getBlock({ blockTag: "latest" }),
      publicClient.estimateFeesPerGas().catch(() => null),
    ]);
    const baseFee = block.baseFeePerGas ?? 0n;
    const estimatedMax = estimate?.maxFeePerGas ?? 0n;
    const priority = maxBigint(estimate?.maxPriorityFeePerGas ?? 0n, MIN_PRIORITY_FEE);
    const maxFeePerGas = maxBigint(baseFee + baseFee / 2n + priority, estimatedMax + estimatedMax / 2n);
    return { maxFeePerGas, maxPriorityFeePerGas: priority };
  } catch {
    return {};
  }
}

function maxBigint(...values: bigint[]) {
  return values.reduce((max, value) => (value > max ? value : max), 0n);
}
