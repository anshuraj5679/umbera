export function fromUnits(amount: bigint, decimals: number, max = 4): string {
  const neg = amount < 0n;
  const a = neg ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = a / base;
  const frac = a % base;
  if (frac === 0n) return (neg ? "-" : "") + whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  const truncated = fracStr.slice(0, max);
  return (neg ? "-" : "") + whole.toString() + (truncated ? "." + truncated : "");
}

export function toUnits(value: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error("invalid number");
  const [w, f = ""] = value.split(".");
  const padded = (f + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(w) * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

export function shortHex(s: string, n = 4): string {
  if (!s || s.length < 10) return s;
  return s.slice(0, 2 + n) + "…" + s.slice(-n);
}
