import { describe, expect, it } from "vitest";
import {
  expectedDeposit,
  netOf,
  portionStatus,
  pruneReceipts,
  receiptId,
  removeReceipt,
  resolveMonthIncome,
  upsertReceipt,
  upsertReceiptGroup,
  unlinkTransaction,
  windowDaysFor,
} from "./income";
import type { IncomePortion, IncomeReceipt, Member } from "./types";

const WITHHELD: IncomePortion = {
  id: "base",
  label: "Base salary",
  amount: 640,
  currency: "LKR",
  taxRate: 36,
  taxWithheld: true,
  window: { startDay: 10, endDay: 15 },
  schedule: { frequency: "monthly" },
  budgetTreatment: "ordinary",
};

const SELF_PAID: IncomePortion = {
  ...WITHHELD,
  id: "usd",
  label: "USD salary",
  amount: 1000,
  currency: "USD",
  taxRate: 15,
  taxWithheld: false,
  schedule: { frequency: "monthly" },
  budgetTreatment: "ordinary",
};

const members: Member[] = [{ id: "m1", name: "Mina", color: "#123456", portions: [WITHHELD, SELF_PAID] }];

const BONUS: IncomePortion = {
  ...WITHHELD,
  id: "bonus",
  label: "Annual bonus",
  amount: 1000,
  taxRate: 0,
  window: { startDay: 10, endDay: 15 },
  schedule: { frequency: "one_off", month: "2026-07" },
  budgetTreatment: "protected",
};

describe("income math", () => {
  it("keeps tax-withheld deposits net and sets aside self-paid tax", () => {
    expect(netOf(640, WITHHELD)).toBe(640);
    expect(netOf(1000, SELF_PAID)).toBe(850);
  });

  it("converts expected foreign deposits and flags a missing rate as zero", () => {
    expect(expectedDeposit(SELF_PAID, "LKR", { USD: 305 })).toEqual({ amount: 305000, missingRate: false });
    expect(expectedDeposit(SELF_PAID, "LKR", {})).toEqual({ amount: 0, missingRate: true });
  });
});

describe("income timing", () => {
  it("tracks upcoming, due, and overdue boundaries", () => {
    expect(portionStatus(WITHHELD, null, "2026-07", new Date(2026, 6, 9))).toBe("upcoming");
    expect(portionStatus(WITHHELD, null, "2026-07", new Date(2026, 6, 10))).toBe("due");
    expect(portionStatus(WITHHELD, null, "2026-07", new Date(2026, 6, 15))).toBe("due");
    expect(portionStatus(WITHHELD, null, "2026-07", new Date(2026, 6, 16))).toBe("overdue");
    expect(portionStatus({ ...WITHHELD, window: { startDay: 15, endDay: 10 } }, null, "2026-07", new Date(2026, 6, 12))).toBe("due");
  });

  it("clamps day 31 to the last day of a shorter month", () => {
    const endOfMonth = { ...WITHHELD, window: { startDay: 31, endDay: 31 } };
    expect(portionStatus(endOfMonth, null, "2026-04", new Date(2026, 3, 29))).toBe("upcoming");
    expect(portionStatus(endOfMonth, null, "2026-04", new Date(2026, 3, 30))).toBe("due");
    expect(windowDaysFor(endOfMonth, "2026-04")).toEqual({ startDay: 30, endDay: 30 });
  });

  it("lets a receipt win over any window status", () => {
    const receipt: IncomeReceipt = { id: receiptId("2026-07", "m1", "base"), month: "2026-07", memberId: "m1", portionId: "base", amount: 700 };
    expect(portionStatus(WITHHELD, receipt, "2026-07", new Date(2026, 6, 30))).toBe("received");
  });
});

describe("income resolution and receipts", () => {
  it("includes a one-off only in its month and drops an overdue unconfirmed estimate", () => {
    const bonusMembers: Member[] = [{ ...members[0]!, portions: [BONUS] }];
    expect(resolveMonthIncome(bonusMembers, [], "LKR", {}, "2026-06", new Date(2026, 5, 12)).items).toEqual([]);

    const expected = resolveMonthIncome(bonusMembers, [], "LKR", {}, "2026-07", new Date(2026, 6, 9));
    expect(expected.total).toBe(1000);
    expect(expected.protectedTotal).toBe(1000);
    expect(expected.items[0]).toMatchObject({ status: "upcoming", countsInTotal: true });

    const missed = resolveMonthIncome(bonusMembers, [], "LKR", {}, "2026-07", new Date(2026, 6, 16));
    expect(missed.total).toBe(0);
    expect(missed.items[0]).toMatchObject({ status: "overdue", countsInTotal: false, nativeAmount: 1000 });

    const receipt: IncomeReceipt = {
      id: "bonus-receipt", month: "2026-07", memberId: "m1", portionId: "bonus", amount: 1200,
      label: "Annual bonus", taxRate: 0, taxWithheld: true, budgetTreatment: "protected",
    };
    const received = resolveMonthIncome(bonusMembers, [receipt], "LKR", {}, "2026-07", new Date(2026, 6, 31));
    expect(received.total).toBe(1200);
    expect(received.protectedTotal).toBe(1200);
    expect(received.items[0]?.status).toBe("received");
  });

  it("uses receipt snapshots instead of later source edits", () => {
    const changed = { ...BONUS, label: "Renamed", taxRate: 0, taxWithheld: true, budgetTreatment: "ordinary" as const };
    const receipt: IncomeReceipt = {
      id: "snapshot", month: "2026-07", memberId: "m1", portionId: "bonus", amount: 1000,
      label: "Original bonus", taxRate: 10, taxWithheld: false, budgetTreatment: "protected",
    };
    const resolved = resolveMonthIncome([{ ...members[0]!, portions: [changed] }], [receipt], "LKR", {}, "2026-07", new Date(2026, 6, 20));
    expect(resolved.items[0]?.portion.label).toBe("Original bonus");
    expect(resolved.total).toBe(900);
    expect(resolved.protectedTotal).toBe(900);
  });

  it("uses actual household-currency receipts instead of converted expectations", () => {
    const receipt: IncomeReceipt = { id: receiptId("2026-07", "m1", "usd"), month: "2026-07", memberId: "m1", portionId: "usd", amount: 320000 };
    const result = resolveMonthIncome(members, [receipt], "LKR", { USD: 305 }, "2026-07", new Date(2026, 6, 12));
    expect(result.items.every((item) => item.month === "2026-07")).toBe(true);
    expect(result.items.find((item) => item.portion.id === "usd")?.net).toBe(272000);
    expect(result.total).toBe(272640);
  });

  it("upserts, removes, and prunes receipts deterministically", () => {
    const original: IncomeReceipt = { id: "wrong", month: "2026-07", memberId: "m1", portionId: "base", amount: 600 };
    const inserted = upsertReceipt([], original);
    expect(inserted[0]?.id).toBe("rcpt_2026-07_m1_base");
    expect(upsertReceipt(inserted, { ...original, amount: 700 })[0]?.amount).toBe(700);
    expect(removeReceipt(inserted, "2026-07", "m1", "base")).toEqual([]);
    expect(pruneReceipts(inserted, members)).toEqual(inserted);
    expect(pruneReceipts(inserted, [{ ...members[0]!, portions: [] }])).toEqual([]);
  });

  it("keeps equal portion ids isolated by member", () => {
    const secondMember: Member = { id: "m2", name: "Noah", color: "#654321", portions: [{ ...WITHHELD }] };
    const first = upsertReceipt([], { id: "legacy-a", month: "2026-07", memberId: "m1", portionId: "base", amount: 700 });
    const both = upsertReceipt(first, { id: "legacy-b", month: "2026-07", memberId: "m2", portionId: "base", amount: 800 });
    expect(both).toHaveLength(2);
    expect(resolveMonthIncome([...members, secondMember], both, "LKR", {}, "2026-07", new Date(2026, 6, 12)).total).toBe(1500);
    expect(removeReceipt(both, "2026-07", "m1", "base")).toMatchObject([{ memberId: "m2", amount: 800 }]);
  });

  it("keeps one receipt per linked credit and unlinks deleted evidence without changing income", () => {
    const first: IncomeReceipt = { id: "a", month: "2026-07", memberId: "m1", portionId: "base", amount: 700, transactionId: "credit-1" };
    const second: IncomeReceipt = { id: "b", month: "2026-07", memberId: "m1", portionId: "usd", amount: 320000, transactionId: "credit-1" };
    const reassigned = upsertReceipt(upsertReceipt([], first), second);
    expect(reassigned.find((item) => item.portionId === "base")?.transactionId).toBeUndefined();
    expect(reassigned.find((item) => item.portionId === "usd")?.transactionId).toBe("credit-1");

    const before = resolveMonthIncome(members, reassigned, "LKR", { USD: 305 }, "2026-07", new Date(2026, 6, 12)).total;
    const unlinked = unlinkTransaction(reassigned, "credit-1");
    expect(unlinked.find((item) => item.portionId === "usd")).toMatchObject({ amount: 320000, month: "2026-07" });
    expect(unlinked.find((item) => item.portionId === "usd")?.transactionId).toBeUndefined();
    expect(resolveMonthIncome(members, unlinked, "LKR", { USD: 305 }, "2026-07", new Date(2026, 6, 12)).total).toBe(before);
  });

  it("stores and edits an intentional shared-credit allocation atomically", () => {
    const salary: IncomeReceipt = { id: "salary", month: "2026-07", memberId: "m1", portionId: "base", amount: 700, transactionId: "combined" };
    const bonus: IncomeReceipt = { id: "bonus", month: "2026-07", memberId: "m1", portionId: "bonus", amount: 300, transactionId: "combined" };
    const grouped = upsertReceiptGroup([], [salary, bonus]);
    expect(grouped).toHaveLength(2);
    expect(grouped.every((receipt) => receipt.transactionId === "combined")).toBe(true);

    const edited = upsertReceiptGroup(grouped, [{ ...salary, amount: 1000 }]);
    expect(edited).toHaveLength(1);
    expect(edited[0]).toMatchObject({ portionId: "base", amount: 1000, transactionId: "combined" });
    expect(() => upsertReceiptGroup([
      { ...salary, month: "2026-06" },
    ], [bonus])).toThrow(/already linked/i);
  });

  it("stops future expectations after departure but preserves confirmed receipts", () => {
    const former: Member = {
      ...members[0]!,
      lifecycle: { inactiveFrom: "2026-08-01", inactiveReason: "left", awayPeriods: [] },
    };
    expect(resolveMonthIncome([former], [], "LKR", {}, "2026-08", new Date(2026, 7, 12)).total).toBe(0);
    const receipt: IncomeReceipt = {
      id: "receipt", month: "2026-08", memberId: former.id, portionId: "base", amount: 700,
    };
    expect(resolveMonthIncome([former], [receipt], "LKR", {}, "2026-08", new Date(2026, 7, 12)).total).toBe(700);
  });
});
