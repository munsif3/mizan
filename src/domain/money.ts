export interface CurrencySettings {
  /** ISO 4217 code, e.g. "USD", "LKR", "EUR" */
  currency: string;
  /** BCP 47 locale for grouping/formatting, e.g. "en-US"; empty = runtime default */
  locale: string;
}

/**
 * Format an amount for display (rounded, no decimals), prefixed with the
 * currency code — e.g. "USD 120,000". Uses Intl so grouping follows the
 * household locale; falls back gracefully if the currency code is unknown.
 */
export function formatMoney(value: number, { currency, locale }: CurrencySettings): string {
  const rounded = Math.round(Number(value) || 0);
  try {
    return new Intl.NumberFormat(locale || undefined, {
      style: "currency",
      currency,
      currencyDisplay: "code",
      maximumFractionDigits: 0,
    }).format(rounded);
  } catch {
    // Unknown/invalid currency code — keep it readable rather than throwing.
    return `${currency} ${rounded.toLocaleString(locale || undefined)}`.trim();
  }
}

/**
 * Parse an amount cell from a bank statement.
 * Handles thousands separators, "(1,200.00)", trailing "-", and "CR" markers as negatives.
 */
export function parseAmount(value: unknown): number {
  const text = String(value ?? "").replace(/,/g, "");
  const negative = /\(|\bCR\b|-$/.test(text.toUpperCase());
  const number = Number(text.replace(/[^\d.-]/g, "").replace(/-+$/, ""));
  if (!Number.isFinite(number)) return 0;
  return Math.abs(number) * (negative ? -1 : 1);
}
