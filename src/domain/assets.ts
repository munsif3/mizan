import { monthOf } from "./dates";
import { ledgerIndexFor, type LedgerIndex } from "./ledgerIndex";
import { netAmount } from "./transactionMath";
import type { AppData, AssetHolding, AssetType, Transaction } from "./types";

export const ASSET_TYPE_OPTIONS: readonly { type: AssetType; label: string }[] = [
  { type: "cash", label: "Cash" },
  { type: "fixed_deposit", label: "Fixed deposit (FD)" },
  { type: "property", label: "Property" },
  { type: "shares", label: "Shares / ETFs" },
  { type: "managed_fund", label: "Unit trust / managed fund" },
  { type: "insurance_policy", label: "Insurance / investment policy" },
  { type: "retirement", label: "Retirement / provident fund" },
  { type: "gold", label: "Gold" },
  { type: "other", label: "Other" },
];

export function assetTypeLabel(type: AssetType): string {
  return ASSET_TYPE_OPTIONS.find((option) => option.type === type)?.label ?? "Other";
}

/** Household-currency cost-basis contribution represented by a transaction. */
export function holdingContributionAmount(transaction: Transaction): number {
  if (!transaction.holdingId) return 0;
  if (transaction.kind === "investment_transfer") return netAmount(transaction);
  const value = netAmount(transaction);
  const ratio = transaction.amount > 0 ? value / transaction.amount : 0;
  return Math.min(value, Math.max(0, Number(transaction.investmentAmount) || 0) * ratio);
}

function convertedValue(
  amount: number,
  currency: string,
  householdCurrency: string,
  fxRates: Record<string, number>,
): number | null {
  const native = currency.trim().toUpperCase();
  const household = householdCurrency.trim().toUpperCase();
  if (!native || native === household) return amount;
  const rate = Number(fxRates[native]);
  return Number.isFinite(rate) && rate > 0 ? amount * rate : null;
}

interface AssetSnapshotRow {
  holding: AssetHolding;
  /** Household-currency contributions through the selected month. */
  contributed: number;
  /** Latest native-currency valuation on or before the selected month. */
  nativeValue: number | null;
  /** Household-currency valuation, null when an FX rate is unavailable. */
  value: number | null;
  valuationDate: string;
}

export interface AssetSnapshot {
  rows: AssetSnapshotRow[];
  totalValue: number;
  contributed: number;
  unvaluedCount: number;
}

/**
 * Asset values are explicit snapshots. Transaction contributions are cost basis
 * only and never masquerade as current value.
 */
export function computeAssetSnapshot(
  data: AppData,
  month: string,
  ledgerIndex: LedgerIndex = ledgerIndexFor(data.transactions),
): AssetSnapshot {
  const monthEnd = `${month}-31`;
  const rows = data.assetHoldings
    .filter((holding) => holding.status !== "closed" || holding.valuations.some((item) => item.date <= monthEnd))
    .map((holding): AssetSnapshotRow => {
      const valuation = [...holding.valuations]
        .filter((item) => item.date <= monthEnd)
        .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))[0];
      const contributed = ledgerIndex
        .forHolding(holding.id)
        .filter((transaction) => transaction.holdingId === holding.id && monthOf(transaction.date) <= month)
        .reduce((sum, transaction) => sum + holdingContributionAmount(transaction), 0);
      const nativeValue = valuation ? Math.max(0, Number(valuation.amount) || 0) : null;
      return {
        holding,
        contributed,
        nativeValue,
        value: nativeValue === null
          ? null
          : convertedValue(nativeValue, holding.currency, data.settings.currency, data.settings.fxRates),
        valuationDate: valuation?.date ?? "",
      };
    })
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.holding.label.localeCompare(b.holding.label));
  return {
    rows,
    totalValue: rows.reduce((sum, row) => sum + (row.value ?? 0), 0),
    contributed: rows.reduce((sum, row) => sum + row.contributed, 0),
    unvaluedCount: rows.filter((row) => row.value === null).length,
  };
}
