import type { Transaction } from "./types";

export interface FxConversion {
  originalCurrency: string;
  originalAmount: number;
  rate: number;
  convertedAmount: number;
}

/**
 * Read the explicit foreign-currency shape NTB places in descriptions, e.g.
 * `FUND TRANSFER USD 1900 @332`.
 */
export function parseFxConversion(description: string): FxConversion | null {
  const match = description.toUpperCase().match(/\b([A-Z]{3})\s+([\d,]+(?:\.\d+)?)\s*@\s*([\d,]+(?:\.\d+)?)\b/);
  if (!match) return null;
  const originalAmount = Number(match[2]!.replace(/,/g, ""));
  const rate = Number(match[3]!.replace(/,/g, ""));
  if (!Number.isFinite(originalAmount) || !Number.isFinite(rate) || originalAmount <= 0 || rate <= 0) return null;
  return {
    originalCurrency: match[1]!,
    originalAmount,
    rate,
    convertedAmount: Number((originalAmount * rate).toFixed(2)),
  };
}

function closeTo(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= Math.max(0.01, expected * 0.00001);
}

/** One compatibility seam for the audit note used before structured FX evidence existed. */
export function hasFxConversionEvidence(txn: Pick<Transaction, "note">): boolean {
  return txn.note.includes("FX conversion:");
}

/**
 * Mizan's ledger uses one household currency. When an FX description carries
 * both the original amount and rate, normalize a row still booked at the
 * foreign amount to its household-currency value. Rows already carrying the
 * converted statement amount are left numerically unchanged. In both cases a
 * compact audit note preserves the conversion that was used.
 */
export function normalizeFxTransaction(txn: Transaction, householdCurrency: string): Transaction {
  const fx = parseFxConversion(txn.description);
  const currency = householdCurrency.trim().toUpperCase();
  if (!fx || !currency || fx.originalCurrency === currency) return txn;

  const carriesOriginal = closeTo(txn.amount, fx.originalAmount);
  const carriesConverted = closeTo(txn.amount, fx.convertedAmount);
  if (!carriesOriginal && !carriesConverted) return txn;

  const audit = `FX conversion: ${fx.originalCurrency} ${fx.originalAmount.toLocaleString("en-US")} at ${fx.rate.toLocaleString("en-US")} = ${currency} ${fx.convertedAmount.toLocaleString("en-US")}`;
  const note = hasFxConversionEvidence(txn) ? txn.note : [txn.note, audit].filter(Boolean).join("; ");
  const amount = carriesOriginal ? fx.convertedAmount : txn.amount;
  return amount === txn.amount && note === txn.note ? txn : { ...txn, amount, note };
}
