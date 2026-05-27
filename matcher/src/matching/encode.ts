import { getCofheRuntime } from "../fhe/permit.js";

export async function encryptUint128(value: bigint): Promise<any> {
  const runtime = getCofheRuntime();
  const [encrypted] = await runtime.client.encryptInputs([
    runtime.Encryptable.uint128(value),
  ]).execute();
  return encrypted;
}
