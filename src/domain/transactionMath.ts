import type { Transaction } from "./types";

/** Household-ledger share of a transaction after an optional split. */
export function netAmount(txn: Transaction): number {
  if (!txn.split) return txn.amount;
  const of = Math.max(1, Number(txn.split.of) || 1);
  const mine = Math.max(0, Number(txn.split.mine) || 0);
  return txn.amount * (mine / of);
}
