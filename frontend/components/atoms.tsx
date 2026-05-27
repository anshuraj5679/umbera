"use client";

import type { ReactNode } from "react";

export function PageHead({ num, title, em, meta }: { num: string; title: string; em?: string; meta?: ReactNode }) {
  return (
    <div className="page-head">
      <span className="page-num">{num}</span>
      <h1 className="page-title">
        {title} {em && <em>{em}</em>}
      </h1>
      <div className="page-meta">{meta}</div>
    </div>
  );
}

export function Card({
  title, subtitle, meta, children, foot,
}: { title?: ReactNode; subtitle?: ReactNode; meta?: ReactNode; children: ReactNode; foot?: ReactNode }) {
  return (
    <section className="card">
      {(title || meta) && (
        <header className="card__head">
          <div>
            {title && <div className="card__title">{title}</div>}
            {subtitle && <div className="card__subtitle">{subtitle}</div>}
          </div>
          {meta && <div className="card__meta">{meta}</div>}
        </header>
      )}
      <div className="card__inner">{children}</div>
      {foot}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

export function NumInput({
  value, onChange, placeholder, suffix, prefix, step, readOnly, style,
}: {
  value: string; onChange?: (v: string) => void; placeholder?: string;
  suffix?: string; prefix?: string; step?: string; readOnly?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div className="input">
      {prefix && <span className="input__prefix">{prefix}</span>}
      <input
        type="number"
        inputMode="decimal"
        value={value}
        step={step ?? "any"}
        placeholder={placeholder ?? "0.00"}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
        style={style}
      />
      {suffix && <span className="input__suffix">{suffix}</span>}
    </div>
  );
}

export function SelectNative({
  value, onChange, options,
}: { value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <select className="select-native" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function SideToggle({ value, onChange }: { value: "buy" | "sell"; onChange: (v: "buy" | "sell") => void }) {
  return (
    <div className="side-toggle" role="tablist">
      <button type="button" data-side="buy" className={value === "buy" ? "is-active" : ""} onClick={() => onChange("buy")}>Buy</button>
      <button type="button" data-side="sell" className={value === "sell" ? "is-active" : ""} onClick={() => onChange("sell")}>Sell</button>
    </div>
  );
}

export function Pill({ kind = "muted", children }: { kind?: "ok" | "warn" | "bad" | "muted"; children: ReactNode }) {
  return <span className={`pill pill--${kind}`}>{children}</span>;
}

export function Cell({
  label, value, size = "md", encrypted, muted,
}: { label: string; value: ReactNode; size?: "sm" | "md" | "lg"; encrypted?: boolean; muted?: boolean }) {
  const cls = ["cell__value"];
  if (size === "lg") cls.push("cell__value--lg");
  if (size === "sm") cls.push("cell__value--sm");
  if (encrypted) cls.push("is-encrypted");
  if (muted) cls.push("is-muted");
  return (
    <div className="cell">
      <span className="cell__label">{label}</span>
      <span className={cls.join(" ")}>{value}</span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon" />
      <div>{children}</div>
    </div>
  );
}
