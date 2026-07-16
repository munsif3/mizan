// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EfficiencyOpportunity, EfficiencyPlan } from "../domain/types";
import { EfficiencyOutcomeModal, EfficiencyReviewModal } from "./EfficiencyModal";

const opportunity: EfficiencyOpportunity = {
  fingerprint: "opp",
  kind: "category_above_baseline",
  subject: { type: "category", category: "dining", beneficiary: { type: "household" } },
  subjectLabel: "Dining · Household",
  confidence: "medium",
  evidenceMonths: ["2026-04", "2026-05", "2026-06"],
  currentMonthlyCost: 125,
  baselineMonthlyCost: 100,
  estimatedMonthlySavings: 25,
  estimatedAnnualSavings: 300,
  saveRatePoints: 1,
  targetGapCoverage: 50,
  score: 18.75,
  suggestedAction: "reduce",
  evidence: ["Projected spend is above the completed-month median."],
};

function button(view: HTMLElement, label: string): HTMLButtonElement {
  const match = [...view.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

describe("efficiency decision modals", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("collects life value, action, effort, expected saving, and target month", async () => {
    const onSave = vi.fn();
    await act(async () => root.render(
      <EfficiencyReviewModal
        opportunity={opportunity}
        contextMonth="2026-07"
        todayMonth="2026-07"
        money={(value) => `LKR ${value}`}
        onSave={onSave}
        onClose={() => {}}
      />,
    ));

    await act(async () => container.querySelector<HTMLInputElement>('input[value="questionable"]')!.click());
    await act(async () => container.querySelector<HTMLInputElement>('input[value="replace"]')!.click());
    await act(async () => container.querySelector<HTMLInputElement>('input[value="easy"]')!.click());
    await act(async () => button(container, "Save improvement plan").click());

    expect(onSave).toHaveBeenCalledWith({
      value: "questionable",
      action: "replace",
      effort: "easy",
      targetMonthlySavings: 25,
      targetMonth: "2026-08",
    });
    expect(container.textContent).toContain("never alter ledger spending");
  });

  it("requires completed statement coverage before confirming an outcome", async () => {
    const plan: EfficiencyPlan = {
      id: "plan", fingerprint: "subject", subject: opportunity.subject, subjectLabel: opportunity.subjectLabel,
      value: "questionable", action: "reduce", effort: "easy", state: "planned",
      baseline: { months: opportunity.evidenceMonths, monthlyAmount: 100, measurementScope: "category" },
      targetMonthlySavings: 25, targetMonth: "2026-07",
      createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
    };
    const verification: EfficiencyOpportunity = {
      ...opportunity,
      kind: "verification_due",
      planId: "plan",
      observedMonthlyReduction: 20,
      substitutionWarning: true,
    };
    const onConfirm = vi.fn();
    await act(async () => root.render(
      <EfficiencyOutcomeModal opportunity={verification} plan={plan} money={(value) => `LKR ${value}`} onConfirm={onConfirm} onClose={() => {}} />,
    ));

    expect(button(container, "Confirm outcome").disabled).toBe(true);
    expect(container.textContent).toContain("Spending may have shifted elsewhere");
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => button(container, "Confirm outcome").click());
    expect(onConfirm).toHaveBeenCalledWith("achieved");
  });
});
