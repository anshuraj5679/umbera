"use client";

import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { dexAbi, deployment } from "@/lib/dex";
import { wrapperAbi } from "@/lib/wrap";
import { computeCashAmount } from "@/lib/encoding";
import { useCofhe } from "@/lib/cofhe";
import { toUnits } from "@/lib/format";
import { toast } from "sonner";
import { Card, Field, NumInput, SelectNative, SideToggle, Pill } from "@/components/atoms";
import { useMemo } from "react";
import { receiptHasLogFrom, txOptions, waitForTransactionSuccess } from "@/lib/gas";

const schema = z.object({
  pairId: z.coerce.number().int().min(0),
  side: z.enum(["BUY", "SELL"]),
  size: z.string().regex(/^\d+(\.\d+)?$/, "size required"),
  maxPrice: z.string().regex(/^\d+(\.\d+)?$/, "price required"),
  expiryHours: z.coerce.number().int().min(1).max(168),
});

export function OrderEntryForm() {
  const { address } = useAccount();
  const dep = deployment();
  const { register, handleSubmit, watch, setValue, formState } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { pairId: 0, side: "BUY", expiryHours: 24, size: "0.5", maxPrice: "3200" },
  });
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const { ready: cofheReady, error: cofheError, encrypt128 } = useCofhe();

  const pairId = Number(watch("pairId") ?? 0);
  const side = watch("side");
  const size = watch("size");
  const maxPrice = watch("maxPrice");
  const expiryHours = watch("expiryHours");

  const pair = dep.pairs[pairId] ?? dep.pairs[0];
  const cash = pair.base;
  const asset = pair.quote;
  const cashSym = cash.symbol.replace(/^e/, "");
  const assetSym = asset.symbol.replace(/^e/, "");

  const { data: baseOperatorActive } = useReadContract({
    abi: wrapperAbi,
    address: cash.address as `0x${string}`,
    functionName: "isOperator",
    args: address ? [address, dep.dex as `0x${string}`] : undefined,
    query: { enabled: !!address, refetchInterval: 10000 },
  });
  const { data: quoteOperatorActive } = useReadContract({
    abi: wrapperAbi,
    address: asset.address as `0x${string}`,
    functionName: "isOperator",
    args: address ? [address, dep.dex as `0x${string}`] : undefined,
    query: { enabled: !!address, refetchInterval: 10000 },
  });

  const notional = useMemo(() => {
    const s = parseFloat(size || "0");
    const p = parseFloat(maxPrice || "0");
    return isFinite(s * p) ? s * p : 0;
  }, [size, maxPrice]);

  async function onSubmit(v: z.infer<typeof schema>) {
    if (!cofheReady) return toast.error(cofheError ?? "CoFHE not ready yet — wait a moment");
    if (!publicClient) return toast.error("Network client not ready");
    const p = dep.pairs[v.pairId];
    if (!p) return toast.error("invalid pair");
    if (baseOperatorActive !== true || quoteOperatorActive !== true) {
      return toast.error("Approve both pair tokens first", {
        description: "Side-private orders escrow encrypted legs for both tokens.",
      });
    }
    const assetRaw = toUnits(v.size, p.quote.decimals);
    const priceRaw = toUnits(v.maxPrice, p.base.decimals);
    const cashRaw = computeCashAmount(assetRaw, priceRaw, p.quote.decimals);
    const baseDepositRaw = v.side === "BUY" ? cashRaw : 0n;
    const quoteDepositRaw = v.side === "SELL" ? assetRaw : 0n;
    const baseRequestRaw = v.side === "SELL" ? cashRaw : 0n;
    const quoteRequestRaw = v.side === "BUY" ? assetRaw : 0n;
    const id = toast.loading("Encrypting order", { description: "Sealing handles via CoFHE…" });
    try {
      const enc = await encrypt128([baseDepositRaw, quoteDepositRaw, baseRequestRaw, quoteRequestRaw]);
      const expiry = BigInt(Math.floor(Date.now() / 1000) + v.expiryHours * 3600);
      toast.loading("Submitting encrypted order", { id, description: "Confirm in wallet, then wait for receipt" });
      const hash = await writeContractAsync({
        abi: dexAbi,
        address: dep.dex as `0x${string}`,
        functionName: "submitOrder",
        args: [BigInt(v.pairId), enc![0], enc![1], enc![2], enc![3], expiry],
        ...(await txOptions(publicClient as any, 6_000_000n)),
      });
      toast.loading("Waiting for confirmation", { id, description: hash });
      const receipt = await waitForTransactionSuccess(publicClient as any, hash);
      if (!receiptHasLogFrom(receipt, dep.dex as `0x${string}`)) {
        throw new Error("Transaction confirmed but no order was created");
      }
      toast.success("Order confirmed", { id, description: hash });
      window.dispatchEvent(new Event("orders:refresh"));
    } catch (e: any) {
      toast.error(e?.shortMessage ?? e?.message ?? "submit failed", { id });
    }
  }

  if (!address) {
    return (
      <Card title="Order Entry" subtitle="All fields below are encrypted before submission" meta={<>FHE · COFHE<br />SEALED HANDLE</>}>
        <div className="empty" style={{ padding: "40px 0" }}>
          <div className="empty__icon" />
          <div>Connect wallet to trade</div>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Order Entry" subtitle="All fields below are encrypted before submission" meta={<>FHE · COFHE<br />SEALED HANDLE</>}>
      <form onSubmit={handleSubmit(onSubmit)} className="col" style={{ gap: 22 }}>
        <div className="grid-2">
          <Field label="Pair">
            <SelectNative
              value={String(pairId)}
              onChange={(v) => setValue("pairId", Number(v))}
              options={dep.pairs.map((p) => ({ value: String(p.id), label: `${p.base.symbol} / ${p.quote.symbol}` }))}
            />
          </Field>
          <Field label="Side">
            <SideToggle value={side === "BUY" ? "buy" : "sell"} onChange={(v) => setValue("side", v === "buy" ? "BUY" : "SELL")} />
          </Field>
        </div>

        <div className="grid-2">
          <Field label={`Size · ${assetSym}`} hint={side === "BUY" ? "Asset amount to buy" : "Asset amount to sell"}>
            <NumInput value={size} onChange={(v) => setValue("size", v)} suffix={assetSym} placeholder="0.000" />
          </Field>
          <Field label={`${side === "BUY" ? "Max" : "Min"} Price · ${cashSym}/${assetSym}`} hint="Cash per asset">
            <NumInput value={maxPrice} onChange={(v) => setValue("maxPrice", v)} suffix={cashSym} placeholder="0.00" />
          </Field>
        </div>

        <div className="grid-2">
          <Field label="Expiry · Hours" hint="Between 1 and 168 (7d)">
            <NumInput value={String(expiryHours)} onChange={(v) => setValue("expiryHours", Number(v))} suffix="hr" step="1" />
          </Field>
          <Field label="Notional · Encrypted" hint="Visible only to you">
            <div className="input">
              <span className="input__prefix">≈</span>
              <input
                readOnly
                value={notional ? notional.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}
                style={{ color: "var(--emerald)", flex: 1, textAlign: "right", background: "transparent", border: 0, outline: 0, font: "inherit" }}
              />
              <span className="input__suffix">{cashSym}</span>
            </div>
          </Field>
        </div>

        <div className="row" style={{ justifyContent: "space-between", paddingTop: 6 }}>
          <div className="row" style={{ gap: 10 }}>
            <Pill kind="ok">FHE Sealed</Pill>
            <Pill kind={baseOperatorActive && quoteOperatorActive ? "ok" : "warn"}>Pair Operators</Pill>
            <Pill kind="muted">No-Front-Run</Pill>
          </div>
          <button type="submit" className="btn btn--primary" disabled={formState.isSubmitting || !Number(size) || !Number(maxPrice) || !cofheReady}>
            {formState.isSubmitting ? "Encrypting…" : !cofheReady ? (cofheError ? "CoFHE Error" : "Initializing CoFHE…") : "Submit Encrypted Order"}
          </button>
        </div>
        {cofheError && (
          <div style={{
            padding: "10px 12px",
            border: "1px solid color-mix(in oklch, var(--red) 40%, transparent)",
            background: "var(--red-bg)",
            borderRadius: 2,
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--red)",
            letterSpacing: "0.04em",
            wordBreak: "break-word",
          }}>
            CoFHE init failed: {cofheError}
          </div>
        )}
      </form>
    </Card>
  );
}
