import { describe, expect, it } from "vitest";
import {
  expectedDeposit,
  grossOf,
  netOf,
  portionStatus,
  pruneReceipts,
  receiptId,
  removeReceipt,
  resolveMonthIncome,
  upsertReceipt,
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
};

const SELF_PAID: IncomePortion = {
  ...WITHHELD,
  id: "usd",
  label: "USD salary",
  amount: 1000,
  currency: "USD",
  taxRate: 15,
  taxWithheld: false,
};

const members: Member[] = [{ id: "m1", name: "Mina", color: "#123456", portions: [WITHHELD, SELF_PAID] }];

describe("income math", () => {
  it("keeps tax-withheld deposits net and sets aside self-paid tax", () => {
    expect(netOf(640, WITHHELD)).toBe(640);
    expect(netOf(1000, SELF_PAID)).toBe(850);
  });

  it("derives display gross only when tax was withheld", () => {
    expect(grossOf(WITHHELD)).toBeCloseTo(1000);
    expect(grossOf(SELF_PAID)).toBe(1000);
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
    const receipt: IncomeReceipt = { id: receiptId("2026-07", "base"), month: "2026-07", memberId: "m1", portionId: "base", amount: 700 };
    expect(portionStatus(WITHHELD, receipt, "2026-07", new Date(2026, 6, 30))).toBe("received");
  });
});

describe("income resolution and receipts", () => {
  it("uses actual household-currency receipts instead of converted expectations", () => {
    const receipt: IncomeReceipt = { id: receiptId("2026-07", "usd"), month: "2026-07", memberId: "m1", portionId: "usd", amount: 320000 };
    const result = resolveMonthIncome(members, [receipt], "LKR", { USD: 305 }, "2026-07", new Date(2026, 6, 12));
    expect(result.items.every((item) => item.month === "2026-07")).toBe(true);
    expect(result.items.find((item) => item.portion.id === "usd")?.net).toBe(272000);
    expect(result.total).toBe(272640);
  });

  it("upserts, removes, and prunes receipts deterministically", () => {
    const original: IncomeReceipt = { id: "wrong", month: "2026-07", memberId: "m1", portionId: "base", amount: 600 };
    const inserted = upsertReceipt([], original);
    expect(inserted[0]?.id).toBe("rcpt_2026-07_base");
    expect(upsertReceipt(inserted, { ...original, amount: 700 })[0]?.amount).toBe(700);
    expect(removeReceipt(inserted, "2026-07", "base")).toEqual([]);
    expect(pruneReceipts(inserted, members)).toEqual(inserted);
    expect(pruneReceipts(inserted, [{ ...members[0]!, portions: [] }])).toEqual([]);
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
});
