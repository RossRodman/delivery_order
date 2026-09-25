import { assertSafeInt, DomainError } from "./errors";

export type Cents = number; // integer USD cents
export type Sdg = number; // integer SDG

/**
 * Exact integer division rounded half away from zero (half-up for non-negative inputs).
 * Uses the remainder, never floating-point division of the operands.
 */
export function divRoundHalfUp(n: number, d: number): number {
  assertSafeInt(n, "n");
  assertSafeInt(d, "d");
  if (d <= 0) throw new DomainError(`divisor must be > 0, got ${d}`);
  if (n < 0) return -divRoundHalfUp(-n, d);
  const r = n % d;
  const q = (n - r) / d; // exact: n - r is a multiple of d
  return r * 2 >= d ? q + 1 : q;
}

const USD_PATTERN = /^\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/**
 * Parses a dollar amount typed by a user into integer cents without floats.
 * Accepts "40", "40.5", "40.50", "1,550", "1,550.50" (optional leading "$").
 * Returns null for anything else (negative, exponent, > 2 decimals, empty, unsafe size).
 */
export function parseUsdToCents(input: string): Cents | null {
  const match = USD_PATTERN.exec(input.trim());
  if (!match) return null;
  const dollars = match[1].replace(/,/g, "");
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const cents = Number(dollars) * 100 + Number(fraction);
  return Number.isSafeInteger(cents) ? cents : null;
}

const integerFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function formatInt(value: number): string {
  return integerFormat.format(value);
}

/** 202000 → "$2,020"; 155050 → "$1,550.50"; -500 → "-$5". */
export function formatUsd(cents: Cents): string {
  assertSafeInt(cents, "cents");
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const rem = abs % 100;
  const dollars = (abs - rem) / 100;
  const fraction = rem === 0 ? "" : `.${String(rem).padStart(2, "0")}`;
  return `${sign}$${formatInt(dollars)}${fraction}`;
}

/** 29274000 → "29,274,000 SDG". */
export function formatSdg(sdg: Sdg): string {
  assertSafeInt(sdg, "sdg");
  return `${formatInt(sdg)} SDG`;
}

/** Basis points (hundredths of a percent) → "1.94%". */
export function formatPercent(basisPoints: number): string {
  assertSafeInt(basisPoints, "basisPoints");
  const sign = basisPoints < 0 ? "-" : "";
  const abs = Math.abs(basisPoints);
  const rem = abs % 100;
  const whole = (abs - rem) / 100;
  return `${sign}${formatInt(whole)}.${String(rem).padStart(2, "0")}%`;
}

/** 8200 → "8,200 SDG/USD". */
export function formatRate(rate: number): string {
  assertSafeInt(rate, "rate");
  return `${formatInt(rate)} SDG/USD`;
}
