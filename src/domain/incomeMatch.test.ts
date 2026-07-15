import { describe, expect, it } from "vitest";
import { detectIncomeCandidates } from "./incomeMatch";
import type { Account, IncomePortion, IncomeReceipt, Member, Transaction } from "./types";

const BASE: IncomePortion = {
  id: "salary",
  label: "Salary",
  amount: 1000,
  currency: "LKR",
  taxRate: 0,
  taxWithheld: true,
  window: null,
  schedule: { frequency: "monthly" },
  budgetTreatment: "ordinary",
};

const members = (portions: IncomePortion[] = [BASE]): Member[] => [
  { id: "mina", name: "Mina", color: "#123456", portions },
];

const accounts: Account[] = [
  { id: "mina", label: "Mina Savings", owner: "mina", beneficiaryDefault: "review", match: [] },
  { id: "other", label: "Other Savings", owner: "other", beneficiaryDefault: "review", match: [] },
  { id: "joint", label: "Joint Account", owner: "joint", beneficiaryDefault: "review", match: [] },
];

function credit(id: string, amount: number, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id,
    date: "2026-07-12",
    description: "SALARY CREDIT",
    amount,
    category: "uncategorized",
    beneficiary: { type: "unassigned" },
    account: "Mina Savings",
    note: "",
    source: "imported",
    direction: "credit",
    kind: "account_credit",
    ...overrides,
  };
}

function detect(
  portions: IncomePortion[],
  transactions: Transaction[],
  receipts: IncomeReceipt[] = [],
  currency = "LKR",
  fxRates: Record<string, number> = {},
) {
  return detectIncomeCandidates(members(portions), transactions, accounts, receipts, currency, fxRates, "2026-07");
}

describe("detectIncomeCandidates", () => {
  it("matches same-currency credits in tolerance and rejects a 30% variance", () => {
    expect(detect([BASE], [credit("near", 1001)])).toHaveLength(1);
    expect(detect([BASE], [credit("far", 700)])).toEqual([]);
  });

  it("matches the real FX-shaped salary but rejects a much smaller credit", () => {
    const usd = { ...BASE, currency: "USD" };
    expect(detect([usd], [credit("real", 272_199.53)], [], "LKR", { USD: 305 })[0]?.variance).toBeCloseTo(-0.1075, 3);
    expect(detect([usd], [credit("low", 200_000)], [], "LKR", { USD: 305 })).toEqual([]);
  });

  it("matches a USD salary credit in a registered USD account without treating it as LKR", () => {
    const usdPortion = { ...BASE, amount: 2200, currency: "USD" };
    const usdAccounts: Account[] = [
      ...accounts,
      { id: "rfc", label: "Mina RFC", currency: "USD", owner: "mina", beneficiaryDefault: "review", match: ["2250"] },
    ];
    const result = detectIncomeCandidates(
      members([usdPortion]),
      [credit("usd-salary", 2109.8, { account: "Mina RFC", accountId: "rfc" })],
      usdAccounts,
      [],
      "LKR",
      { USD: 332 },
      "2026-07",
    );
    expect(result[0]).toMatchObject({ sourceAmount: 2109.8, sourceCurrency: "USD", fxRate: 332 });
    expect(result[0]?.amount).toBeCloseTo(700453.6, 2);
    expect(result[0]?.variance).toBeCloseTo(-0.041, 3);
  });

  it("recovers a native USD credit when a legacy account was defaulted to LKR", () => {
    const usdPortion = { ...BASE, amount: 2200, currency: "USD" };
    const result = detectIncomeCandidates(
      members([usdPortion]),
      [credit("usd-salary", 2109.8)],
      accounts,
      [],
      "LKR",
      { USD: 332 },
      "2026-07",
    );
    expect(result[0]).toMatchObject({ sourceAmount: 2109.8, sourceCurrency: "USD", fxRate: 332 });
    expect(result[0]?.amount).toBeCloseTo(700453.6, 2);
  });

  it("stays silent for missing FX rates and zero expectations", () => {
    expect(detect([{ ...BASE, currency: "USD" }], [credit("fx", 1000)])).toEqual([]);
    expect(detect([{ ...BASE, amount: 0 }], [credit("zero", 1)])).toEqual([]);
  });

  it("matches one-off income only in its scheduled month", () => {
    const bonus = { ...BASE, id: "bonus", schedule: { frequency: "one_off" as const, month: "2026-07" }, budgetTreatment: "protected" as const };
    expect(detect([bonus], [credit("bonus", 1000)])).toHaveLength(1);
    expect(detectIncomeCandidates(
      members([bonus]),
      [credit("june-bonus", 1000, { date: "2026-06-12" })],
      accounts,
      [],
      "LKR",
      {},
      "2026-06",
    )).toEqual([]);
  });

  it("accepts owned and joint registered accounts, but not other or unknown accounts", () => {
    expect(detect([BASE], [credit("owned", 1000)])).toHaveLength(1);
    expect(detect([BASE], [credit("joint", 1000, { account: "Joint Account" })])).toHaveLength(1);
    expect(detect([BASE], [credit("other", 1000, { account: "Other Savings" })])).toEqual([]);
    expect(detect([BASE], [credit("unknown", 1000, { account: "Unknown" })])).toEqual([]);
  });

  it("uses the clamped window plus five slack days", () => {
    const windowed = { ...BASE, window: { startDay: 10, endDay: 15 } };
    expect(detect([windowed], [credit("day20", 1000, { date: "2026-07-20" })])[0]?.daysOutsideWindow).toBe(5);
    expect(detect([windowed], [credit("day25", 1000, { date: "2026-07-25" })])).toEqual([]);
    const day31 = { ...BASE, window: { startDay: 31, endDay: 31 } };
    expect(detectIncomeCandidates(members([day31]), [credit("apr30", 1000, { date: "2026-04-30" })], accounts, [], "LKR", {}, "2026-04")).toHaveLength(1);
  });

  it("skips credits linked in any month and credits reclassified as transfers", () => {
    const linked: IncomeReceipt = { id: "old", month: "2026-06", memberId: "mina", portionId: "old", amount: 1000, transactionId: "used" };
    expect(detect([BASE], [credit("used", 1000)], [linked])).toEqual([]);
    expect(detect([BASE], [credit("transfer", 1000, { kind: "internal_transfer" })])).toEqual([]);
  });

  it("assigns two crossed credits once each and is input-order deterministic", () => {
    const portions = [{ ...BASE, id: "a", amount: 1000 }, { ...BASE, id: "b", amount: 1100 }];
    const rows = [credit("for-b", 1100), credit("for-a", 1000)];
    const first = detect(portions, rows).map((item) => [item.portionId, item.transaction.id]);
    const shuffled = detect(portions, [...rows].reverse()).map((item) => [item.portionId, item.transaction.id]);
    expect(first).toEqual([["b", "for-b"], ["a", "for-a"]]);
    expect(shuffled).toEqual(first);
    expect(new Set(first.map(([, id]) => id)).size).toBe(2);
  });

  it("maximizes the number of matches before choosing the closest amounts", () => {
    const portions = [{ ...BASE, id: "large", amount: 1000 }, { ...BASE, id: "small", amount: 900 }];
    const result = detectIncomeCandidates(
      members(portions),
      [credit("middle", 950), credit("large-only", 1100)],
      accounts,
      [],
      "LKR",
      {},
      "2026-07",
      { tolerance: 0.15 },
    );
    expect(result.map((item) => [item.portionId, item.transaction.id]).sort()).toEqual([
      ["large", "large-only"],
      ["small", "middle"],
    ]);
  });
});
