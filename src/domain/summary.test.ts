import { describe, expect, it } from "vitest";
import { emptyData } from "../storage/schema";
import { applyAccountBeneficiaryDefaults } from "./accounts";
import { applyRules } from "./rules";
import {
  computeHistory,
  computeMonthSummary,
  computeSpendingAttribution,
  monthsWithData,
  netAmount,
  reviewQueue,
  selectableMonths,
  settleUp,
} from "./summary";
import {
  defaultKind,
  type AppData,
  type MovementKind,
  type SpendBeneficiary,
  type Transaction,
} from "./types";

function fixture(): AppData {
  const data = emptyData();
  data.settings.members = [
    { id: "alex", name: "Alex", color: "#5b8cff", portions: [{ id: "por_alex", label: "Monthly income", amount: 600000, currency: "USD", taxRate: 0, taxWithheld: true, window: null }] },
    { id: "sam", name: "Sam", color: "#ff80b5", portions: [{ id: "por_sam", label: "Monthly income", amount: 800000, currency: "USD", taxRate: 0, taxWithheld: true, window: null }] },
  ];
  data.settings.currency = "USD";
  data.settings.locale = "en-US";
  data.accounts = [
    { id: "mv", label: "Alex Visa", owner: "alex", beneficiaryDefault: "review", match: [] },
    { id: "sv", label: "Sam Visa", owner: "sam", beneficiaryDefault: "review", match: [] },
  ];
  data.fixedCosts = [
    { id: "rent", label: "Rent", amount: 120000, category: "housing", beneficiary: { type: "household" } },
    { id: "car", label: "Car loan", amount: 250000, category: "transport", beneficiary: { type: "household" }, until: "2026-09" },
  ];
  data.transactions = [
    txn("a", "2026-07-02", "KEELLS SUPER", 50000, "food", "Alex Visa"),
    txn("b", "2026-07-10", "SPA CEYLON", 30000, "lifestyle", "Sam Visa", "debit", "expense", { type: "member", memberId: "sam" }),
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
  beneficiary: SpendBeneficiary = { type: "household" },
): Transaction {
  return { id, date, description, amount, category, beneficiary, account, note: "", source: "imported", direction, kind };
}

const JULY_15: Date = new Date(2026, 6, 15); // mid-month, 31-day month

describe("computeMonthSummary", () => {
  it("totals card + fixed spend and derives save rate", () => {
    const s = computeMonthSummary(fixture(), "2026-07", JULY_15);
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
    const july = computeMonthSummary(data, "2026-07", JULY_15);
    const june = computeMonthSummary(data, "2026-06", JULY_15);
    expect(july.incomeTotal).toBe(1_500_000);
    expect(june.incomeTotal).toBe(1_400_000);
    expect(july.incomeItems).toHaveLength(2);
    expect(july.incomeItems.find((item) => item.portion.id === "por_alex")?.status).toBe("received");
  });

  it("projects month-end spend by extrapolating variable spend only, fixed costs once", () => {
    const s = computeMonthSummary(fixture(), "2026-07", JULY_15);
    expect(s.dayNumber).toBe(15);
    expect(s.daysInMonth).toBe(31);
    expect(s.projectedSpend).toBeCloseTo(370_000 + (120_000 / 15) * 31);
    expect(s.projectedSaveRate).toBeGreaterThan(s.targetSaveRate);
  });

  it("reports current-month data freshness from the latest household transaction", () => {
    const current = computeMonthSummary(fixture(), "2026-07", new Date(2026, 6, 20));
    expect(current.latestTransactionDate).toBe("2026-07-15");
    expect(current.dataAgeDays).toBe(5);

    const past = computeMonthSummary(fixture(), "2026-06", new Date(2026, 6, 20));
    expect(past.latestTransactionDate).toBe("2026-06-20");
    expect(past.dataAgeDays).toBeNull();
  });

  it("keeps the selected month's review count separate from old review debt", () => {
    const data = fixture();
    data.transactions.push(txn("old-review", "2026-06-25", "OLD UNKNOWN", 10_000, "uncategorized", "Alex Visa"));
    const july = computeMonthSummary(data, "2026-07", JULY_15);
    const june = computeMonthSummary(data, "2026-06", JULY_15);
    expect(july.unresolvedCount).toBe(0);
    expect(june.unresolvedCount).toBe(1);
  });

  it("counts the review queue across every month, whichever month is selected", () => {
    const data = fixture();
    data.transactions.push(
      txn("jun-review", "2026-06-25", "OLD UNKNOWN", 10_000, "uncategorized", "Alex Visa"),
      txn("jul-review", "2026-07-08", "NEW UNKNOWN", 5_000, "uncategorized", "Alex Visa"),
      // The card payment on the same statement: a credit, so not review debt.
      txn("payment", "2026-07-06", "CREDIT TRANSFER", 70_000, "uncategorized", "Alex Visa", "credit"),
    );
    const july = computeMonthSummary(data, "2026-07", JULY_15);
    const june = computeMonthSummary(data, "2026-06", JULY_15);
    // Same total from either month — it is the size of the queue, not of the month.
    expect(july.reviewQueueCount).toBe(2);
    expect(june.reviewQueueCount).toBe(2);
    // ...and it agrees with the queue the badge sits above.
    expect(reviewQueue(data.transactions).reduce((sum, item) => sum + item.count, 0)).toBe(2);
  });

  it("gates purpose and beneficiary ambiguity once per spend row", () => {
    const data = fixture();
    data.transactions.push(
      txn("missing-beneficiary", "2026-07-08", "KNOWN PURPOSE", 5_000, "transport", "Alex Visa", "debit", "expense", { type: "unassigned" }),
      txn("missing-both", "2026-07-09", "UNKNOWN", 7_000, "uncategorized", "Alex Visa", "debit", "expense", { type: "unassigned" }),
      txn("non-spend", "2026-07-10", "TRANSFER", 9_000, "uncategorized", "Alex Visa", "debit", "internal_transfer", { type: "unassigned" }),
    );
    const summary = computeMonthSummary(data, "2026-07", JULY_15);
    expect(summary.unresolvedCount).toBe(2);
    expect(summary.unresolvedCount).toBe(2);
    expect(summary.reviewQueueCount).toBe(2);
    expect(reviewQueue(data.transactions).reduce((sum, item) => sum + item.count, 0)).toBe(2);
  });

  it("prefills any uniform known review axis instead of asking for it again", () => {
    const data = fixture();
    data.transactions.push(
      txn("legacy-personal", "2026-07-08", "CITY RIDE", 5_000, "uncategorized", "Alex Visa", "debit", "expense", { type: "member", memberId: "sam" }),
      txn("missing-person", "2026-07-09", "CITY RIDE", 7_000, "transport", "Alex Visa", "debit", "expense", { type: "unassigned" }),
    );
    expect(reviewQueue(data.transactions).find((item) => item.merchant === "CITY RIDE")).toMatchObject({
      suggestedCategory: "transport",
      suggestedBeneficiary: { type: "member", memberId: "sam" },
      suggestedKind: "expense",
    });
  });

  it("keeps a deterministic account breakdown when one merchant spans accounts", () => {
    const unresolved = (id: string, account: string): Transaction => ({
      ...txn(id, "2026-07-08", "CITY RIDE", 5_000, "uncategorized", account),
      beneficiary: { type: "unassigned" },
    });
    const rows = [
      { ...unresolved("alex-1", "Alex Visa"), accountId: "mv", rawAccount: "DFCC 1111" },
      { ...unresolved("alex-2", "Old Alex label"), accountId: "mv", rawAccount: "DFCC 2222" },
      { ...unresolved("sam", "Sam Visa"), accountId: "sv", rawAccount: "NTB 3333" },
      { ...unresolved("unknown", "NTB 9999"), rawAccount: "NTB 9999" },
    ];

    expect(reviewQueue(rows)[0]?.accountContexts).toEqual([
      { account: "Alex Visa", accountId: "mv", count: 2 },
      { account: "NTB 9999", count: 1 },
      { account: "Sam Visa", accountId: "sv", count: 1 },
    ]);
  });

  it("treats a past month as complete (no projection inflation)", () => {
    const s = computeMonthSummary(fixture(), "2026-06", JULY_15);
    expect(s.isCurrentMonth).toBe(false);
    expect(s.projectedSpend).toBe(s.totalSpend);
  });

  it("respects fixed-cost end months", () => {
    const july = computeMonthSummary(fixture(), "2026-07", JULY_15);
    const october = computeMonthSummary(fixture(), "2026-10", new Date(2026, 9, 10));
    expect(july.monthFixed.map((f) => f.id)).toContain("car");
    expect(october.monthFixed.map((f) => f.id)).not.toContain("car");
    expect(october.fixedSpend).toBe(120_000);
  });

  it("flags fixed costs ending within two months", () => {
    const s = computeMonthSummary(fixture(), "2026-07", JULY_15);
    expect(s.endingSoon.map((f) => f.id)).toEqual(["car"]);
    const may = computeMonthSummary(fixture(), "2026-05", JULY_15);
    expect(may.endingSoon).toEqual([]);
  });

  it("flags an exact category-and-amount match that may double-count a fixed cost", () => {
    const data = fixture();
    data.transactions.push(txn("rent-payment", "2026-07-05", "RENT PAYMENT", 120_000, "housing", "Alex Visa"));
    const s = computeMonthSummary(data, "2026-07", JULY_15);
    expect(s.possibleFixedCostDuplicates.map((fixed) => fixed.id)).toEqual(["rent"]);
  });

  it("does not call a personal purchase a duplicate of a household commitment", () => {
    const data = fixture();
    data.transactions.push(txn(
      "personal-housing",
      "2026-07-05",
      "PERSONAL HOUSING",
      120_000,
      "housing",
      "Alex Visa",
      "debit",
      "expense",
      { type: "member", memberId: "alex" },
    ));
    expect(computeMonthSummary(data, "2026-07", JULY_15).possibleFixedCostDuplicates).toEqual([]);
  });

  it("settles fairly: only shared spend a member fronts is split, own personal spend is their own cost", () => {
    const s = computeMonthSummary(fixture(), "2026-07", JULY_15);
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
    data.transactions.push(txn(
      "cross",
      "2026-07-18",
      "SAM's GIFT",
      10_000,
      "lifestyle",
      "Alex Visa",
      "debit",
      "expense",
      { type: "member", memberId: "sam" },
    ));
    const s = computeMonthSummary(data, "2026-07", JULY_15);
    const total = s.memberRows.reduce((sum, row) => sum + row.net, 0);
    expect(total).toBeCloseTo(0, 6);
    // Sam now owes the 45k shared share plus the 10k Alex fronted for her.
    expect(s.transfers).toEqual([{ fromId: "sam", toId: "alex", fromName: "Sam", toName: "Alex", amount: 55_000 }]);
  });

  it("compares against the previous month only when it has data", () => {
    const s = computeMonthSummary(fixture(), "2026-07", JULY_15);
    expect(s.previousMonth).toBe("2026-06");
    const foodRow = s.movementRows.find((row) => row.key === "food");
    expect(foodRow?.previous).toBe(80_000);
    expect(foodRow?.delta).toBe(10_000);

    const june = computeMonthSummary(fixture(), "2026-06", JULY_15);
    expect(june.previousMonth).toBe(""); // May has no transactions
  });

  it("is household-wide instead of applying the old hybrid owner filter", () => {
    const s = computeMonthSummary(fixture(), "2026-07", JULY_15);
    expect(s.monthTransactions.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(s.cardSpend).toBe(120_000);
  });

  it("handles zero income without dividing by zero", () => {
    const data = fixture();
    data.settings.members = data.settings.members.map((m) => ({ ...m, portions: [] }));
    const s = computeMonthSummary(data, "2026-07", JULY_15);
    expect(s.saveRate).toBe(0);
    expect(s.projectedSaveRate).toBe(0);
  });

  it("handles a single-member household with no settlement", () => {
    const data = fixture();
    data.settings.members = [data.settings.members[0]!];
    const s = computeMonthSummary(data, "2026-07", JULY_15);
    expect(s.memberRows).toHaveLength(1);
    expect(s.transfers).toEqual([]);
  });

  it("keeps credit transactions visible but out of every spend figure", () => {
    const data = fixture();
    data.transactions.push(txn("credit1", "2026-07-05", "SALARY", 500_000, "uncategorized", "Alex Visa", "credit"));
    const withCredit = computeMonthSummary(data, "2026-07", JULY_15);
    const without = computeMonthSummary(fixture(), "2026-07", JULY_15);
    expect(withCredit.monthTransactions.map((t) => t.id)).toContain("credit1");
    expect(withCredit.cardSpend).toBe(without.cardSpend);
    expect(withCredit.totalSpend).toBe(without.totalSpend);
    expect(withCredit.saveRate).toBe(without.saveRate);
    expect(withCredit.unresolvedCount).toBe(without.unresolvedCount);
  });

  it("treats a legacy credit corrupted to expense as zero spend", () => {
    const data = fixture();
    data.transactions.push(txn("bad-credit", "2026-07-05", "REFUND", 99_000, "uncategorized", "Alex Visa", "credit", "expense"));
    const summary = computeMonthSummary(data, "2026-07", JULY_15);
    const baseline = computeMonthSummary(fixture(), "2026-07", JULY_15);
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
    const summary = computeMonthSummary(data, "2026-07", JULY_15);
    expect(summary.incomeTotal).toBe(1_500_000);
    expect(summary.totalSpend).toBe(computeMonthSummary(fixture(), "2026-07", JULY_15).totalSpend);
  });
});

describe("computeSpendingAttribution", () => {
  function attributionFixture(): AppData {
    const data = emptyData();
    data.settings.members = [
      { id: "a", name: "A", color: "#5b8cff", portions: [] },
      { id: "b", name: "B", color: "#ff80b5", portions: [] },
      { id: "c", name: "C", color: "#f2b84b", portions: [] },
    ];
    data.accounts = [
      { id: "a-account", label: "A Card", owner: "a", beneficiaryDefault: "review", match: [] },
      { id: "b-account", label: "B Card", owner: "b", beneficiaryDefault: "review", match: [] },
      { id: "joint", label: "Joint Card", owner: "joint", beneficiaryDefault: "review", match: [] },
    ];
    data.transactions = [
      txn("shared-a", "2026-07-01", "RENT", 120, "housing", "A Card"),
      txn("personal-a", "2026-07-02", "A TRAIN", 30, "transport", "A Card", "debit", "expense", { type: "member", memberId: "a" }),
      txn("cross", "2026-07-03", "B DINNER", 20, "dining", "A Card", "debit", "expense", { type: "member", memberId: "b" }),
      txn("joint", "2026-07-04", "GROCERIES", 60, "food", "Joint Card"),
      txn("unassigned", "2026-07-05", "PHARMACY", 10, "health", "B Card", "debit", "expense", { type: "unassigned" }),
      { ...txn("split", "2026-07-06", "GROUP DINNER", 90, "dining", "B Card"), split: { mine: 1, of: 3 } },
      txn("transfer", "2026-07-07", "MOVE MONEY", 999, "uncategorized", "A Card", "debit", "internal_transfer", { type: "unassigned" }),
    ];
    data.fixedCosts = [
      { id: "rent", label: "Planned rent", amount: 100, category: "housing", beneficiary: { type: "household" } },
      { id: "b-membership", label: "B membership", amount: 15, category: "lifestyle", beneficiary: { type: "member", memberId: "b" } },
      { id: "unknown", label: "Unknown commitment", amount: 5, category: "uncategorized", beneficiary: { type: "unassigned" } },
    ];
    return data;
  }

  it("partitions recorded spend by purpose and beneficiary without losing a cent", () => {
    const attribution = computeSpendingAttribution(attributionFixture(), "2026-07");
    expect(attribution.recordedSpend).toBe(270);
    expect(attribution.householdSpend).toBe(210);
    expect(attribution.unassignedBeneficiarySpend).toBe(10);
    expect(attribution.memberRows.map((row) => row.personalSpend)).toEqual([30, 20, 0]);

    const purposeTotal = attribution.purposeRows.reduce((sum, row) => sum + row.total, 0);
    const personalTotal = attribution.memberRows.reduce((sum, row) => sum + row.personalSpend, 0);
    expect(purposeTotal).toBe(attribution.recordedSpend);
    expect(attribution.householdSpend + personalTotal + attribution.unassignedBeneficiarySpend)
      .toBe(attribution.recordedSpend);

    const dining = attribution.purposeRows.find((row) => row.key === "dining")!;
    expect(dining.household).toBe(30);
    expect(dining.byMember.b).toBe(20);
    expect(dining.total).toBe(50);
    expect(dining.merchants.map((merchant) => [merchant.merchant, merchant.total])).toEqual([
      ["GROUP DINNER", 30],
      ["B DINNER", 20],
    ]);
  });

  it("separates consumption responsibility, funding, and member settlement", () => {
    const attribution = computeSpendingAttribution(attributionFixture(), "2026-07");
    expect(attribution.memberRows.map((row) => ({
      id: row.member.id,
      personal: row.personalSpend,
      shared: row.sharedResponsibility,
      responsibility: row.recordedResponsibility,
      fronted: row.amountFronted,
      sharedFronted: row.sharedFronted,
      crossFronted: row.personalFrontedForOthers,
      net: row.settlementNet,
    }))).toEqual([
      { id: "a", personal: 30, shared: 70, responsibility: 100, fronted: 170, sharedFronted: 120, crossFronted: 20, net: 90 },
      { id: "b", personal: 20, shared: 70, responsibility: 90, fronted: 40, sharedFronted: 30, crossFronted: 0, net: -40 },
      { id: "c", personal: 0, shared: 70, responsibility: 70, fronted: 0, sharedFronted: 0, crossFronted: 0, net: -50 },
    ]);
    expect(attribution.memberFundedSpend).toBe(210);
    expect(attribution.jointOrUnregisteredFunding).toBe(60);
    expect(attribution.memberFundedSpend + attribution.jointOrUnregisteredFunding)
      .toBe(attribution.recordedSpend);
    expect(attribution.memberRows.reduce((sum, row) => sum + row.settlementNet, 0)).toBeCloseTo(0, 8);
    expect(attribution.transfers).toEqual([
      { fromId: "c", toId: "a", fromName: "C", toName: "A", amount: 50 },
      { fromId: "b", toId: "a", fromName: "B", toName: "A", amount: 40 },
    ]);
  });

  it("reports fixed commitments separately from recorded activity and settlement", () => {
    const data = attributionFixture();
    const attribution = computeSpendingAttribution(data, "2026-07");
    expect(attribution.fixedCommitments).toMatchObject({
      total: 120,
      household: 100,
      unassigned: 5,
      byMember: { a: 0, b: 15, c: 0 },
    });
    expect(attribution.fixedCommitments.purposeRows.reduce((sum, row) => sum + row.total, 0)).toBe(120);
    expect(attribution.recordedSpend).toBe(270);

    data.fixedCosts = [];
    const withoutFixed = computeSpendingAttribution(data, "2026-07");
    expect(withoutFixed.recordedSpend).toBe(attribution.recordedSpend);
    expect(withoutFixed.memberRows.map((row) => row.settlementNet))
      .toEqual(attribution.memberRows.map((row) => row.settlementNet));
  });

  it("keeps Sara's clothing personal while sharing Munsif's household groceries", () => {
    const data = emptyData();
    data.settings.members = [
      { id: "sara", name: "Sara", color: "#5b8cff", portions: [] },
      { id: "munsif", name: "Munsif", color: "#ff80b5", portions: [] },
    ];
    data.accounts = [
      { id: "sara-card", label: "Sara Card", owner: "sara", beneficiaryDefault: "owner", match: [] },
      { id: "munsif-card", label: "Munsif Card", owner: "munsif", beneficiaryDefault: "owner", match: [] },
    ];
    data.merchantRules = {
      "COOL PLANET": { category: "lifestyle", beneficiary: { type: "account_default" }, kind: "expense" },
      GROCERIES: { category: "food", beneficiary: { type: "household" }, kind: "expense" },
    };
    data.transactions = [
      {
        ...txn("clothing", "2026-07-10", "COOL PLANET", 1_090, "uncategorized", "Sara Card", "debit", "expense", { type: "unassigned" }),
        accountId: "sara-card",
      },
      {
        ...txn("groceries", "2026-07-11", "GROCERIES", 3_800, "uncategorized", "Munsif Card", "debit", "expense", { type: "unassigned" }),
        accountId: "munsif-card",
      },
    ];
    data.transactions = applyRules(
      applyAccountBeneficiaryDefaults(data.transactions, data.accounts, data.settings.members),
      data.merchantRules,
      data.accounts,
      data.settings.members,
    );

    expect(data.transactions.map((row) => ({
      category: row.category,
      beneficiary: row.beneficiary,
      source: row.beneficiarySource,
    }))).toEqual([
      { category: "lifestyle", beneficiary: { type: "member", memberId: "sara" }, source: "account_default" },
      { category: "food", beneficiary: { type: "household" }, source: undefined },
    ]);

    const attribution = computeSpendingAttribution(data, "2026-07");
    expect(attribution.recordedSpend).toBe(4_890);
    expect(attribution.householdSpend).toBe(3_800);
    expect(attribution.memberRows.map((row) => ({
      id: row.member.id,
      personal: row.personalSpend,
      shared: row.sharedResponsibility,
      responsibility: row.recordedResponsibility,
      fronted: row.amountFronted,
      net: row.settlementNet,
    }))).toEqual([
      { id: "sara", personal: 1_090, shared: 1_900, responsibility: 2_990, fronted: 1_090, net: -1_900 },
      { id: "munsif", personal: 0, shared: 1_900, responsibility: 1_900, fronted: 3_800, net: 1_900 },
    ]);
    expect(attribution.transfers).toEqual([
      { fromId: "sara", toId: "munsif", fromName: "Sara", toName: "Munsif", amount: 1_900 },
    ]);
  });
});

describe("movement kinds and spend", () => {
  it("excludes an internal transfer pair (debit + credit) from spend", () => {
    const data = fixture();
    const baseline = computeMonthSummary(fixture(), "2026-07", JULY_15).cardSpend;
    // Move 100k from Alex Visa to Sam Visa: both legs marked internal_transfer.
    data.transactions.push(
      txn("out", "2026-07-06", "TRANSFER TO SAM VISA", 100_000, "uncategorized", "Alex Visa", "debit", "internal_transfer"),
      txn("in", "2026-07-06", "TRANSFER FROM ALEX VISA", 100_000, "uncategorized", "Sam Visa", "credit", "internal_transfer"),
    );
    const s = computeMonthSummary(data, "2026-07", JULY_15);
    expect(s.cardSpend).toBe(baseline);
    // Both legs still appear in the ledger.
    expect(s.monthTransactions.map((t) => t.id)).toEqual(expect.arrayContaining(["out", "in"]));
  });

  it("excludes money lent from spend and from member settlement", () => {
    const data = fixture();
    const baseline = computeMonthSummary(fixture(), "2026-07", JULY_15);
    data.transactions.push(
      txn("lent", "2026-07-07", "CASH TO FRIEND", 25_000, "uncategorized", "Alex Visa", "debit", "money_lent"),
    );
    const s = computeMonthSummary(data, "2026-07", JULY_15);
    expect(s.cardSpend).toBe(baseline.cardSpend);
    // Lending is not shared household spend, so settlement is unchanged.
    expect(s.transfers).toEqual(baseline.transfers);
  });

  it("excludes a repayment received from spend (like any credit)", () => {
    const data = fixture();
    const baseline = computeMonthSummary(fixture(), "2026-07", JULY_15).cardSpend;
    data.transactions.push(
      txn("repaid", "2026-07-08", "FRIEND PAID BACK", 25_000, "uncategorized", "Alex Visa", "credit", "repayment_received"),
    );
    const s = computeMonthSummary(data, "2026-07", JULY_15);
    expect(s.cardSpend).toBe(baseline);
  });

  it("counts a gift/handout as spend, unlike money lent", () => {
    const lent = fixture();
    lent.transactions.push(txn("g", "2026-07-09", "HELP OUT COUSIN", 15_000, "family_support", "Alex Visa", "debit", "money_lent"));
    const gift = fixture();
    gift.transactions.push(txn("g", "2026-07-09", "HELP OUT COUSIN", 15_000, "family_support", "Alex Visa", "debit", "gift_or_handout"));
    const lentSpend = computeMonthSummary(lent, "2026-07", JULY_15).cardSpend;
    const giftSpend = computeMonthSummary(gift, "2026-07", JULY_15).cardSpend;
    expect(giftSpend - lentSpend).toBe(15_000);
  });

  it("keeps a reclassified transfer out of the review queue", () => {
    const data = fixture();
    data.transactions.push(
      txn("t", "2026-07-11", "MOVE MONEY", 40_000, "uncategorized", "Alex Visa", "debit", "internal_transfer"),
    );
    const s = computeMonthSummary(data, "2026-07", JULY_15);
    expect(s.unresolvedCount).toBe(0);
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
      { id: "mine", label: "Owner Savings", owner: "owner", beneficiaryDefault: "review", match: [] },
      { id: "contributor", label: "Contributor Savings", owner: "contributor", beneficiaryDefault: "review", match: [] },
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
    const summary = computeMonthSummary(loanData(250_000), "2026-07", JULY_15);
    expect(summary.cardSpend).toBe(250_000);
    expect(summary.fullCategoryRows.find((row) => row.key === "custom:vehicle-loan")?.value).toBe(250_000);
    expect(summary.fullCategoryRows.find((row) => row.key === "transport")?.value).toBe(0);
    expect(summary.memberRows.map((row) => row.paid)).toEqual([125_000, 125_000]);
    expect(summary.memberRows.map((row) => row.net)).toEqual([0, 0]);
    expect(summary.transfers).toEqual([]);
  });

  it("credits the actual unequal contribution and settles only the shortfall", () => {
    const summary = computeMonthSummary(loanData(260_000), "2026-07", JULY_15);
    expect(summary.memberRows.map((row) => row.paid)).toEqual([135_000, 125_000]);
    expect(summary.memberRows.map((row) => row.net)).toEqual([5_000, -5_000]);
    expect(summary.transfers).toEqual([{ fromId: "contributor", toId: "owner", fromName: "Contributor", toName: "Owner", amount: 5_000 }]);
    expect(summary.memberRows.reduce((sum, row) => sum + row.net, 0)).toBe(0);
  });

  it("applies an adjacent-month transfer to the linked loan month", () => {
    const data = loanData(250_000);
    data.transactions = data.transactions.map((item) => item.id === "contributor-out" || item.id === "owner-in" ? { ...item, date: "2026-06-30" } : item);
    const july = computeMonthSummary(data, "2026-07", JULY_15);
    expect(july.transfers).toEqual([]);
    expect(july.cardSpend).toBe(250_000);
  });

  it("supports several contributors without changing the full shared cost", () => {
    const data = loanData(300_000);
    data.settings.members.push({ id: "alex", name: "Alex", color: "#f2b84b", portions: [] });
    data.accounts.push({ id: "alex", label: "Alex Savings", owner: "alex", beneficiaryDefault: "review", match: [] });
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

    const summary = computeMonthSummary(data, "2026-07", JULY_15);
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
    const summary = computeMonthSummary(data, "2026-07", JULY_15);
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
    const june = computeMonthSummary(data, "2026-06", JULY_15);
    const july = computeMonthSummary(data, "2026-07", JULY_15);
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

describe("selectableMonths", () => {
  it("builds a continuous 24-month range across year boundaries", () => {
    const months = selectableMonths(emptyData(), new Date(2026, 0, 15));

    expect(months).toHaveLength(24);
    expect(months[0]).toBe("2024-02");
    expect(months.slice(10, 13)).toEqual(["2024-12", "2025-01", "2025-02"]);
    expect(months.at(-1)).toBe("2026-01");
  });

  it("returns the minimum rolling window when there is no recorded data", () => {
    const months = selectableMonths(emptyData(), JULY_15);

    expect(months).toHaveLength(24);
    expect(months[0]).toBe("2024-08");
    expect(months.at(-1)).toBe("2026-07");
  });

  it("extends backward to an older transaction and keeps empty gaps selectable", () => {
    const data = emptyData();
    data.transactions = [txn("old", "2023-01-10", "OLD PURCHASE", 100, "food", "Cash")];

    const months = selectableMonths(data, JULY_15);

    expect(months[0]).toBe("2023-01");
    expect(months.slice(0, 3)).toEqual(["2023-01", "2023-02", "2023-03"]);
    expect(months).toContain("2024-07");
    expect(months.at(-1)).toBe("2026-07");
  });

  it("extends backward to a receipt-only older month", () => {
    const data = emptyData();
    data.incomeReceipts = [{
      id: "old-receipt",
      month: "2022-04",
      memberId: "member",
      portionId: "portion",
      amount: 1_000,
    }];

    const months = selectableMonths(data, JULY_15);

    expect(months[0]).toBe("2022-04");
    expect(months.at(-1)).toBe("2026-07");
  });

  it("ignores future transactions and receipts", () => {
    const data = emptyData();
    data.transactions = [txn("future", "2027-02-10", "FUTURE PURCHASE", 100, "food", "Cash")];
    data.incomeReceipts = [{
      id: "future-receipt",
      month: "2028-03",
      memberId: "member",
      portionId: "portion",
      amount: 1_000,
    }];

    const months = selectableMonths(data, JULY_15);

    expect(months).toHaveLength(24);
    expect(months[0]).toBe("2024-08");
    expect(months.at(-1)).toBe("2026-07");
    expect(months).not.toContain("2027-02");
    expect(months).not.toContain("2028-03");
  });

  it("ignores malformed and year-zero recorded months", () => {
    const data = emptyData();
    data.transactions = [
      txn("zero-year", "0000-01-10", "INVALID PURCHASE", 100, "food", "Cash"),
      txn("malformed", "not-a-date", "INVALID PURCHASE", 100, "food", "Cash"),
    ];
    data.incomeReceipts = [{
      id: "invalid-receipt",
      month: "0000-02",
      memberId: "member",
      portionId: "portion",
      amount: 1_000,
    }];

    const months = selectableMonths(data, JULY_15);

    expect(months).toHaveLength(24);
    expect(months[0]).toBe("2024-08");
    expect(months.at(-1)).toBe("2026-07");
  });
});
