import { accountForTransaction } from "./accounts";
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
const DEFAULT_WINDOW_DAYS = 3;

function dayDiff(a: string, b: string): number {
  const t1 = Date.parse(`${a}T00:00:00Z`);
  const t2 = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(t1) || Number.isNaN(t2)) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round((t1 - t2) / 86_400_000));
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
 * account), with compatible descriptions. An unregistered/unknown account is
 * never paired.
 *
 * Rows already classified as a non-expense movement are skipped — this only
 * proposes reclassifying rows that still read as plain spend/credit. Each leg is
 * used at most once. Returns candidates soonest-first, then by amount, for a
 * stable suggestion order. Suggestion only: nothing is reclassified here.
 */
export function detectTransferCandidates(
  transactions: Transaction[],
  accounts: Account[],
  windowDays = DEFAULT_WINDOW_DAYS,
  includeConfirmed = false,
  requireCompatibleDescriptions = true,
): TransferCandidate[] {
  const accountIdOf = (txn: Transaction) => accountForTransaction(txn, accounts)?.id;

  const debits = transactions.filter(
    (txn) => txn.direction === "debit" && (txn.kind === "expense" || (includeConfirmed && txn.kind === "internal_transfer")) && Boolean(accountIdOf(txn)),
  );
  const credits = transactions.filter(
    (txn) => txn.direction === "credit" && (txn.kind === "account_credit" || (includeConfirmed && txn.kind === "internal_transfer")) && Boolean(accountIdOf(txn)),
  );

  const possible: Array<{ left: string; right: string; cost: number; value: TransferCandidate }> = [];
  for (const debit of debits) {
    for (const credit of credits) {
      if (accountIdOf(credit) === accountIdOf(debit)) continue;
      if (Math.abs(netAmount(credit) - netAmount(debit)) > 0.005) continue;
      const daysApart = dayDiff(debit.date, credit.date);
      if (daysApart > windowDays) continue;
      if (requireCompatibleDescriptions && !descriptionsCompatible(debit.description, credit.description)) continue;
      possible.push({
        left: debit.id,
        right: credit.id,
        cost: daysApart,
        value: { debit, credit, daysApart },
      });
    }
  }

  return maximumCardinalityMinCostMatch(possible).sort(
    (a, b) => a.daysApart - b.daysApart || netAmount(b.debit) - netAmount(a.debit) || a.debit.id.localeCompare(b.debit.id),
  );
}
