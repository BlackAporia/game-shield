import { num } from "starknet";

export function fmtStrk(amount: bigint): string {
  const whole = amount / 10n ** 18n;
  const frac = (amount % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function fmtDeadline(ts: bigint): string {
  const n = Number(ts);
  return new Date(n * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function formatDuration(seconds: bigint): string {
  if (seconds === 0n) return "0 seconds";
  const units: [bigint, string][] = [[86400n, "day"], [3600n, "hour"], [60n, "minute"], [1n, "second"]];
  let remaining = seconds;
  const parts: string[] = [];
  for (const [size, label] of units) {
    const count = remaining / size;
    if (count > 0n) {
      parts.push(`${count} ${label}${count === 1n ? "" : "s"}`);
      remaining %= size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(" ");
}

export function defaultDeadline(): string {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  date.setSeconds(0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function shortHex(h: string): string {
  const hex = num.toHex(h);
  return hex.length <= 13 ? hex : `${hex.slice(0, 7)}…${hex.slice(-4)}`;
}

export function prettyStatus(finality?: string, exec?: string): string {
  const f =
    finality === "ACCEPTED_ON_L2"
      ? "Accepted on L2"
      : finality === "ACCEPTED_ON_L1"
        ? "Accepted on L1"
        : finality === "RECEIVED"
          ? "Received"
          : "";
  const e = exec === "SUCCEEDED" ? "Succeeded" : exec === "REVERTED" ? "Reverted" : "";
  return [f, e].filter(Boolean).join(" · ") || "Confirmed";
}

export function decodeFeltString(hex: string | null | undefined): string | null {
  try {
    if (!hex || hex === "0x0") return null;
    const trimmed = hex.startsWith("0x") ? hex.slice(2) : hex;
    let s = "";
    for (let i = 0; i < trimmed.length; i += 2) {
      const code = parseInt(trimmed.slice(i, i + 2), 16);
      if (code === 0) break;
      s += String.fromCharCode(code);
    }
    return s || null;
  } catch {
    return null;
  }
}
