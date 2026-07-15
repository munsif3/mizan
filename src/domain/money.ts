export interface CurrencySettings {
  /** ISO 4217 code, e.g. "USD", "LKR", "EUR" */
  currency: string;
  /** BCP 47 locale for grouping/formatting, e.g. "en-US"; empty = runtime default */
  locale: string;
}

export const INCOME_MATCH_TOLERANCE = 0.15;

export function normalizeCurrency(currency: string | null | undefined, fallback = ""): string {
  return String(currency ?? "").trim().toUpperCase() || String(fallback ?? "").trim().toUpperCase();
}

export function relativeVariance(actual: number, expected: number): number {
  const target = Number(expected);
  if (!Number.isFinite(target) || target <= 0) return Number.POSITIVE_INFINITY;
  return (Number(actual) - target) / target;
}

export interface IncomeCurrencyResolution {
  currency: string;
  conflict: boolean;
  source: "receipt" | "candidate" | "portion-match" | "account" | "portion" | "household";
}

/** Resolve the currency represented by an income statement amount. */
export function resolveIncomeCurrency({
  savedCurrency,
  candidateCurrency,
  accountCurrency,
  portionCurrency,
  householdCurrency,
  statementAmount,
  portionAmount,
  fxRate,
  tolerance = INCOME_MATCH_TOLERANCE,
}: {
  savedCurrency?: string;
  candidateCurrency?: string;
  accountCurrency?: string;
  portionCurrency?: string;
  householdCurrency: string;
  statementAmount?: number;
  portionAmount?: number;
  fxRate?: number | null;
  tolerance?: number;
}): IncomeCurrencyResolution {
  const household = normalizeCurrency(householdCurrency);
  const portion = normalizeCurrency(portionCurrency, household);
  const account = normalizeCurrency(accountCurrency);
  const saved = normalizeCurrency(savedCurrency);
  const candidate = normalizeCurrency(candidateCurrency);
  const conflict = Boolean(account && portion && account !== portion);

  if (saved) return { currency: saved, conflict, source: "receipt" };
  if (candidate) return { currency: candidate, conflict, source: "candidate" };

  const amount = Number(statementAmount);
  const expectedNative = Number(portionAmount);
  const rate = Number(fxRate);
  if (conflict && account === household && Number.isFinite(amount) && Number.isFinite(expectedNative) && expectedNative > 0) {
    const nativeMatches = Math.abs(relativeVariance(amount, expectedNative)) <= tolerance;
    const accountExpected = Number.isFinite(rate) && rate > 0
      ? expectedNative * rate
      : Number.NaN;
    const accountMatches = Number.isFinite(accountExpected)
      && Math.abs(relativeVariance(amount, accountExpected)) <= tolerance;
    if (nativeMatches && !accountMatches) return { currency: portion, conflict, source: "portion-match" };
  }

  if (account) return { currency: account, conflict, source: "account" };
  if (portion) return { currency: portion, conflict: false, source: "portion" };
  return { currency: household, conflict: false, source: "household" };
}

/**
 * Format an amount for display (rounded, no decimals), prefixed with the
 * currency code — e.g. "USD 120,000". Uses Intl so grouping follows the
 * household locale; falls back gracefully if the currency code is unknown.
 */
export function formatMoney(value: number, { currency, locale }: CurrencySettings): string {
  const rounded = Math.round(Number(value) || 0);
  const code = normalizeCurrency(currency);
  try {
    return new Intl.NumberFormat(locale || undefined, {
      style: "currency",
      currency: code,
      currencyDisplay: "code",
      maximumFractionDigits: 0,
    }).format(rounded);
  } catch {
    // Unknown/invalid currency code — keep it readable rather than throwing.
    return `${code} ${rounded.toLocaleString(locale || undefined)}`.trim();
  }
}

/**
 * Parse an amount cell from a bank statement.
 * Handles thousands separators, "(1,200.00)", trailing "-", and "CR" markers as negatives.
 */
export function parseAmount(value: unknown): number {
  const text = String(value ?? "").replace(/,/g, "");
  const negative = /^\s*-|\(|\bCR\b|-$/.test(text.toUpperCase());
  const number = Number(text.replace(/[^\d.-]/g, "").replace(/-+$/, ""));
  if (!Number.isFinite(number)) return 0;
  return Math.abs(number) * (negative ? -1 : 1);
}
