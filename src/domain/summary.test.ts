import { describe, expect, it } from "vitest";
import { emptyData } from "../storage/schema";
import { computeHistory, computeMonthSummary, monthsWithData, netAmount, settleUp } from "./summary";
import type { AppData, Transaction } from "./types";

function fixture(): AppData {
  const data = emptyData();
  data.settings.members = [
    { id: "alex", name: "Alex", color: "#5b8cff", income: 600000 },
    { id: "sam", name: "Sam", color: "#ff80b5", income: 800000 },
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
): Transaction {
  return { id, date, description, amount, category, account, note: "", source: "imported", direction };
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

  it("projects month-end spend by extrapolating variable spend only, fixed costs once", () => {
    const s = computeMonthSummary(fixture(), "2026-07", "all", JULY_15);
    expect(s.dayNumber).toBe(15);
    expect(s.daysInMonth).toBe(31);
    expect(s.projectedSpend).toBeCloseTo(370_000 + (120_000 / 15) * 31);
    expect(s.projectedSaveRate).toBeGreaterThan(s.targetSaveRate);
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
    data.settings.members = data.settings.members.map((m) => ({ ...m, income: 0 }));
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

describe("history", () => {
  it("lists months with data plus the current month, and computes per-month rates", () => {
    const months = monthsWithData(fixture(), new Date(2026, 7, 1));
    expect(months).toEqual(["2026-06", "2026-07", "2026-08"]);
    const rows = computeHistory(fixture(), ["2026-06", "2026-07"]);
    expect(rows[0]!.spend).toBe(80_000 + 370_000);
    expect(rows[1]!.saved).toBe(1_400_000 - 490_000);
  });
});
