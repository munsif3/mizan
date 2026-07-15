import type { AppData } from "./types";

/**
 * Remove household ledger history while preserving reusable setup and
 * authoritative records that exist independently of statement rows.
 */
export function clearTransactionHistory(data: AppData): AppData {
  return {
    ...data,
    transactions: [],
    sharedContributions: [],
    incomeReceipts: data.incomeReceipts.map((receipt) => {
      if (!receipt.transactionId) return receipt;
      const { transactionId: _removed, ...unlinked } = receipt;
      return unlinked;
    }),
  };
}
