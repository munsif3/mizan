import { monthOf } from "./dates";
import { netAmount } from "./transactionMath";
import type { Transaction } from "./types";

type LedgerAccountRef =
  | { kind: "id"; value: string }
  | { kind: "label"; value: string };

/**
 * Read-only transaction lookups for one immutable transaction-array revision.
 *
 * Exact commitment and holding lookups use durable ids. Account-label lookups
 * are case/whitespace insensitive, while account-id lookups remain exact.
 * Amount/date lookups use the effective household amount (`netAmount`) rounded
 * to minor units and a normalized ISO date.
 */
export interface LedgerIndex {
  readonly transactions: readonly Transaction[];
  forMonth(month: string): readonly Transaction[];
  forCommitment(commitmentId: string): readonly Transaction[];
  forHolding(holdingId: string): readonly Transaction[];
  forAccount(account: LedgerAccountRef): readonly Transaction[];
  forAmountOnDate(amount: number, date: string): readonly Transaction[];
  /**
   * Candidate superset for an effective amount on one date. Callers retain the
   * final exact tolerance check, because minor-unit buckets intentionally
   * over-include boundary values.
   */
  forAmountNearOnDate(amount: number, date: string, tolerance: number): readonly Transaction[];
}

const EMPTY_TRANSACTIONS: readonly Transaction[] = Object.freeze([]);
interface CachedLedgerIndex {
  readonly rowReferences: readonly Transaction[];
  readonly index: LedgerIndex;
}

const indexesByRevision = new WeakMap<readonly Transaction[], CachedLedgerIndex>();

function append(
  index: Map<string, Transaction[]>,
  key: string,
  transaction: Transaction,
): void {
  if (!key) return;
  const rows = index.get(key);
  if (rows) rows.push(transaction);
  else index.set(key, [transaction]);
}

function normalizedLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim().toUpperCase();
}

function normalizedDate(value: string): string {
  const date = value.trim();
  return /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : date;
}

function normalizedAmount(value: number): string {
  return Number.isFinite(value) ? String(Math.round((value + Number.EPSILON) * 100)) : "";
}

function amountDateKey(amount: number, date: string): string {
  const normalized = normalizedAmount(amount);
  return normalized ? `${normalizedDate(date)}:${normalized}` : "";
}

function amountDateBucketKey(minorUnits: number, date: string): string {
  return `${normalizedDate(date)}:${minorUnits}`;
}

function rowsFor(index: Map<string, Transaction[]>, key: string): readonly Transaction[] {
  return index.get(key) ?? EMPTY_TRANSACTIONS;
}

function buildLedgerIndex(transactions: readonly Transaction[]): LedgerIndex {
  const byMonth = new Map<string, Transaction[]>();
  const byCommitment = new Map<string, Transaction[]>();
  const byHolding = new Map<string, Transaction[]>();
  const byAccountId = new Map<string, Transaction[]>();
  const byAccountLabel = new Map<string, Transaction[]>();
  const byAmountDate = new Map<string, Transaction[]>();
  const rowOrder = new Map<Transaction, number>();

  transactions.forEach((transaction, order) => {
    rowOrder.set(transaction, order);
    append(byMonth, monthOf(transaction.date), transaction);
    append(byCommitment, transaction.commitmentId?.trim() ?? "", transaction);
    append(byHolding, transaction.holdingId?.trim() ?? "", transaction);
    append(byAccountId, transaction.accountId?.trim() ?? "", transaction);
    append(byAccountLabel, normalizedLabel(transaction.account), transaction);
    append(byAmountDate, amountDateKey(netAmount(transaction), transaction.date), transaction);
  });

  return {
    transactions,
    forMonth: (month) => rowsFor(byMonth, month.trim()),
    forCommitment: (commitmentId) => rowsFor(byCommitment, commitmentId.trim()),
    forHolding: (holdingId) => rowsFor(byHolding, holdingId.trim()),
    forAccount: (account) => rowsFor(
      account.kind === "id" ? byAccountId : byAccountLabel,
      account.kind === "id" ? account.value.trim() : normalizedLabel(account.value),
    ),
    forAmountOnDate: (amount, date) => rowsFor(byAmountDate, amountDateKey(amount, date)),
    forAmountNearOnDate: (amount, date, tolerance) => {
      if (!Number.isFinite(amount) || !Number.isFinite(tolerance) || tolerance < 0) {
        return transactions.filter((transaction) => normalizedDate(transaction.date) === normalizedDate(date));
      }
      const firstBucket = Math.floor((amount - tolerance) * 100);
      const lastBucket = Math.ceil((amount + tolerance) * 100);
      if (
        !Number.isSafeInteger(firstBucket)
        || !Number.isSafeInteger(lastBucket)
        || lastBucket - firstBucket > 10_000
      ) {
        return transactions.filter((transaction) => normalizedDate(transaction.date) === normalizedDate(date));
      }
      const candidates: Transaction[] = [];
      for (let bucket = firstBucket; bucket <= lastBucket; bucket += 1) {
        candidates.push(...rowsFor(byAmountDate, amountDateBucketKey(bucket, date)));
      }
      return candidates.sort((a, b) => (rowOrder.get(a) ?? 0) - (rowOrder.get(b) ?? 0));
    },
  };
}

/**
 * Return the shared index for a transaction-array revision.
 *
 * AppData transitions replace the array when ledger rows change, so referential
 * caching keeps repeated summary/history reads O(1) without retaining obsolete
 * revisions.
 */
export function ledgerIndexFor(transactions: readonly Transaction[]): LedgerIndex {
  const cached = indexesByRevision.get(transactions);
  if (
    cached
    && cached.rowReferences.length === transactions.length
    && cached.rowReferences.every((transaction, index) => transaction === transactions[index])
  ) return cached.index;
  const index = buildLedgerIndex(transactions);
  indexesByRevision.set(transactions, { rowReferences: [...transactions], index });
  return index;
}
