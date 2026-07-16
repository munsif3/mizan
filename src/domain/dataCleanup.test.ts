import { describe, expect, it } from "vitest";
import { emptyData } from "../storage/schema";
import { clearTransactionHistory } from "./dataCleanup";

describe("clearTransactionHistory", () => {
  it("clears ledger rows and their evidence links while preserving household setup", () => {
    const data = emptyData();
    data.transactions = [
      {
        id: "txn-1",
        date: "2026-07-01",
        description: "SHOP",
        amount: 100,
        category: "food",
        beneficiary: { type: "household" },
        account: "Everyday Visa",
        accountId: "card-1",
        note: "",
        source: "imported",
        direction: "debit",
        kind: "expense",
      },
    ];
    data.sharedContributions = [
      {
        id: "contribution-1",
        allocations: [{ expenseTransactionId: "txn-1", amount: 100 }],
        transferDebitTransactionId: "transfer-out",
        transferCreditTransactionId: "transfer-in",
        contributorMemberId: "member-1",
        amount: 100,
      },
    ];
    data.accounts = [
      {
        id: "card-1",
        label: "Everyday Visa",
        currency: "LKR",
        owner: "member-1",
        beneficiaryDefault: "owner",
        match: ["1234", "MY BANK"],
      },
    ];
    data.settings.members = [{ id: "member-1", name: "Member", color: "#5b8cff", portions: [] }];
    data.settings.currency = "LKR";
    data.fixedCosts = [{ id: "rent", label: "Rent", amount: 1000, kind: "expense", category: "housing", beneficiary: { type: "household" } }];
    data.merchantRules = { SHOP: { category: "food", beneficiary: { type: "account_default" }, kind: "expense" } };
    data.incomeReceipts = [
      { id: "receipt-1", month: "2026-07", memberId: "member-1", portionId: "salary", amount: 5000, transactionId: "salary-credit" },
      { id: "receipt-bonus", month: "2026-07", memberId: "member-1", portionId: "bonus", amount: 2000, transactionId: "salary-credit" },
      { id: "receipt-2", month: "2026-06", memberId: "member-1", portionId: "salary", amount: 4800 },
    ];
    data.efficiencyPlans = [{
      id: "plan-1", fingerprint: "effsub_food", subject: { type: "category", category: "food", beneficiary: { type: "household" } },
      subjectLabel: "Food · Household", value: "worthwhile", action: "keep", effort: "moderate", state: "watching",
      baseline: { months: ["2026-05", "2026-06"], monthlyAmount: 100, measurementScope: "category" },
      targetMonthlySavings: 0, revisitAfterMonth: "2027-01",
      createdAt: "2026-07-14T00:00:00.000Z", updatedAt: "2026-07-14T00:00:00.000Z",
    }];

    const cleared = clearTransactionHistory(data);

    expect(cleared.transactions).toEqual([]);
    expect(cleared.sharedContributions).toEqual([]);
    expect(cleared.incomeReceipts).toEqual([
      { id: "receipt-1", month: "2026-07", memberId: "member-1", portionId: "salary", amount: 5000 },
      { id: "receipt-bonus", month: "2026-07", memberId: "member-1", portionId: "bonus", amount: 2000 },
      data.incomeReceipts[2],
    ]);
    expect(cleared.accounts).toBe(data.accounts);
    expect(cleared.settings).toBe(data.settings);
    expect(cleared.fixedCosts).toBe(data.fixedCosts);
    expect(cleared.merchantRules).toBe(data.merchantRules);
    expect(cleared.efficiencyPlans).toBe(data.efficiencyPlans);
    expect(data.transactions).toHaveLength(1);
    expect(data.sharedContributions).toHaveLength(1);
    expect(data.incomeReceipts[0]?.transactionId).toBe("salary-credit");
  });
});
