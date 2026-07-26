import { accountForTransaction } from "./accounts";
import { ledgerIndexFor } from "./ledgerIndex";
import { maximumCardinalityMinCostMatch } from "./matching";
import { netAmount } from "./transactionMath";
import type { Account, Transaction } from "./types";

/** A debit/credit pair that looks like one internal transfer between owned accounts. */
export interface TransferCandidate {
  /** the money-out leg */
  debit: Transaction;
  /** the money-in leg */
  credit: Transaction;
  /** whole days between the two legs (0 = same day) */
  daysApart: number;
}

/** Default window: legs of one transfer usually clear within a few days. */
const DEFAULT_WINDOW_DAYS = 5;
const MAX_INDEXED_WINDOW_DAYS = 366;

function dayDiff(a: string, b: string): number {
  const t1 = Date.parse(`${a}T00:00:00Z`);
  const t2 = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(t1) || Number.isNaN(t2)) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round((t1 - t2) / 86_400_000));
}

/**
 * Exact ISO dates covered by the ordinary finite transfer window. A null
 * result asks the caller to fall back to the full eligible-credit list so
 * unusual dates/window values retain the legacy `dayDiff` semantics.
 */
function indexedDateWindow(date: string, windowDays: number): string[] | null {
  if (!Number.isFinite(windowDays) || windowDays > MAX_INDEXED_WINDOW_DAYS) return null;
  if (windowDays < 0) return [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) return null;
  const wholeDays = Math.floor(windowDays);
  return Array.from({ length: wholeDays * 2 + 1 }, (_, index) =>
    new Date(timestamp + (index - wholeDays) * 86_400_000).toISOString().slice(0, 10));
}

/** Case-insensitive token set of a description, for a loose "compatible" test. */
function tokens(description: string): Set<string> {
  return new Set(
    description
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter((word) => word.length >= 3),
  );
}

/**
 * Two legs are "compatible" when either shares a meaningful token with the
 * other, or when neither carries any meaningful token (bare "TRANSFER" rows).
 * Deliberately loose — this only ranks *suggestions*; the user confirms.
 */
function descriptionsCompatible(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return true;
  for (const word of ta) if (tb.has(word)) return true;
  return false;
}

/**
 * Deterministically find debit/credit pairs that look like one internal
 * transfer: the same net amount, dates within `windowDays`, on *different*
 * accounts that are both registered to the household (including a joint
 * account). Description compatibility ranks ambiguous matches but does not
 * block a same-amount pair. An unregistered or unassigned account is never
 * paired.
 *
 * By default, rows already classified as a non-expense movement are skipped.
 * `includeConfirmed` also considers unlinked internal-transfer legs so a later
 * statement import can complete an earlier one-sided classification. Each leg
 * is used at most once. Suggestion only: nothing is reclassified here.
 */
export function detectTransferCandidates(
  transactions: Transaction[],
  accounts: Account[],
  windowDays = DEFAULT_WINDOW_DAYS,
  includeConfirmed = false,
  rankCompatibleDescriptions = true,
): TransferCandidate[] {
  const accountIdOf = (txn: Transaction) => {
    const account = accountForTransaction(txn, accounts);
    return account && account.owner !== "unassigned" ? account.id : undefined;
  };

  const debits = transactions.filter(
    (txn) => txn.direction === "debit"
      && !txn.linkedTransferId
      && (txn.kind === "expense" || (includeConfirmed && txn.kind === "internal_transfer"))
      && Boolean(accountIdOf(txn)),
  );
  const credits = transactions.filter(
    (txn) => txn.direction === "credit"
      && !txn.linkedTransferId
      && (txn.kind === "account_credit" || (includeConfirmed && txn.kind === "internal_transfer"))
      && Boolean(accountIdOf(txn)),
  );
  const ledgerIndex = ledgerIndexFor(transactions);
  const eligibleCredits = new Set(credits);
  const creditOrder = new Map(credits.map((credit, index) => [credit, index]));

  const possible: Array<{ left: string; right: string; cost: number; value: TransferCandidate }> = [];
  for (const debit of debits) {
    const dateWindow = indexedDateWindow(debit.date, windowDays);
    const candidateCredits = dateWindow === null
      ? credits
      : dateWindow
        .flatMap((date) => ledgerIndex.forAmountNearOnDate(netAmount(debit), date, 0.005))
        .filter((transaction): transaction is Transaction => eligibleCredits.has(transaction))
        .sort((a, b) => (creditOrder.get(a) ?? 0) - (creditOrder.get(b) ?? 0));
    for (const credit of candidateCredits) {
      if (accountIdOf(credit) === accountIdOf(debit)) continue;
      if (debit.rejectedTransferIds?.includes(credit.id) || credit.rejectedTransferIds?.includes(debit.id)) continue;
      if (Math.abs(netAmount(credit) - netAmount(debit)) > 0.005) continue;
      const daysApart = dayDiff(debit.date, credit.date);
      if (daysApart > windowDays) continue;
      const descriptionsMatch = descriptionsCompatible(debit.description, credit.description);
      possible.push({
        left: debit.id,
        right: credit.id,
        cost: daysApart * 100 + (rankCompatibleDescriptions && !descriptionsMatch ? 25 : 0),
        value: { debit, credit, daysApart },
      });
    }
  }

  return maximumCardinalityMinCostMatch(possible).sort(
    (a, b) => a.daysApart - b.daysApart || netAmount(b.debit) - netAmount(a.debit) || a.debit.id.localeCompare(b.debit.id),
  );
}
