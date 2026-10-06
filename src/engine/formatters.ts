/**
 * Deterministic numeric guards & executive formatting utilities.
 * Guarantees zero NaN, zero Infinity, and safe edge-case handling across all calculations.
 */

export function safeNum(val: number | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  if (!Number.isFinite(val)) return null;
  return val;
}

export function clampNum(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}

export function safePct(val: number | null | undefined): number | null {
  const n = safeNum(val);
  if (n === null) return null;
  return clampNum(n, 0, 100);
}

export function safeNonNeg(val: number | null | undefined): number | null {
  const n = safeNum(val);
  if (n === null) return null;
  return Math.max(0, n);
}

export function safeDivide(
  numerator: number | null | undefined,
  denominator: number | null | undefined
): number | null {
  const num = safeNum(numerator);
  const den = safeNum(denominator);
  if (num === null || den === null || den === 0) return null;
  const res = num / den;
  return Number.isFinite(res) ? res : null;
}

export function formatCurrency(
  amount: number | null | undefined,
  options?: { compact?: boolean; showSign?: boolean }
): string {
  const n = safeNum(amount);
  if (n === null) return 'UNVERIFIED';
  const sign = n < 0 ? '-' : options?.showSign && n > 0 ? '+' : '';
  const abs = Math.abs(n);
  if (options?.compact) {
    if (abs >= 1_000_000_000) {
      return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
    }
    if (abs >= 1_000_000) {
      return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
    }
    if (abs >= 10_000) {
      return `${sign}$${(abs / 1_000).toFixed(0)}K`;
    }
  }
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
}

export function formatPct(
  pct: number | null | undefined,
  decimals = 1,
  showSign = false
): string {
  const n = safeNum(pct);
  if (n === null) return 'UNVERIFIED';
  const sign = n > 0 && showSign ? '+' : '';
  const formatted = Number.isInteger(n) || decimals === 0 ? `${Math.round(n)}` : n.toFixed(decimals);
  return `${sign}${formatted}%`;
}

export function formatMultiple(val: number | null | undefined, decimals = 2): string {
  const n = safeNum(val);
  if (n === null) return 'UNVERIFIED';
  return `${n.toFixed(decimals)}x`;
}

export function formatCount(val: number | null | undefined, decimals = 0): string {
  const n = safeNum(val);
  if (n === null) return 'UNVERIFIED';
  return decimals === 0
    ? Math.round(n).toLocaleString('en-US')
    : n.toFixed(decimals);
}
