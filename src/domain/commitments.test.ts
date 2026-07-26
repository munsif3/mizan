import { describe, expect, it } from "vitest";
import { emptyData } from "../storage/schema";
import { applyCommitments, commitmentExpectedAmount } from "./commitments";
import { computeMonthSummary } from "./summary";
import type { AssetHolding, FixedCost, Transaction } from "./types";

const HOLDING: AssetHolding = {
  id: "union-policy",
  label: "Union Assurance annual hold",
  type: "insurance_policy",
  currency: "LKR",
  owner: "unassigned",
  status: "active",
  valuations: [],
};

const POLICY: FixedCost = {
  id: "union",
  label: "Union Assurance policy",
  amount: 92_170,
  kind: "investment_transfer",
  category: "uncategorized",
  beneficiary: { type: "unassigned" },
  from: "2026-02",
  until: "2027-01",
  totalAmount: 1_106_043,
  merchantMatch: ["UNION ASSURANCE LIMITED INST"],
  holdingId: HOLDING.id,
};

function payment(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "payment",
    date: "2026-07-15",
    description: "UNION ASSURANCE LIMITED INST",
    amount: 92_170,
    category: "uncategorized",
    beneficiary: { type: "unassigned" },
    account: "Main account",
    note: "",
    source: "imported",
    direction: "debit",
    kind: "expense",
    ...overrides,
  };
}

describe("recurring investment commitments", () => {
  it("uses the contractual total as a cap and absorbs rounding in the final month", () => {
    expect(commitmentExpectedAmount(POLICY, "2026-01")).toBe(0);
    expect(commitmentExpectedAmount(POLICY, "2026-02")).toBe(92_170);
    expect(commitmentExpectedAmount(POLICY, "2026-12")).toBe(92_170);
    expect(commitmentExpectedAmount(POLICY, "2027-01")).toBe(92_173);
    expect(commitmentExpectedAmount(POLICY, "2027-02")).toBe(0);
  });

  it("reconciles an imported installment to the holding and excludes it from spend", () => {
    const [linked] = applyCommitments([payment()], [POLICY], [HOLDING]);
    expect(linked).toMatchObject({
      commitmentId: POLICY.id,
      holdingId: HOLDING.id,
      kind: "investment_transfer",
      category: "uncategorized",
      beneficiary: { type: "unassigned" },
    });

    const data = emptyData();
    data.assetHoldings = [HOLDING];
    data.fixedCosts = [POLICY];
    data.transactions = [linked!];
    const summary = computeMonthSummary(data, "2026-07", new Date(2026, 6, 20));
    expect(summary.cardSpend).toBe(0);
    expect(summary.fixedSpend).toBe(0);
    expect(summary.totalSpend).toBe(0);
    expect(summary.investmentContributions).toBe(92_170);
    expect(summary.plannedInvestmentContributions).toBe(0);
  });

  it("counts only the evidenced insurance portion as spend for a mixed policy", () => {
    const mixed: FixedCost = {
      ...POLICY,
      kind: "expense",
      category: "health",
      beneficiary: { type: "household" },
      investmentAmount: 80_000,
    };
    const [linked] = applyCommitments([payment()], [mixed], [HOLDING]);
    const data = emptyData();
    data.assetHoldings = [HOLDING];
    data.fixedCosts = [mixed];
    data.transactions = [linked!];
    const summary = computeMonthSummary(data, "2026-07", new Date(2026, 6, 20));
    expect(summary.cardSpend).toBe(12_170);
    expect(summary.fixedSpend).toBe(0);
    expect(summary.investmentContributions).toBe(80_000);
  });
});
