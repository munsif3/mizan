import type { Transaction } from "../../domain/types";

export type RequestConfirmation = (
  title: string,
  body: string,
  confirmLabel: string,
  action: () => void,
) => void;

export function changedTransactions(current: Transaction[], next: Transaction[]): Transaction[] {
  return next.filter((transaction, index) =>
    JSON.stringify(transaction) !== JSON.stringify(current[index]));
}
