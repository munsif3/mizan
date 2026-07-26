import { monthOf } from "./dates";
import { ledgerIndexFor } from "./ledgerIndex";
import { isSpendKind } from "./movements";
import type { AssetHolding, FixedCost, Transaction } from "./types";

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim().toUpperCase();
}

function validMonth(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value));
}

function monthIndex(from: string, month: string): number {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [year, monthNumber] = month.split("-").map(Number);
  return (year! - fromYear!) * 12 + monthNumber! - fromMonth!;
}

export function commitmentActive(commitment: FixedCost, month: string): boolean {
  return (!commitment.from || commitment.from <= month) && (!commitment.until || month <= commitment.until);
}

/**
 * Expected installment for a month. A contractual total caps the schedule, and
 * an explicit final month absorbs small rounding differences.
 */
export function commitmentExpectedAmount(commitment: FixedCost, month: string): number {
  if (!commitmentActive(commitment, month)) return 0;
  const regular = Math.max(0, Number(commitment.amount) || 0);
  const total = Math.max(0, Number(commitment.totalAmount) || 0);
  if (!total || !validMonth(commitment.from)) return regular;
  const index = monthIndex(commitment.from, month);
  if (index < 0) return 0;
  const remaining = Math.max(0, total - regular * index);
  if (!remaining) return 0;
  if (commitment.until === month) return remaining;
  return Math.min(regular, remaining);
}

export function commitmentInvestmentAmount(commitment: FixedCost, month: string): number {
  const due = commitmentExpectedAmount(commitment, month);
  if (commitment.kind === "investment_transfer") return due;
  return Math.min(due, Math.max(0, Number(commitment.investmentAmount) || 0));
}

export function commitmentSpendAmount(commitment: FixedCost, month: string): number {
  const due = commitmentExpectedAmount(commitment, month);
  if (!isSpendKind(commitment.kind)) return 0;
  return Math.max(0, due - commitmentInvestmentAmount(commitment, month));
}

function transactionMatchesCommitment(transaction: Transaction, commitment: FixedCost): boolean {
  if (transaction.commitmentId === commitment.id) return true;
  if (transaction.direction !== "debit" || !commitmentActive(commitment, monthOf(transaction.date))) return false;
  const patterns = commitment.merchantMatch?.map(normalized).filter(Boolean) ?? [];
  if (!patterns.length || !patterns.some((pattern) => normalized(transaction.description).includes(pattern))) return false;
  const expected = commitmentExpectedAmount(commitment, monthOf(transaction.date));
  const tolerance = Math.max(5, expected * 0.01);
  return Math.abs(transaction.amount - expected) <= tolerance;
}

function clearCommitmentFields(transaction: Transaction): Transaction {
  const next = { ...transaction };
  delete next.commitmentId;
  delete next.holdingId;
  delete next.investmentAmount;
  return next;
}

function applyCommitment(transaction: Transaction, commitment: FixedCost, holdings: AssetHolding[]): Transaction {
  const holdingId = commitment.holdingId && holdings.some((holding) => holding.id === commitment.holdingId)
    ? commitment.holdingId
    : undefined;
  const investmentAmount = commitment.kind === "investment_transfer"
    ? undefined
    : Math.min(transaction.amount, Math.max(0, Number(commitment.investmentAmount) || 0)) || undefined;
  const spend = isSpendKind(commitment.kind);
  const next: Transaction = {
    ...transaction,
    commitmentId: commitment.id,
    kind: commitment.kind,
    category: spend ? commitment.category : "uncategorized",
    beneficiary: spend ? commitment.beneficiary : { type: "unassigned" },
    ...(holdingId ? { holdingId } : {}),
    ...(investmentAmount ? { investmentAmount } : {}),
  };
  if (!spend) delete next.beneficiarySource;
  if (!holdingId) delete next.holdingId;
  if (!investmentAmount) delete next.investmentAmount;
  delete next.counterpartyId;
  return next;
}

/**
 * Apply explicit commitment merchant matchers after ordinary merchant rules.
 * Locked one-row overrides win unless the row is already linked to the same
 * commitment.
 */
export function applyCommitments(
  transactions: Transaction[],
  commitments: FixedCost[],
  holdings: AssetHolding[],
): Transaction[] {
  return transactions.map((transaction) => {
    const linked = transaction.commitmentId
      ? commitments.find((commitment) => commitment.id === transaction.commitmentId)
      : undefined;
    if (linked) return applyCommitment(transaction, linked, holdings);
    if (transaction.classificationLocked) return transaction;
    const candidates = commitments
      .filter((commitment) => transactionMatchesCommitment(transaction, commitment))
      .sort((a, b) => {
        const aLength = Math.max(0, ...(a.merchantMatch ?? []).map((pattern) => normalized(pattern).length));
        const bLength = Math.max(0, ...(b.merchantMatch ?? []).map((pattern) => normalized(pattern).length));
        return bLength - aLength || a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
      });
    return candidates[0] ? applyCommitment(clearCommitmentFields(transaction), candidates[0], holdings) : transaction;
  });
}

export function commitmentMatchedTransactions(
  transactions: readonly Transaction[],
  commitment: FixedCost,
  month: string,
): Transaction[] {
  const ledgerIndex = ledgerIndexFor(transactions);
  const hasMerchantMatcher = commitment.merchantMatch?.some((pattern) => Boolean(normalized(pattern))) ?? false;
  const candidates = hasMerchantMatcher
    ? ledgerIndex.forMonth(month)
    : ledgerIndex.forCommitment(commitment.id);
  return candidates
    .filter((transaction) => monthOf(transaction.date) === month && transactionMatchesCommitment(transaction, commitment))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export function commitmentPaidAmount(transactions: readonly Transaction[], commitment: FixedCost): number {
  return transactions
    .filter((transaction) => transactionMatchesCommitment(transaction, commitment))
    .reduce((sum, transaction) => sum + Math.max(0, Number(transaction.amount) || 0), 0);
}
