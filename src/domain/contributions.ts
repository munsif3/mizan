import { ownerOfTransaction } from "./accounts";
import { monthOf } from "./dates";
import { cleanMerchant } from "./rules";
import { netAmount } from "./transactionMath";
import { detectTransferCandidates } from "./transfers";
import type {
  Account,
  Member,
  MemberId,
  SharedContribution,
  SharedContributionAllocation,
  Transaction,
} from "./types";

const AMOUNT_TOLERANCE = 0.005;
const CONTRIBUTION_WINDOW_DAYS = 31;
const RECOVERY_GROUP_WINDOW_DAYS = 7;

export interface SharedContributionCandidate {
  debit: Transaction;
  credit: Transaction;
  expenses: Transaction[];
  allocations: SharedContributionAllocation[];
  contributorMemberId: MemberId;
  amount: number;
  daysApart: number;
  sameMonth: boolean;
}

export function sharedContributionId(expenseIds: string[], debitId: string, creditId: string): string {
  return `contrib_${[...expenseIds].sort().join("_")}_${debitId}_${creditId}`;
}

export function transactionContributionAmount(txn: Transaction): number {
  return netAmount(txn);
}

function dayDiff(a: string, b: string): number {
  const first = Date.parse(`${a}T00:00:00Z`);
  const second = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round((first - second) / 86_400_000));
}

function sameAccount(a: Transaction, b: Transaction): boolean {
  if (a.accountId && b.accountId) return a.accountId === b.accountId;
  return a.account.trim().toUpperCase() === b.account.trim().toUpperCase();
}

function descriptionTokens(value: string): Set<string> {
  return new Set(value.toUpperCase().split(/[^A-Z0-9]+/).filter((token) => token.length >= 3));
}

function descriptionScore(pair: { debit: Transaction; credit: Transaction }, expenses: Transaction[]): number {
  const evidence = new Set([...descriptionTokens(pair.debit.description), ...descriptionTokens(pair.credit.description)]);
  let score = 0;
  for (const expense of expenses) {
    for (const token of descriptionTokens(expense.description)) if (evidence.has(token)) score += 1;
  }
  return score;
}

/** Exact loan identifier wins; otherwise the cleaned recovery description is the group key. */
function recoveryDescriptionKey(description: string): string {
  const cleaned = cleanMerchant(description);
  const identifier = cleaned.match(/\d{8,}/)?.[0];
  return identifier ? `ID:${identifier}` : `DESC:${cleaned}`;
}

function existingFundingByExpense(contributions: SharedContribution[], ignoreId = ""): Map<string, number> {
  const funded = new Map<string, number>();
  for (const contribution of contributions) {
    if (contribution.id === ignoreId) continue;
    for (const allocation of contribution.allocations) {
      funded.set(allocation.expenseTransactionId, (funded.get(allocation.expenseTransactionId) ?? 0) + allocation.amount);
    }
  }
  return funded;
}

/**
 * Allocate proven money to selected recoveries in cash-flow order: closest rows
 * on/after the incoming credit first, then closest earlier rows.
 */
export function allocateSharedContribution(
  amount: number,
  creditDate: string,
  expenses: Transaction[],
  existing: SharedContribution[] = [],
  ignoreContributionId = "",
): SharedContributionAllocation[] {
  const funded = existingFundingByExpense(existing, ignoreContributionId);
  const ordered = [...expenses].sort((a, b) => {
    const aAfter = a.date >= creditDate;
    const bAfter = b.date >= creditDate;
    if (aAfter !== bAfter) return aAfter ? -1 : 1;
    return dayDiff(a.date, creditDate) - dayDiff(b.date, creditDate) || a.id.localeCompare(b.id);
  });
  let remaining = amount;
  const allocations: SharedContributionAllocation[] = [];
  for (const expense of ordered) {
    if (remaining <= AMOUNT_TOLERANCE) break;
    const capacity = Math.max(0, transactionContributionAmount(expense) - (funded.get(expense.id) ?? 0));
    const allocated = Math.min(capacity, remaining);
    if (allocated > AMOUNT_TOLERANCE) allocations.push({ expenseTransactionId: expense.id, amount: allocated });
    remaining -= allocated;
  }
  return allocations;
}

/** All partial recovery rows in the same confirmed recovery group, including rows allocated zero contributor funding. */
export function recoveryRowsForContribution(contribution: SharedContribution, transactions: Transaction[]): Transaction[] {
  const byId = new Map(transactions.map((txn) => [txn.id, txn]));
  const seeds = contribution.allocations
    .map((allocation) => byId.get(allocation.expenseTransactionId))
    .filter((txn): txn is Transaction => Boolean(txn));
  if (!seeds.length) return [];
  return transactions.filter((txn) =>
    txn.direction === "debit"
      && txn.kind === "loan_payment"
      && seeds.some((seed) =>
        sameAccount(seed, txn)
          && seed.category === txn.category
          && recoveryDescriptionKey(seed.description) === recoveryDescriptionKey(txn.description)
          && dayDiff(seed.date, txn.date) <= RECOVERY_GROUP_WINDOW_DAYS,
      ),
  );
}

export function contributionReferencesTransaction(contribution: SharedContribution, transactionId: string, transactions: Transaction[]): boolean {
  return contribution.transferDebitTransactionId === transactionId
    || contribution.transferCreditTransactionId === transactionId
    || recoveryRowsForContribution(contribution, transactions).some((txn) => txn.id === transactionId);
}

/** Return a reason when a contribution is unsafe, otherwise null. */
export function sharedContributionError(
  contribution: SharedContribution,
  transactions: Transaction[],
  accounts: Account[],
  members: Member[],
  existing: SharedContribution[] = [],
  requireConfirmedTransfers = false,
): string | null {
  const transactionById = new Map(transactions.map((txn) => [txn.id, txn]));
  const debit = transactionById.get(contribution.transferDebitTransactionId);
  const credit = transactionById.get(contribution.transferCreditTransactionId);
  const allocations = contribution.allocations ?? [];
  const expenses = allocations.map((allocation) => transactionById.get(allocation.expenseTransactionId));
  if (!debit || !credit || expenses.some((expense) => !expense)) return "A linked statement row no longer exists.";
  if (!allocations.length) return "Select at least one loan recovery deduction.";
  const expenseRows = expenses as Transaction[];
  const allIds = [debit.id, credit.id, ...expenseRows.map((expense) => expense.id)];
  if (new Set(allIds).size !== allIds.length) return "The transfer evidence and loan recoveries must be different rows.";
  if (!members.some((member) => member.id === contribution.contributorMemberId)) return "The contributing household member no longer exists.";
  if (debit.direction !== "debit" || credit.direction !== "credit") return "Contribution evidence must contain one outgoing and one incoming transfer row.";
  if (requireConfirmedTransfers && (debit.kind !== "internal_transfer" || credit.kind !== "internal_transfer")) {
    return "Both contribution evidence rows must be confirmed internal transfers.";
  }
  if (Math.abs(transactionContributionAmount(debit) - transactionContributionAmount(credit)) > AMOUNT_TOLERANCE) return "The two transfer rows do not have the same amount.";
  if (!Number.isFinite(contribution.amount) || contribution.amount <= 0 || Math.abs(contribution.amount - transactionContributionAmount(debit)) > AMOUNT_TOLERANCE) {
    return "The contribution amount must equal the matched transfer amount.";
  }
  if (ownerOfTransaction(debit, accounts) !== contribution.contributorMemberId) return "The outgoing transfer account does not belong to the contributor.";

  const allocationTotal = allocations.reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
  if (allocations.some((allocation) => !Number.isFinite(allocation.amount) || allocation.amount <= 0) || Math.abs(allocationTotal - contribution.amount) > AMOUNT_TOLERANCE) {
    return "Recovery allocations must be positive and equal the matched contribution amount.";
  }
  const firstExpense = expenseRows[0]!;
  const category = firstExpense.category;
  const descriptionKey = recoveryDescriptionKey(firstExpense.description);
  const expensePayer = ownerOfTransaction(firstExpense, accounts);
  if (expensePayer === "joint" || !members.some((member) => member.id === expensePayer)) return "The loan-paying account needs a household-member owner.";
  if (expensePayer === contribution.contributorMemberId) return "The contributor and loan-paying account owner must be different members.";
  const dates = expenseRows.map((expense) => expense.date).sort();
  if (dayDiff(dates[0]!, dates[dates.length - 1]!) > RECOVERY_GROUP_WINDOW_DAYS) return "Selected recovery deductions are more than seven days apart.";

  for (const expense of expenseRows) {
    if (!sameAccount(credit, expense)) return "Every incoming contribution must land in the account that pays the selected recoveries.";
    if (expense.direction !== "debit" || expense.kind !== "loan_payment" || expense.beneficiary.type !== "household") {
      return "Every funded row must be a shared loan or debt payment.";
    }
    if (expense.category !== category || recoveryDescriptionKey(expense.description) !== descriptionKey) {
      return "Selected deductions must belong to the same loan recovery.";
    }
    if (dayDiff(credit.date, expense.date) > CONTRIBUTION_WINDOW_DAYS) return "A selected recovery is too far from the contribution date.";
    if (ownerOfTransaction(expense, accounts) !== expensePayer) return "Every selected recovery must use the same member-owned account.";
  }

  for (const item of existing) {
    if (item.id === contribution.id) continue;
    if (item.transferDebitTransactionId === debit.id || item.transferCreditTransactionId === credit.id) return "One of these transfer rows is already linked to another contribution.";
  }
  const fundedElsewhere = existingFundingByExpense(existing, contribution.id);
  for (const allocation of allocations) {
    const expense = transactionById.get(allocation.expenseTransactionId)!;
    if ((fundedElsewhere.get(expense.id) ?? 0) + allocation.amount - transactionContributionAmount(expense) > AMOUNT_TOLERANCE) {
      return "Confirmed contributions exceed one of the selected recovery deductions.";
    }
  }
  return null;
}

/** Keep only valid, non-overlapping records. Stored order deterministically wins conflicts. */
export function pruneSharedContributions(
  contributions: SharedContribution[],
  transactions: Transaction[],
  accounts: Account[],
  members: Member[],
): SharedContribution[] {
  const kept: SharedContribution[] = [];
  for (const contribution of contributions) {
    if (!sharedContributionError(contribution, transactions, accounts, members, kept, true)) kept.push(contribution);
  }
  return kept;
}

function recoveryGroups(expenses: Transaction[]): Transaction[][] {
  const byKey = new Map<string, Transaction[]>();
  for (const expense of expenses) {
    const accountKey = expense.accountId || expense.account.trim().toUpperCase();
    const key = `${accountKey}|${expense.category}|${recoveryDescriptionKey(expense.description)}`;
    const rows = byKey.get(key) ?? [];
    rows.push(expense);
    byKey.set(key, rows);
  }
  const groups: Transaction[][] = [];
  for (const rows of byKey.values()) {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    let group: Transaction[] = [];
    for (const row of sorted) {
      if (group.length && dayDiff(group[0]!.date, row.date) > RECOVERY_GROUP_WINDOW_DAYS) {
        groups.push(group);
        group = [];
      }
      group.push(row);
    }
    if (group.length) groups.push(group);
  }
  return groups;
}

/** Suggest confirmed transfer evidence against one or more partial recovery rows. */
export function detectSharedContributionCandidates(
  transactions: Transaction[],
  accounts: Account[],
  members: Member[],
  contributions: SharedContribution[],
): SharedContributionCandidate[] {
  const valid = pruneSharedContributions(contributions, transactions, accounts, members);
  const usedDebitIds = new Set(valid.map((item) => item.transferDebitTransactionId));
  const usedCreditIds = new Set(valid.map((item) => item.transferCreditTransactionId));
  const expenses = transactions.filter(
    (txn) => txn.direction === "debit" && txn.kind === "loan_payment" && txn.beneficiary.type === "household",
  );
  const pairs = detectTransferCandidates(transactions, accounts, 3, true, false).filter(
    (pair) => !usedDebitIds.has(pair.debit.id) && !usedCreditIds.has(pair.credit.id),
  );
  const candidates: (SharedContributionCandidate & { descriptionScore: number })[] = [];
  for (const pair of pairs) {
    const contributorMemberId = ownerOfTransaction(pair.debit, accounts);
    if (contributorMemberId === "joint" || !members.some((member) => member.id === contributorMemberId)) continue;
    const eligible = expenses.filter((expense) => {
      if (!sameAccount(pair.credit, expense) || dayDiff(pair.credit.date, expense.date) > CONTRIBUTION_WINDOW_DAYS) return false;
      const expensePayer = ownerOfTransaction(expense, accounts);
      return expensePayer !== "joint" && expensePayer !== contributorMemberId;
    });
    for (const group of recoveryGroups(eligible)) {
      const amount = transactionContributionAmount(pair.debit);
      const allocations = allocateSharedContribution(amount, pair.credit.date, group, valid);
      if (Math.abs(allocations.reduce((sum, allocation) => sum + allocation.amount, 0) - amount) > AMOUNT_TOLERANCE) continue;
      const selectedExpenses = group;
      const daysApart = Math.min(...selectedExpenses.map((expense) => dayDiff(pair.credit.date, expense.date)));
      candidates.push({
        debit: pair.debit,
        credit: pair.credit,
        expenses: selectedExpenses,
        allocations,
        contributorMemberId,
        amount,
        daysApart,
        sameMonth: selectedExpenses.every((expense) => monthOf(pair.credit.date) === monthOf(expense.date)),
        descriptionScore: descriptionScore(pair, selectedExpenses),
      });
    }
  }
  return candidates
    .sort((a, b) => Number(b.sameMonth) - Number(a.sameMonth) || a.daysApart - b.daysApart || b.descriptionScore - a.descriptionScore || a.expenses[0]!.id.localeCompare(b.expenses[0]!.id))
    .map(({ descriptionScore: _score, ...candidate }) => candidate);
}
