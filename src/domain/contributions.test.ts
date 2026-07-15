import { describe, expect, it } from "vitest";
import {
  allocateSharedContribution,
  contributionReferencesTransaction,
  detectSharedContributionCandidates,
  pruneSharedContributions,
  recoveryRowsForContribution,
  sharedContributionError,
  sharedContributionId,
} from "./contributions";
import type { Account, Member, SharedContribution, Transaction } from "./types";

const members: Member[] = [
  { id: "owner", name: "Owner", color: "#5b8cff", portions: [] },
  { id: "contributor", name: "Contributor", color: "#ff80b5", portions: [] },
];
const accounts: Account[] = [
  { id: "mine", label: "Owner Savings", owner: "owner", beneficiaryDefault: "review", match: [] },
  { id: "contributor", label: "Contributor Savings", owner: "contributor", beneficiaryDefault: "review", match: [] },
];

function txn(id: string, date: string, description: string, amount: number, account: string, direction: "debit" | "credit", kind: Transaction["kind"], category: Transaction["category"] = kind === "loan_payment" ? "custom:vehicle-loan" : "uncategorized"): Transaction {
  return {
    id,
    date,
    description,
    amount,
    account,
    category,
    beneficiary: kind === "loan_payment" ? { type: "household" } : { type: "unassigned" },
    note: "",
    source: "imported",
    direction,
    kind,
  };
}

function rows(): Transaction[] {
  return [
    txn("contributor-out", "2026-07-02", "BANK AC FT/DEBIT/200240072113", 130_000, "Contributor Savings", "debit", "expense"),
    txn("owner-in", "2026-07-02", "MEMBER CAR LOAN SHARE", 130_000, "Owner Savings", "credit", "account_credit"),
    txn("loan-early", "2026-07-01", "BANK RECOVERY FOR500240015943", 100_000, "Owner Savings", "debit", "loan_payment"),
    txn("loan-late", "2026-07-03", "BANK RECOVERY FOR500240015943", 160_000, "Owner Savings", "debit", "loan_payment"),
  ];
}

function contribution(amount = 130_000): SharedContribution {
  return {
    id: sharedContributionId(["loan-early", "loan-late"], "contributor-out", "owner-in"),
    allocations: [{ expenseTransactionId: "loan-late", amount }],
    transferDebitTransactionId: "contributor-out",
    transferCreditTransactionId: "owner-in",
    contributorMemberId: "contributor",
    amount,
  };
}

describe("shared contribution evidence", () => {
  it("groups partial recoveries and funds the post-credit row before an earlier deduction", () => {
    const candidates = detectSharedContributionCandidates(rows(), accounts, members, []);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ contributorMemberId: "contributor", amount: 130_000, sameMonth: true, daysApart: 1 });
    expect(candidates[0]?.expenses.map((expense) => expense.id)).toEqual(["loan-early", "loan-late"]);
    expect(candidates[0]?.allocations).toEqual([{ expenseTransactionId: "loan-late", amount: 130_000 }]);
  });

  it("allocates across several rows only when later recovery capacity is insufficient", () => {
    const evidenceDate = "2026-07-02";
    const expenses = rows().filter((item) => item.kind === "loan_payment");
    expect(allocateSharedContribution(200_000, evidenceDate, expenses)).toEqual([
      { expenseTransactionId: "loan-late", amount: 160_000 },
      { expenseTransactionId: "loan-early", amount: 40_000 },
    ]);
  });

  it("accepts an aggregate recovery and rejects malformed allocations, reuse, and overfunding", () => {
    const valid = contribution();
    expect(sharedContributionError(valid, rows(), accounts, members)).toBeNull();
    expect(sharedContributionError({ ...valid, allocations: [{ expenseTransactionId: "loan-late", amount: 129_000 }] }, rows(), accounts, members)).toMatch(/equal the matched contribution/i);
    expect(sharedContributionError({ ...valid, contributorMemberId: "owner" }, rows(), accounts, members)).toMatch(/does not belong/i);

    const mixedLoan = [...rows(), txn("other-loan", "2026-07-03", "BANK RECOVERY FOR999999999999", 100_000, "Owner Savings", "debit", "loan_payment")];
    expect(sharedContributionError({ ...valid, allocations: [{ expenseTransactionId: "loan-late", amount: 100_000 }, { expenseTransactionId: "other-loan", amount: 30_000 }] }, mixedLoan, accounts, members)).toMatch(/same loan recovery/i);

    const reused = { ...valid, id: "other" };
    expect(sharedContributionError(reused, rows(), accounts, members, [valid])).toMatch(/already linked/i);
    const extraRows = [...rows(), txn("member2-out", "2026-07-02", "EXTRA", 40_000, "Contributor Savings", "debit", "internal_transfer"), txn("owner2-in", "2026-07-02", "EXTRA", 40_000, "Owner Savings", "credit", "internal_transfer")];
    const excessive = {
      ...valid,
      id: "extra",
      allocations: [{ expenseTransactionId: "loan-late", amount: 40_000 }],
      transferDebitTransactionId: "member2-out",
      transferCreditTransactionId: "owner2-in",
      amount: 40_000,
    };
    expect(sharedContributionError(excessive, extraRows, accounts, members, [{ ...valid, allocations: [{ expenseTransactionId: "loan-late", amount: 130_000 }] }])).toMatch(/exceed/i);
  });

  it("does not suggest reused evidence and treats every grouped recovery row as linked", () => {
    const valid = contribution();
    const confirmedRows = rows().map((item) => item.id === "contributor-out" || item.id === "owner-in" ? { ...item, kind: "internal_transfer" as const } : item);
    expect(detectSharedContributionCandidates(confirmedRows, accounts, members, [valid])).toEqual([]);
    expect(recoveryRowsForContribution(valid, confirmedRows).map((item) => item.id)).toEqual(["loan-early", "loan-late"]);
    expect(contributionReferencesTransaction(valid, "loan-early", confirmedRows)).toBe(true);
    const malformed = { ...valid, id: "bad", transferCreditTransactionId: "missing" };
    const duplicate = { ...valid, id: "duplicate" };
    expect(pruneSharedContributions([malformed, valid, duplicate], confirmedRows, accounts, members)).toEqual([valid]);
  });

  it("keeps different loan identifiers and categories out of the suggested group", () => {
    const transactions = [
      ...rows(),
      txn("other-id", "2026-07-03", "BANK RECOVERY FOR999999999999", 300_000, "Owner Savings", "debit", "loan_payment"),
      txn("other-category", "2026-07-03", "BANK RECOVERY FOR500240015943", 300_000, "Owner Savings", "debit", "loan_payment", "housing"),
    ];
    const candidateGroups = detectSharedContributionCandidates(transactions, accounts, members, []).map((item) => item.expenses.map((expense) => expense.id));
    expect(candidateGroups).toContainEqual(["loan-early", "loan-late"]);
    expect(candidateGroups).not.toContainEqual(expect.arrayContaining(["other-id", "loan-late"]));
    expect(candidateGroups).not.toContainEqual(expect.arrayContaining(["other-category", "loan-late"]));
  });
});
