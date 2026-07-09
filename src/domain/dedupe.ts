import { cleanMerchant } from "./rules";
import type { Transaction } from "./types";

/** Identity of a transaction for duplicate detection across re-imports. */
export function transactionSignature(txn: Transaction): string {
  return [
    txn.date,
    cleanMerchant(txn.description),
    Number(txn.amount || 0).toFixed(2),
    cleanMerchant(txn.account || "Unknown"),
    txn.direction,
  ].join("|");
}

/** Keep only incoming transactions not already present (and not duplicated within the batch). */
export function filterNew(existing: Transaction[], incoming: Transaction[]): Transaction[] {
  const seen = new Set(existing.map(transactionSignature));
  const fresh: Transaction[] = [];
  for (const txn of incoming) {
    const signature = transactionSignature(txn);
    if (seen.has(signature)) continue;
    seen.add(signature);
    fresh.push(txn);
  }
  return fresh;
}
