import { formatUnits, parseUnits } from "viem";

const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 20 });

/** Format a base-unit amount with the token's decimals; at most `maxFraction` fraction digits. */
export function formatAmount(value: bigint, decimals: number, maxFraction = 4): string {
  const raw = formatUnits(value, decimals);
  const [whole, fraction = ""] = raw.split(".");
  const wholeText = grouped.format(BigInt(whole));
  let frac = fraction.slice(0, maxFraction).replace(/0+$/, "");
  if (frac.length === 0) {
    // Show a hint that a nonzero dust amount was cut off.
    return fraction.replace(/0+$/, "").length > 0 && value !== 0n ? `${wholeText}.${fraction.slice(0, maxFraction) || "0"}…` : wholeText;
  }
  if (fraction.replace(/0+$/, "").length > maxFraction) frac += "…";
  return `${wholeText}.${frac}`;
}

/** Parse a user-typed decimal amount; returns undefined when it is not a valid nonnegative number. */
export function parseAmount(text: string, decimals: number): bigint | undefined {
  const trimmed = text.trim().replace(/,/g, "");
  if (!/^\d*(\.\d*)?$/.test(trimmed) || trimmed === "" || trimmed === ".") return undefined;
  try {
    return parseUnits(trimmed, decimals);
  } catch {
    return undefined;
  }
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function formatTimestamp(seconds: bigint): string {
  return dateTime.format(new Date(Number(seconds) * 1000));
}

/** "2 days 3 hours", "45 minutes", "under a minute" */
export function formatDuration(seconds: bigint): string {
  const s = Number(seconds);
  if (s < 60) return "under a minute";
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days} ${days === 1 ? "day" : "days"}`);
  if (hours) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (!days && minutes) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  return parts.slice(0, 2).join(" ");
}

/** Convert a `datetime-local` value to Unix seconds in the visitor's time zone. */
export function localInputToUnix(value: string): bigint | undefined {
  if (!value) return undefined;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? undefined : BigInt(Math.floor(ms / 1000));
}

/** Format a Date as a `datetime-local` value (minute precision, local time zone). */
export function unixToLocalInput(seconds: number): string {
  const d = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
