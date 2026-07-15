import { toISODate } from "../domain/dates";
import { stableHash } from "../domain/ids";
import { defaultKind, type Transaction } from "../domain/types";

export interface ImportedTransactionInput {
  date: string;
  description: string;
  amount: number;
  account: string;
  direction: Transaction["direction"];
  note?: string;
}

/** One validated, deterministic construction seam for every imported row. */
export function makeImportedTransaction(input: ImportedTransactionInput): Transaction {
  const date = toISODate(input.date);
  const description = input.description.trim();
  const account = input.account.trim();
  const amount = Number(input.amount);
  if (!date || date !== input.date || !description || !Number.isFinite(amount) || amount <= 0) {
    throw new Error("Imported transaction data is incomplete or invalid.");
  }
  const roundedAmount = Number(amount.toFixed(2));
  const identity = [date, description.toUpperCase(), roundedAmount, account.toUpperCase(), input.direction].join("|");
  return {
    id: `txn_${stableHash(identity)}`,
    date,
    description,
    amount: roundedAmount,
    category: "uncategorized",
    beneficiary: { type: "unassigned" },
    account,
    note: input.note ?? "",
    source: "imported",
    direction: input.direction,
    kind: defaultKind(input.direction),
  };
}
