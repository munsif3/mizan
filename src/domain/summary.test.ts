import { describe, expect, it } from "vitest";
import { emptyData } from "../storage/schema";
import { computeHistory, computeMonthSummary, monthsWithData, netAmount, reviewQueue, settleUp } from "./summary";
import { defaultKind, type AppData, type MovementKind, type Transaction } from "./types";

function fixture(): AppData {
  const data = emptyData();
  data.settings.members = [
    { id: "alex", name: "Alex", color: "#5b8cff", portions: [{ id: "por_alex", label: "Monthly income", amount: 600000, currency: "USD", taxRate: 0, taxWithheld: true, window: null }] },
    { id: "sam", name: "Sam", color: "#ff80b5", portions: [{ id: "por_sam", label: "Monthly income", amount: 800000, currency: "USD", taxRate: 0, taxWithheld: true, window: null }] },
  ];
  data.settings.currency = "USD";
  data.settings.locale = "en-US";
  data.accounts = [
    { id: "mv", label: "Alex Visa", owner: "alex", match: [] },
    { id: "sv", label: "Sam Visa", owner: "sam", match: [] },
  ];
  data.fixedCosts = [
    { id: "rent", label: "Rent", amount: 120000, category: "housing" },
    { id: "car", label: "Car loan", amount: 250000, category: "transport", until: "2026-09" },
  ];
  data.transactions = [
    txn("a", "2026-07-02", "KEELLS SUPER", 50000, "food", "Alex Visa"),
    txn("b", "2026-07-10", "SPA CEYLON", 30000, "personal:sam", "Sam Visa"),
    txn("c", "2026-07-15", "SHARED DINNER", 40000, "food", "Alex Visa"),
    txn("d", "2026-06-20", "KEELLS SUPER", 80000, "food", "Alex Visa"),
  ];
  return data;
}

function txn(
  id: string,
  date: string,
  description: string,
  amount: number,
  category: Transaction["category"],
  account: string,
  direction: Transaction["direction"] = "debit",
  kind: MovementKind = defaultKind(direction),
): Transaction {
  return { id, date, description, amount, category, account, note: "", source: "imported", direction, kind };
}

const JULY_15: Date = new Date(2026, 6, 15); // mid-month, 31-day month

describe("computeMonthSummary", () => {
  it("totals card + fixed spend and derives save rate", () => {
    const s = computeMonthSummary(fixture(), "2026-07", "all", JULY_15);
    expect(s.incomeTotal).toBe(1_400_000);
    expect(s.cardSpend).toBe(120_000);
    expect(s.fixedSpend).toBe(370_000);
    expect(s.totalSpend).toBe(490_000);
    expect(s.remaining).toBe(910_000);
    expect(s.saveRate).toBeCloseTo(65, 0);
  });

  it("uses a confirmed receipt for that month only and exposes income items", () => {
    const data = fixture();
    data.incomeReceipts = [{ id: "rcpt_2026-07_por_alex", month: "2026-07", memberId: "alex", portionId: "por_alex", amount: 700000 }];
    const july = computeMonthSummary(data, "2026-07", "all", JULY_15);
    const june = computeMonthSummary(data, "2026-06", "all", JULY_15);
    expect(july.incomeTotal).toBe(1_500_000);
    expect(june.incomeTotal).toBe(1_400_000);
    expect(july.incomeItems).toHaveLength(2);
    expect(july.incomeItems.find((item) => item.portion.id === "por_alex")?.status).toBe("received");
  });

  it("projects month-end spend by extrapolating variable spend only, fixed costs once", () => {
    const s = computeMonthSummary(fixture(), "2026-07", "all", JULY_15);
    expect(s.dayNumber).toBe(15);
    expect(s.daysInMonth).toBe(31);
    expect(s.projectedSpend).toBeCloseTo(370_000 + (120_000 / 15) * 31);
    expect(s.projectedSaveRate).toBeGreaterThan(s.targetSaveRate);
  });

  it("reports current-month data freshness from the latest household transaction", () => {
    const current = computeMonthSummary(fixture(), "2026-07", "all", new Date(2026, 6, 20));
    expect(current.latestTransactionDate).toBe("2026-07-15");
    expect(current.dataAgeDays).toBe(5);

    const past = computeMonthSummary(fixture(), "2026-06", "all", new Date(2026, 6, 20));
    expect(past.latestTransactionDate).toBe("2026-06-20");
    expect(past.dataAgeDays).toBeNull();
  });

  it("keeps the selected month's review count separate from old review debt", () => {
    const data = fixture();
    data.transactions.push(txn("old-review", "2026-06-25", "OLD UNKNOWN", 10_000, "uncategorized", "Alex Visa"));
    const july = computeMonthSummary(data, "2026-07", "all", JULY_15);
    const june = computeMonthSummary(data, "2026-06", "all", JULY_15);
    expect(july.uncategorizedCount).toBe(0);
    expect(june.uncategorizedCount).toBe(1);
  });

  it("counts the review queue across every month, whichever month is selected", () => {
    const data = fixture();
    data.transactions.push(
      txn("jun-review", "2026-06-25", "OLD UNKNOWN", 10_000, "uncategorized", "Alex Visa"),
      txn("jul-review", "2026-07-08", "NEW UNKNOWN", 5_000, "uncategorized", "Alex Visa"),
      // The card payment on the same statement: a credit, so not review debt.
      txn("payment", "2026-07-06", "CREDIT TRANSFER", 70_000, "uncategorized", "Alex Visa", "credit"),
    );
    const july = computeMonthSummary(data, "2026-07", "all", JULY_15);
    const june = computeMonthSummary(data, "2026-06", "all", JULY_15);
    // Same total from either month — it is the size of the queue, not of the month.
    expect(july.reviewQueueCount).toBe(2);
    expect(june.reviewQueueCount).toBe(2);
    // ...and it agrees with the queue the badge sits above.
    expect(reviewQueue(data.transactions).reduce((sum, item) => sum + item.count, 0)).toBe(2);
  });

  it("treats a past month as complete (no projection inflation)", () => {
    const s = computeMonthSummary(fixture(), "2026-06", "all", JULY_15);
    expect(s.isCurrentMonth).toBe(false);
    expect(s.projectedSpend).toBe(s.totalSpend);
  });

  it("respects fixed-cost end months", () => {
    const july = computeMonthSummary(fixture(), "2026-07", "all", JULY_15);
    const october = computeMonthSummary(fixture(), "2026-10", "all", new Date(2026, 9, 10));
    expect(july.monthFixed.map((f) => f.id)).toContain("car");
    expect(october.monthFixed.map((f) => f.id)).not.toContain("car");
    expect(october.fixedSpend).toBe(120_000);
  });

  it("flags fixed costs ending within two months", () => {
    const s = computeMonthSummary(fixture(), "2026-07", "all", JULY_15);
    expect(s.endingSoon.map((f) => f.id)).toEqual(["car"]);
    const may = computeMonthSummary(fixture(), "2026-05", "all", JULY_15);
    expect(may.endingSoon).toEqual([]);
  });

  it("flags an exact category-and-amount match that may double-count a fixed cost", () => {
    const data = fixture();
    data.transactions.push(txn("rent-payment", "2026-07-05", "RENT PAYMENT", 120_000, "housing", "Alex Visa"));
    const s = computeMonthSummary(data, "2026-07", "all", JULY_15);
    expect(s.possibleFixedCostDuplicates.map((fixed) => fixed.id)).toEqual(["rent"]);
  });

  it("settles fairly: only shared spend a member fronts is split, own personal spend is their own cost", () => {
    const s = computeMonthSummary(fixture(), "2026-07", "all", JULY_15);
    const alex = s.memberRows.find((r) => r.member.id === "alex")!;
    const sam = s.memberRows.find((r) => r.member.id === "sam")!;
    // Alex fronted 90k of shared spend; Sam's 30k was her own personal spend on her own card.
    expect(alex.paid).toBe(90_000);
    expect(sam.paid).toBe(30_000);
    expect(sam.personal).toBe(30_000);
    // Shared pool 90k split evenly (45k each): Alex is owed 45k, Sam owes 45k.
    expect(alex.net).toBe(45_000);
    expect(sam.net).toBe(-45_000);
    expect(s.transfers).toEqual([{ fromId: "sam", toId: "alex", fromName: "Sam", toName: "Alex", amount: 45_000 }]);
  });

  it("nets sum to zero and cross-fronted personal spend is owed back directly", () => {
    const data = fixture();
    // Alex fronts Sam's personal spend on Alex's account.
    data.transactions.push(txn("cross", "2026-07-18", "SAM's GIFT", 10_000, "personal:sam", "Alex Visa"));
    const s = computeMonthSummary(data, "2026-07", "all", JULY_15);
    const total = s.memberRows.reduce((sum, row) => sum + row.net, 0);
    expect(total).toBeCloseTo(0, 6);
    // Sam now owes the 45k shared share plus the 10k Alex fronted for her.
    expect(s.transfers).toEqual([{ fromId: "sam", toId: "alex", fromName: "Sam", toName: "Alex", amount: 55_000 }]);
  });

  it("compares against the previous month only when it has data", () => {
    const s = computeMonthSummary(fixture(), "2026-07", "all", JULY_15);
    expect(s.previousMonth).toBe("2026-06");
    const foodRow = s.movementRows.find((row) => row.key === "food");
    expect(foodRow?.previous).toBe(80_000);
    expect(foodRow?.delta).toBe(10_000);

    const june = computeMonthSummary(fixture(), "2026-06", "all", JULY_15);
    expect(june.previousMonth).toBe(""); // May has no transactions
  });

  it("filters transactions by owner via the account registry or a personal category", () => {
    const s = computeMonthSummary(fixture(), "2026-07", "sam", JULY_15);
    expect(s.monthTransactions).toHaveLength(1);
    expect(s.cardSpend).toBe(30_000);
  });

  it("owner tab includes transactions on the person's registered account, not just personal-category ones", () => {
    const data = fixture();
    data.transactions.push(txn("e", "2026-07-20", "SAM COFFEE", 5000, "food", "Sam Visa"));
    const s = computeMonthSummary(data, "2026-07", "sam", JULY_15);
    expect(s.monthTransactions.map((item) => item.id)).toContain("e");
  });

  it("keeps settlement figures the same regardless of the owner tab filter", () => {
    const all = computeMonthSummary(fixture(), "2026-07", "all", JULY_15);
    const sam = computeMonthSummary(fixture(), "2026-07", "sam", JULY_15);
    const alex = computeMonthSummary(fixture(), "2026-07", "alex", JULY_15);
    expect(sam.transfers).toEqual(all.transfers);
    expect(alex.transfers).toEqual(all.transfers);
    expect(sam.memberRows.map((r) => r.net)).toEqual(all.memberRows.map((r) => r.net));
  });

  it("handles zero income without dividing by zero", () => {
    const data = fixture();
    data.settings.members = data.settings.members.map((m) => ({ ...m, portions: [] }));
    const s = computeMonthSummary(data, "2026-07", "all", JULY_15);
    expect(s.saveRate).toBe(0);
    expect(s.projectedSaveRate).toBe(0);
  });

  it("handles a single-member household with no settlement", () => {
    const data = fixture();
    data.settings.members = [data.settings.members[0]!];
    const s = computeMonthSummary(data, "2026-07", "all", JULY_15);
    expect(s.memberRows).toHaveLength(1);
    expect(s.transfers).toEqual([]);
  });

  it("keeps credit transactions visible but out of every spend figure", () => {
    const data = fixture();
    data.transactions.push(txn("credit1", "2026-07-05", "SALARY", 500_000, "uncategorized", "Alex Visa", "credit"));
    const withCredit = computeMonthSummary(data, "2026-07", "all", JULY_15);
    const without = computeMonthSummary(fixture(), "2026-07", "all", JULY_15);
    expect(withCredit.monthTransactions.map((t) => t.id)).toContain("credit1");
    expect(withCredit.cardSpend).toBe(without.cardSpend);
    expect(withCredit.totalSpend).toBe(without.totalSpend);
    expect(withCredit.saveRate).toBe(without.saveRate);
    expect(withCredit.uncategorizedCount).toBe(without.uncategorizedCount);
  });

  it("treats a legacy credit corrupted to expense as zero spend", () => {
    const data = fixture();
    data.transactions.push(txn("bad-credit", "2026-07-05", "REFUND", 99_000, "uncategorized", "Alex Visa", "credit", "expense"));
    const summary = computeMonthSummary(data, "2026-07", "all", JULY_15);
    const baseline = computeMonthSummary(fixture(), "2026-07", "all", JULY_15);
    expect(summary.cardSpend).toBe(baseline.cardSpend);
    expect(summary.fullCategoryRows.find((row) => row.key === "uncategorized")?.value ?? 0).toBe(0);
    expect(summary.reviewQueueCount).toBe(baseline.reviewQueueCount);
  });

  it("counts a linked salary only through its receipt and never as spend", () => {
    const data = fixture();
    data.transactions.push(txn("salary-credit", "2026-07-05", "SALARY", 700_000, "uncategorized", "Alex Visa", "credit", "account_credit"));
    data.incomeReceipts = [{
      id: "rcpt_2026-07_por_alex",
      month: "2026-07",
      memberId: "alex",
      portionId: "por_alex",
      amount: 700_000,
      transactionId: "salary-credit",
    }];
    const summary = computeMonthSummary(data, "2026-07", "all", JULY_15);
    expect(summary.incomeTotal).toBe(1_500_000);
    expect(summary.totalSpend).toBe(computeMonthSummary(fixture(), "2026-07", "all", JULY_15).totalSpend);
  });
});

describe("movement kinds and spend", () => {
  it("excludes an internal transfer pair (debit + credit) from spend", () => {
    const data = fixture();
    const baseline = computeMonthSummary(fixture(), "2026-07", "all", JULY_15).cardSpend;
    // Move 100k from Alex Visa to Sam Visa: both legs marked internal_transfer.
    data.transactions.push(
      txn("out", "2026-07-06", "TRANSFER TO SAM VISA", 100_000, "uncategorized", "Alex Visa", "debit", "internal_transfer"),
      txn("in", "2026-07-06", "TRANSFER FROM ALEX VISA", 100_000, "uncategorized", "Sam Visa", "credit", "internal_transfer"),
    );
    const s = computeMonthSummary(data, "2026-07", "all", JULY_15);
    expect(s.cardSpend).toBe(baseline);
    // Both legs still appear in the ledger.
    expect(s.monthTransactions.map((t) => t.id)).toEqual(expect.arrayContaining(["out", "in"]));
  });

  it("excludes money lent from spend and from member settlement", () => {
    const data = fixture();
    const baseline = computeMonthSummary(fixture(), "2026-07", "all", JULY_15);
    data.transactions.push(
      txn("lent", "2026-07-07", "CASH TO FRIEND", 25_000, "uncategorized", "Alex Visa", "debit", "money_lent"),
    );
    const s = computeMonthSummary(data, "2026-07", "all", JULY_15);
    expect(s.cardSpend).toBe(baseline.cardSpend);
    // Lending is not shared household spend, so settlement is unchanged.
    expect(s.transfers).toEqual(baseline.transfers);
  });

  it("excludes a repayment received from spend (like any credit)", () => {
    const data = fixture();
    const baseline = computeMonthSummary(fixture(), "2026-07", "all", JULY_15).cardSpend;
    data.transactions.push(
      txn("repaid", "2026-07-08", "FRIEND PAID BACK", 25_000, "uncategorized", "Alex Visa", "credit", "repayment_received"),
    );
    const s = computeMonthSummary(data, "2026-07", "all", JULY_15);
    expect(s.cardSpend).toBe(baseline);
  });

  it("counts a gift/handout as spend, unlike money lent", () => {
    const lent = fixture();
    lent.transactions.push(txn("g", "2026-07-09", "HELP OUT COUSIN", 15_000, "family_support", "Alex Visa", "debit", "money_lent"));
    const gift = fixture();
    gift.transactions.push(txn("g", "2026-07-09", "HELP OUT COUSIN", 15_000, "family_support", "Alex Visa", "debit", "gift_or_handout"));
    const lentSpend = computeMonthSummary(lent, "2026-07", "all", JULY_15).cardSpend;
    const giftSpend = computeMonthSummary(gift, "2026-07", "all", JULY_15).cardSpend;
    expect(giftSpend - lentSpend).toBe(15_000);
  });

  it("keeps a reclassified transfer out of the review queue", () => {
    const data = fixture();
    data.transactions.push(
      txn("t", "2026-07-11", "MOVE MONEY", 40_000, "uncategorized", "Alex Visa", "debit", "internal_transfer"),
    );
    const s = computeMonthSummary(data, "2026-07", "all", JULY_15);
    expect(s.uncategorizedCount).toBe(0);
  });
});

describe("settleUp", () => {
  it("produces at most N-1 deterministic transfers that clear all balances", () => {
    const transfers = settleUp([
      { id: "a", name: "A", net: 100 },
      { id: "b", name: "B", net: -60 },
      { id: "c", name: "C", net: -40 },
    ]);
    expect(transfers.length).toBeLessThanOrEqual(2);
    // Both debtors pay the single creditor.
    expect(transfers).toEqual([
      { fromId: "b", toId: "a", fromName: "B", toName: "A", amount: 60 },
      { fromId: "c", toId: "a", fromName: "C", toName: "A", amount: 40 },
    ]);
  });

  it("returns no transfers when everyone is settled", () => {
    expect(settleUp([{ id: "a", name: "A", net: 0 }, { id: "b", name: "B", net: 0 }])).toEqual([]);
  });
});

describe("netAmount / splits", () => {
  it("applies the split share", () => {
    const shared = { ...txn("x", "2026-07-01", "GROUP DINNER", 9000, "food", "Alex Visa"), split: { mine: 1, of: 3 } };
    expect(netAmount(shared)).toBe(3000);
    expect(netAmount(txn("y", "2026-07-01", "SOLO", 500, "food", "Cash"))).toBe(500);
  });
});

describe("shared loan contributions", () => {
  function loanData(total: number): AppData {
    const data = emptyData();
    data.settings.currency = "LKR";
    data.settings.members = [
      { id: "owner", name: "Owner", color: "#5b8cff", portions: [] },
      { id: "contributor", name: "Contributor", color: "#ff80b5", portions: [] },
    ];
    data.settings.customCategories = [{ id: "vehicle-loan", label: "Vehicle loan", color: "#7b8194" }];
    data.accounts = [
      { id: "mine", label: "Owner Savings", owner: "owner", match: [] },
      { id: "contributor", label: "Contributor Savings", owner: "contributor", match: [] },
    ];
    data.transactions = [
      txn("contributor-out", "2026-07-01", "MEMBER CAR LOAN", 125_000, "uncategorized", "Contributor Savings", "debit", "internal_transfer"),
      txn("owner-in", "2026-07-01", "MEMBER CAR LOAN", 125_000, "uncategorized", "Owner Savings", "credit", "internal_transfer"),
      txn("loan", "2026-07-03", "BANK STANDING ORDER", total, "custom:vehicle-loan", "Owner Savings", "debit", "loan_payment"),
    ];
    data.sharedContributions = [{
      id: "contribution",
      allocations: [{ expenseTransactionId: "loan", amount: 125_000 }],
      transferDebitTransactionId: "contributor-out",
      transferCreditTransactionId: "owner-in",
      contributorMemberId: "contributor",
      amount: 125_000,
    }];
    return data;
  }

  it("counts the full loan once and produces no balance when the contribution is exactly half", () => {
    const summary = computeMonthSummary(loanData(250_000), "2026-07", "all", JULY_15);
    expect(summary.cardSpend).toBe(250_000);
    expect(summary.fullCategoryRows.find((row) => row.key === "custom:vehicle-loan")?.value).toBe(250_000);
    expect(summary.fullCategoryRows.find((row) => row.key === "transport")?.value).toBe(0);
    expect(summary.memberRows.map((row) => row.paid)).toEqual([125_000, 125_000]);
    expect(summary.memberRows.map((row) => row.net)).toEqual([0, 0]);
    expect(summary.transfers).toEqual([]);
  });

  it("credits the actual unequal contribution and settles only the shortfall", () => {
    const summary = computeMonthSummary(loanData(260_000), "2026-07", "all", JULY_15);
    expect(summary.memberRows.map((row) => row.paid)).toEqual([135_000, 125_000]);
    expect(summary.memberRows.map((row) => row.net)).toEqual([5_000, -5_000]);
    expect(summary.transfers).toEqual([{ fromId: "contributor", toId: "owner", fromName: "Contributor", toName: "Owner", amount: 5_000 }]);
    expect(summary.memberRows.reduce((sum, row) => sum + row.net, 0)).toBe(0);
  });

  it("applies an adjacent-month transfer to the linked loan month", () => {
    const data = loanData(250_000);
    data.transactions = data.transactions.map((item) => item.id === "contributor-out" || item.id === "owner-in" ? { ...item, date: "2026-06-30" } : item);
    const july = computeMonthSummary(data, "2026-07", "all", JULY_15);
    expect(july.transfers).toEqual([]);
    expect(july.cardSpend).toBe(250_000);
  });

  it("supports several contributors without changing the full shared cost", () => {
    const data = loanData(300_000);
    data.settings.members.push({ id: "alex", name: "Alex", color: "#f2b84b", portions: [] });
    data.accounts.push({ id: "alex", label: "Alex Savings", owner: "alex", match: [] });
    data.transactions.push(
      txn("alex-out", "2026-07-01", "ALEX CAR LOAN", 50_000, "uncategorized", "Alex Savings", "debit", "internal_transfer"),
      txn("alex-in", "2026-07-01", "ALEX CAR LOAN", 50_000, "uncategorized", "Owner Savings", "credit", "internal_transfer"),
    );
    data.sharedContributions.push({
      id: "alex-contribution",
      allocations: [{ expenseTransactionId: "loan", amount: 50_000 }],
      transferDebitTransactionId: "alex-out",
      transferCreditTransactionId: "alex-in",
      contributorMemberId: "alex",
      amount: 50_000,
    });
    data.sharedContributions[0] = { ...data.sharedContributions[0]!, allocations: [{ expenseTransactionId: "loan", amount: 100_000 }], amount: 100_000 };
    data.transactions = data.transactions.map((item) => item.id === "contributor-out" || item.id === "owner-in" ? { ...item, amount: 100_000 } : item);

    const summary = computeMonthSummary(data, "2026-07", "all", JULY_15);
    expect(summary.cardSpend).toBe(300_000);
    expect(summary.memberRows.map((row) => row.paid)).toEqual([150_000, 100_000, 50_000]);
    expect(summary.transfers).toEqual([{ fromId: "alex", toId: "owner", fromName: "Alex", toName: "Owner", amount: 50_000 }]);
  });

  it("attributes one contribution across partial recovery rows without changing total spend", () => {
    const data = loanData(100_000);
    data.transactions = data.transactions.filter((item) => item.id !== "loan");
    data.transactions.push(
      txn("loan-early", "2026-07-01", "BANK RECOVERY FOR500240015943", 100_000, "custom:vehicle-loan", "Owner Savings", "debit", "loan_payment"),
      txn("loan-late", "2026-07-03", "BANK RECOVERY FOR500240015943", 160_000, "custom:vehicle-loan", "Owner Savings", "debit", "loan_payment"),
    );
    data.sharedContributions[0] = {
      ...data.sharedContributions[0]!,
      allocations: [{ expenseTransactionId: "loan-late", amount: 125_000 }],
    };
    const summary = computeMonthSummary(data, "2026-07", "all", JULY_15);
    expect(summary.cardSpend).toBe(260_000);
    expect(summary.memberRows.map((row) => row.paid)).toEqual([135_000, 125_000]);
    expect(summary.transfers).toEqual([{ fromId: "contributor", toId: "owner", fromName: "Contributor", toName: "Owner", amount: 5_000 }]);
  });

  it("keeps each allocation in its recovery row's posting month", () => {
    const data = loanData(100_000);
    data.transactions = data.transactions.filter((item) => item.id !== "loan");
    data.transactions.push(
      txn("june-loan", "2026-06-30", "BANK RECOVERY FOR500240015943", 80_000, "custom:vehicle-loan", "Owner Savings", "debit", "loan_payment"),
      txn("july-loan", "2026-07-01", "BANK RECOVERY FOR500240015943", 170_000, "custom:vehicle-loan", "Owner Savings", "debit", "loan_payment"),
    );
    data.sharedContributions[0] = {
      ...data.sharedContributions[0]!,
      allocations: [
        { expenseTransactionId: "july-loan", amount: 100_000 },
        { expenseTransactionId: "june-loan", amount: 25_000 },
      ],
    };
    const june = computeMonthSummary(data, "2026-06", "all", JULY_15);
    const july = computeMonthSummary(data, "2026-07", "all", JULY_15);
    expect(june.cardSpend).toBe(80_000);
    expect(july.cardSpend).toBe(170_000);
    expect(june.memberRows.map((row) => row.paid)).toEqual([55_000, 25_000]);
    expect(july.memberRows.map((row) => row.paid)).toEqual([70_000, 100_000]);
  });
});

describe("history", () => {
  it("lists months with data plus the current month, and computes per-month rates", () => {
    const months = monthsWithData(fixture(), new Date(2026, 7, 1));
    expect(months).toEqual(["2026-06", "2026-07", "2026-08"]);
    const rows = computeHistory(fixture(), ["2026-06", "2026-07"], JULY_15);
    expect(rows[0]!.spend).toBe(80_000 + 370_000);
    expect(rows[1]!.saved).toBe(1_400_000 - 490_000);
  });

  it("uses receipts only in their recorded history month", () => {
    const data = fixture();
    data.incomeReceipts = [{ id: "rcpt_2026-06_por_sam", month: "2026-06", memberId: "sam", portionId: "por_sam", amount: 900000 }];
    const rows = computeHistory(data, ["2026-06", "2026-07"], JULY_15);
    expect(rows.map((row) => row.income)).toEqual([1_500_000, 1_400_000]);
  });

  it("includes receipt-only months in the available history", () => {
    const data = fixture();
    data.incomeReceipts = [{ id: "rcpt_2026-05_por_alex", month: "2026-05", memberId: "alex", portionId: "por_alex", amount: 600000 }];
    expect(monthsWithData(data, JULY_15)).toContain("2026-05");
  });
});
