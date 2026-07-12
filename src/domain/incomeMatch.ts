import { ownerOf, resolveAccountLabel, transactionDisplayCurrency } from "./accounts";
import { monthOf } from "./dates";
import { expectedDeposit, fxRateFor, receiptFor, windowDaysFor } from "./income";
import { cleanMerchant } from "./rules";
import type { Account, IncomePortion, IncomeReceipt, Member, MemberId, Transaction } from "./types";

export interface IncomeCandidate {
  memberId: MemberId;
  portionId: string;
  transaction: Transaction;
  /** Household-currency credit amount. */
  amount: number;
  /** Amount and currency exactly as shown on the receiving statement. */
  sourceAmount: number;
  sourceCurrency: string;
  /** Household-currency units per source-currency unit. */
  fxRate: number;
  /** (amount - expected) / expected; negative means the deposit came in short. */
  variance: number;
  /** Zero inside the configured window (or when unscheduled). */
  daysOutsideWindow: number;
}

export interface IncomeMatchOptions {
  tolerance?: number;
  windowSlackDays?: number;
}

const DEFAULT_TOLERANCE = 0.15;
const DEFAULT_WINDOW_SLACK = 5;

function registeredAccount(transaction: Transaction, accounts: Account[]): boolean {
  const resolved = cleanMerchant(resolveAccountLabel(transaction.account, accounts));
  return accounts.some((account) => cleanMerchant(account.label) === resolved);
}

function daysOutsideWindow(portion: IncomePortion, month: string, transaction: Transaction): number {
  const window = windowDaysFor(portion, month);
  if (!window) return 0;
  const day = Number(transaction.date.slice(8, 10));
  if (day < window.startDay) return window.startDay - day;
  if (day > window.endDay) return day - window.endDay;
  return 0;
}

function linkedTransactionIds(receipts: IncomeReceipt[]): Set<string> {
  return new Set(receipts.map((receipt) => receipt.transactionId).filter((id): id is string => Boolean(id)));
}

/** Every unlinked statement credit that could plausibly evidence this portion. */
export function eligibleCredits(
  portion: IncomePortion,
  memberId: MemberId,
  transactions: Transaction[],
  accounts: Account[],
  receipts: IncomeReceipt[],
  month: string,
): Transaction[] {
  return eligibleCreditsWithin(portion, memberId, transactions, accounts, receipts, month, DEFAULT_WINDOW_SLACK);
}

function eligibleCreditsWithin(
  portion: IncomePortion,
  memberId: MemberId,
  transactions: Transaction[],
  accounts: Account[],
  receipts: IncomeReceipt[],
  month: string,
  windowSlackDays: number,
): Transaction[] {
  const linked = linkedTransactionIds(receipts);
  return transactions
    .filter((transaction) => {
      if (monthOf(transaction.date) !== month) return false;
      if (transaction.direction !== "credit" || transaction.kind !== "account_credit") return false;
      if (linked.has(transaction.id) || !registeredAccount(transaction, accounts)) return false;
      const owner = ownerOf(transaction.account, accounts);
      if (owner !== memberId && owner !== "joint") return false;
      return daysOutsideWindow(portion, month, transaction) <= windowSlackDays;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount || a.id.localeCompare(b.id));
}

/** Suggests at most one credit per portion and at most one portion per credit. */
export function detectIncomeCandidates(
  members: Member[],
  transactions: Transaction[],
  accounts: Account[],
  receipts: IncomeReceipt[],
  householdCurrency: string,
  fxRates: Record<string, number>,
  month: string,
  options: IncomeMatchOptions = {},
): IncomeCandidate[] {
  const tolerance = Math.max(0, options.tolerance ?? DEFAULT_TOLERANCE);
  const windowSlackDays = Math.max(0, options.windowSlackDays ?? DEFAULT_WINDOW_SLACK);
  const pairs: IncomeCandidate[] = [];

  for (const member of members) {
    for (const portion of member.portions) {
      if (receiptFor(receipts, month, portion.id)) continue;
      const expected = expectedDeposit(portion, householdCurrency, fxRates);
      if (expected.missingRate || expected.amount <= 0) continue;
      const portionCurrency = portion.currency.trim().toUpperCase() || householdCurrency.trim().toUpperCase();
      const rate = fxRateFor(portionCurrency, householdCurrency, fxRates);
      if (rate === null) continue;
      for (const transaction of eligibleCreditsWithin(portion, member.id, transactions, accounts, receipts, month, windowSlackDays)) {
        const creditCurrency = transactionDisplayCurrency(transaction, accounts, householdCurrency).trim().toUpperCase();
        let sourceAmount: number;
        let amount: number;
        let variance: number;
        if (creditCurrency === portionCurrency) {
          sourceAmount = Number(transaction.amount) || 0;
          amount = sourceAmount * rate;
          const expectedSource = Number(portion.amount) || 0;
          if (expectedSource <= 0) continue;
          variance = (sourceAmount - expectedSource) / expectedSource;
        } else if (creditCurrency === householdCurrency.trim().toUpperCase()) {
          sourceAmount = Number(transaction.amount) || 0;
          amount = sourceAmount;
          variance = (amount - expected.amount) / expected.amount;
        } else {
          continue;
        }
        const outside = daysOutsideWindow(portion, month, transaction);
        if (Math.abs(variance) > tolerance || outside > windowSlackDays) continue;
        pairs.push({
          memberId: member.id,
          portionId: portion.id,
          transaction,
          amount,
          sourceAmount,
          sourceCurrency: creditCurrency,
          fxRate: creditCurrency === householdCurrency.trim().toUpperCase() ? 1 : rate,
          variance,
          daysOutsideWindow: outside,
        });
      }
    }
  }

  pairs.sort(
    (a, b) =>
      a.daysOutsideWindow - b.daysOutsideWindow ||
      Math.abs(a.variance) - Math.abs(b.variance) ||
      b.amount - a.amount ||
      a.portionId.localeCompare(b.portionId) ||
      a.transaction.id.localeCompare(b.transaction.id),
  );

  const usedPortions = new Set<string>();
  const usedTransactions = new Set<string>();
  return pairs.filter((pair) => {
    if (usedPortions.has(pair.portionId) || usedTransactions.has(pair.transaction.id)) return false;
    usedPortions.add(pair.portionId);
    usedTransactions.add(pair.transaction.id);
    return true;
  });
}
