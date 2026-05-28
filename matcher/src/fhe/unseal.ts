import { getCofheRuntime } from "./permit.js";

const MAX_UNSEAL_ATTEMPTS = 4;

export async function decryptUint128ForView(_dexAddr: string, _handle: bigint): Promise<bigint> {
  const runtime = getCofheRuntime();
  for (let attempt = 1; attempt <= MAX_UNSEAL_ATTEMPTS; attempt++) {
    try {
      const value = await runtime.client.decryptForView(_handle, runtime.FheTypes.Uint128).execute();
      return BigInt(value);
    } catch (error) {
      if (attempt === MAX_UNSEAL_ATTEMPTS || !isRetryableUnsealError(error)) throw error;
      const delayMs = Math.min(2_000 * 2 ** (attempt - 1), 10_000);
      console.warn(`unseal retry ${attempt}/${MAX_UNSEAL_ATTEMPTS}:`, errorMessage(error));
      await sleep(delayMs);
    }
  }
  throw new Error("unreachable unseal retry state");
}

export async function decryptUint128ForTx(_dexAddr: string, _handle: bigint): Promise<{
  ctHash: bigint | string;
  decryptedValue: bigint;
  signature: `0x${string}`;
}> {
  const runtime = getCofheRuntime();
  const result = await runtime.client.decryptForTx(_handle).withPermit().execute();
  return {
    ctHash: result.ctHash,
    decryptedValue: BigInt(result.decryptedValue),
    signature: result.signature,
  };
}

export const unseal128 = decryptUint128ForView;

function isRetryableUnsealError(error: unknown) {
  const anyError = error as { code?: string; context?: { status?: number } };
  const status = anyError.context?.status;
  if (typeof status === "number") return status === 429 || status >= 500;
  return anyError.code === "SEAL_OUTPUT_FAILED";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
