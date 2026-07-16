import { describe, expect, it } from "vitest";
import { emptyData } from "../storage/schema";
import {
  closeInvalidEfficiencyPlans,
  computeEfficiencySnapshot,
  confirmEfficiencyOutcome,
  createEfficiencyPlan,
} from "./efficiency";
import type { AppData, SpendBeneficiary, Transaction } from "./types";

const HOUSEHOLD: SpendBeneficiary = { type: "household" };

function transaction(
  id: string,
  date: string,
  description: string,
  amount: number,
  category: Transaction["category"] = "dining",
  beneficiary: SpendBeneficiary = HOUSEHOLD,
  kind: Transaction["kind"] = "expense",
  direction: Transaction["direction"] = "debit",
): Transaction {
  return {
    id,
    date,
    description,
    amount,
    category,
    beneficiary,
    account: "Card",
    note: "",
    source: "imported",
    direction,
    kind,
  };
}

function household(): AppData {
  const data = emptyData();
  data.settings.currency = "LKR";
  data.settings.members = [{
    id: "alex",
    name: "Alex",
    color: "#5b8cff",
    portions: [{
      id: "salary",
      label: "Salary",
      amount: 10_000,
      currency: "LKR",
      taxRate: 0,
      taxWithheld: true,
      window: null,
      schedule: { frequency: "monthly" },
      budgetTreatment: "ordinary",
    }],
  }];
  return data;
}

describe("computeEfficiencySnapshot", () => {
  it("finds beneficiary-aware recurring spend and excludes non-spend movements", () => {
    const data = household();
    for (const month of ["2026-03", "2026-04", "2026-05", "2026-06"]) {
      data.transactions.push(transaction(`house-${month}`, `${month}-10`, "STREAMING", 100));
      data.transactions.push(transaction(`alex-${month}`, `${month}-11`, "STREAMING", 200, "dining", { type: "member", memberId: "alex" }));
      data.transactions.push(transaction(`transfer-${month}`, `${month}-12`, "STREAMING", 5_000, "dining", HOUSEHOLD, "internal_transfer"));
    }
    data.transactions.push(transaction("current", "2026-07-15", "STREAMING", 100));

    const snapshot = computeEfficiencySnapshot(data, "2026-07", new Date(2026, 6, 16));
    const recurring = snapshot.opportunities.filter((item) => item.kind === "recurring_value_check");

    expect(snapshot.readiness).toBe("ready");
    expect(recurring).toHaveLength(2);
    expect(recurring.map((item) => item.currentMonthlyCost).sort((a, b) => a - b)).toEqual([100, 200]);
    expect(recurring.every((item) => item.currentMonthlyCost < 5_000)).toBe(true);
  });

  it("flags a stable recurring cost whose latest completed amount rose at least ten percent", () => {
    const data = household();
    data.transactions = [
      transaction("mar", "2026-03-10", "MEMBERSHIP", 100),
      transaction("apr", "2026-04-10", "MEMBERSHIP", 100),
      transaction("may", "2026-05-10", "MEMBERSHIP", 100),
      transaction("jun", "2026-06-10", "MEMBERSHIP", 120),
      transaction("jul", "2026-07-15", "OTHER", 10, "food"),
    ];

    const opportunity = computeEfficiencySnapshot(data, "2026-07", new Date(2026, 6, 16)).opportunities
      .find((item) => item.kind === "recurring_price_increase");

    expect(opportunity?.baselineMonthlyCost).toBe(100);
    expect(opportunity?.currentMonthlyCost).toBe(120);
    expect(opportunity?.estimatedMonthlySavings).toBe(20);
    expect(opportunity?.estimatedAnnualSavings).toBe(240);
  });

  it("uses a completed-month median and materiality threshold for current projections", () => {
    const data = household();
    data.transactions = [
      transaction("apr", "2026-04-10", "CAFE", 100),
      transaction("may", "2026-05-10", "CAFE", 100),
      transaction("jun", "2026-06-10", "CAFE", 100),
      transaction("jul", "2026-07-15", "CAFE", 200),
    ];

    const opportunity = computeEfficiencySnapshot(data, "2026-07", new Date(2026, 6, 16)).opportunities
      .find((item) => item.kind === "category_above_baseline");

    expect(opportunity?.baselineMonthlyCost).toBe(100);
    expect(opportunity?.currentMonthlyCost).toBeCloseTo(387.5);
    expect(opportunity?.estimatedMonthlySavings).toBeCloseTo(287.5);
    expect(opportunity?.confidence).toBe("medium");
  });

  it("explains stale, unclassified, and insufficient data instead of presenting trends as ready", () => {
    const stale = household();
    stale.transactions = [
      transaction("apr", "2026-04-10", "CAFE", 100),
      transaction("may", "2026-05-10", "CAFE", 100),
      transaction("jun", "2026-06-10", "CAFE", 100),
      transaction("jul", "2026-07-01", "CAFE", 100),
    ];
    expect(computeEfficiencySnapshot(stale, "2026-07", new Date(2026, 6, 16)).readiness).toBe("needs_current_data");

    stale.transactions[3] = transaction("jul", "2026-07-15", "CAFE", 100, "uncategorized", { type: "unassigned" });
    expect(computeEfficiencySnapshot(stale, "2026-07", new Date(2026, 6, 16)).readiness).toBe("needs_classification");

    const short = household();
    short.transactions = [
      transaction("jun", "2026-06-10", "CAFE", 100),
      transaction("jul", "2026-07-15", "CAFE", 100),
    ];
    expect(computeEfficiencySnapshot(short, "2026-07", new Date(2026, 6, 16)).readiness).toBe("building_baseline");
  });

  it("suppresses a keep decision for six months but reopens it after a material increase", () => {
    const data = household();
    for (const month of ["2026-03", "2026-04", "2026-05", "2026-06"]) {
      data.transactions.push(transaction(month, `${month}-10`, "STREAMING", 100));
    }
    data.transactions.push(transaction("jul", "2026-07-15", "STREAMING", 100));
    const first = computeEfficiencySnapshot(data, "2026-07", new Date(2026, 6, 16)).opportunities
      .find((item) => item.kind === "recurring_value_check")!;
    data.efficiencyPlans = [createEfficiencyPlan(first, {
      value: "worthwhile",
      action: "keep",
      effort: "moderate",
      targetMonthlySavings: 0,
    }, "2026-07", "2026-07-16T00:00:00.000Z")];

    expect(computeEfficiencySnapshot(data, "2026-07", new Date(2026, 6, 16)).opportunities
      .some((item) => item.subjectLabel.startsWith("STREAMING"))).toBe(false);

    data.transactions[data.transactions.length - 1] = transaction("jul", "2026-07-15", "STREAMING", 120);
    expect(computeEfficiencySnapshot(data, "2026-07", new Date(2026, 6, 16)).opportunities
      .some((item) => item.subjectLabel.startsWith("STREAMING"))).toBe(true);
  });

  it("measures a due plan while warning when merchant savings shifted within the category", () => {
    const data = household();
    for (const month of ["2026-02", "2026-03", "2026-04"]) {
      data.transactions.push(transaction(month, `${month}-10`, "DELIVERY", 100));
    }
    data.transactions.push(transaction("may", "2026-05-15", "DELIVERY", 100));
    const opportunity = computeEfficiencySnapshot(data, "2026-05", new Date(2026, 4, 16)).opportunities
      .find((item) => item.kind === "recurring_value_check")!;
    const plan = createEfficiencyPlan(opportunity, {
      value: "questionable",
      action: "reduce",
      effort: "easy",
      targetMonthlySavings: 50,
      targetMonth: "2026-06",
    }, "2026-05", "2026-05-16T00:00:00.000Z");
    data.efficiencyPlans = [plan];
    data.transactions.push(
      transaction("jun-delivery", "2026-06-10", "DELIVERY", 50),
      transaction("jun-cafe", "2026-06-11", "CAFE", 50),
      transaction("jul", "2026-07-15", "GROCER", 10, "food"),
    );

    const verification = computeEfficiencySnapshot(data, "2026-07", new Date(2026, 6, 16)).awaitingVerification[0]!;
    expect(verification.observedMonthlyReduction).toBe(50);
    expect(verification.substitutionWarning).toBe(true);

    const confirmed = confirmEfficiencyOutcome(plan, verification, "partial", "2026-07-16T00:00:00.000Z");
    expect(confirmed.state).toBe("verified");
    expect(confirmed.outcome).toMatchObject({
      month: "2026-06",
      observedMonthlyReduction: 50,
      result: "partial",
      dataComplete: true,
      substitutionWarning: true,
    });
  });

  it("closes plans whose member or custom purpose is removed", () => {
    const data = household();
    const subject = { type: "category", category: "custom:travel", beneficiary: { type: "member", memberId: "alex" } } as const;
    data.efficiencyPlans = [{
      id: "plan", fingerprint: "subject", subject, subjectLabel: "Travel · Alex",
      value: "worthwhile", action: "keep", effort: "moderate", state: "watching",
      baseline: { months: ["2026-05", "2026-06"], monthlyAmount: 100, measurementScope: "category" },
      targetMonthlySavings: 0, revisitAfterMonth: "2027-01",
      createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
    }];

    const closed = closeInvalidEfficiencyPlans(data.efficiencyPlans, new Set(), new Set(), "2026-07-16T00:00:00.000Z");
    expect(closed[0]).toMatchObject({ state: "closed", closedReason: "subject_removed", updatedAt: "2026-07-16T00:00:00.000Z" });
  });
});
