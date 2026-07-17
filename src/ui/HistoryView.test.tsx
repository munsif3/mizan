import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { HistoryRow } from "../domain/summary";
import type { EfficiencyPlan } from "../domain/types";
import { HistoryView } from "./HistoryView";

const rows: HistoryRow[] = [
  { month: "2026-06", income: 100_000, protectedIncome: 0, oneOffIncome: 0, spend: 80_000, saved: 20_000, rate: 20 },
  { month: "2026-07", income: 100_000, protectedIncome: 0, oneOffIncome: 0, spend: 90_000, saved: 10_000, rate: 10 },
];

describe("HistoryView selected month", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  async function render(
    currentMonth: string,
    efficiencyPlans: EfficiencyPlan[] = [],
    overrides: Partial<ComponentProps<typeof HistoryView>> = {},
  ) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <HistoryView
          rows={rows}
          currentMonth={currentMonth}
          targetSaveRate={15}
          money={(value) => `LKR ${value}`}
          efficiencyPlans={efficiencyPlans}
          {...overrides}
        />,
      );
    });
  }

  it("shows the selected populated month", async () => {
    await render("2026-06");

    expect(container?.textContent).toContain("Selected month");
    expect(container?.textContent).toContain("Jun 2026 save rate");
    expect(container?.textContent).toContain("20.0%");
  });

  it("does not fall back to the latest row for an empty selectable month", async () => {
    await render("2026-05");

    expect(container?.textContent).toContain("No data");
    expect(container?.textContent).toContain("No recorded data for May 2026.");
    expect(container?.textContent).not.toContain("Jul 2026 save rate");
    expect(container?.textContent).toContain("Average");
    expect(container?.textContent).toContain("15.0%");
  });

  it("labels one-off and protected income in the trend", async () => {
    rows[1] = { ...rows[1]!, income: 150_000, oneOffIncome: 50_000, protectedIncome: 50_000 };
    await render("2026-07");
    expect(container?.textContent).toContain("LKR 50000 one-off");
    expect(container?.textContent).toContain("LKR 50000 protected");
  });

  it("shows verified efficiency outcomes without adding them to ledger savings", async () => {
    const plan: EfficiencyPlan = {
      id: "plan", fingerprint: "subject",
      subject: { type: "category", category: "dining", beneficiary: { type: "household" } },
      subjectLabel: "Dining · Household", value: "questionable", action: "reduce", effort: "easy", state: "verified",
      baseline: { months: ["2026-04", "2026-05"], monthlyAmount: 20_000, measurementScope: "category" },
      targetMonthlySavings: 5_000, targetMonth: "2026-06", revisitAfterMonth: "2026-12",
      createdAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
      outcome: {
        month: "2026-06", observedMonthlyReduction: 4_000, result: "partial",
        confirmedAt: "2026-07-01T00:00:00.000Z", dataComplete: true, substitutionWarning: false,
      },
    };
    await render("2026-06", [plan]);
    expect(container?.textContent).toContain("Dining · Household: LKR 4000 observed reduction · partial");
    expect(container?.textContent).toContain("not added to saved or save-rate figures");
    expect(container?.textContent).toContain("SavedLKR 20000");
  });

  it("selects a month from the accessible chart", async () => {
    const onSelectMonth = vi.fn();
    await render("2026-07", [], { onSelectMonth });

    const june = container?.querySelector<HTMLButtonElement>('button[aria-label^="Jun 2026 save rate"]');
    expect(june?.getAttribute("aria-pressed")).toBe("false");
    await act(async () => june?.click());
    expect(onSelectMonth).toHaveBeenCalledWith("2026-06");
  });

  it("does not expose percentages or chart magnitudes while privacy mode is active", async () => {
    await render("2026-06", [], {
      money: () => "••••",
      percent: () => "••••",
      financialValuesHidden: true,
    });

    expect(container?.textContent).not.toContain("20.0%");
    expect(container?.textContent).not.toContain("15.0%");
    expect(container?.querySelector(".history-target-line")?.getAttribute("style")).toBe("bottom: 0%;");
    expect(container?.querySelector(".history-bar-value")?.getAttribute("style")).toBe("height: 3%;");
    expect(container?.querySelector('button[aria-label*="20.0%"]')).toBeNull();
  });

  it("uses neutral record controls and marks the selected month", async () => {
    const onSelectMonth = vi.fn();
    await render("2026-07", [], { onSelectMonth });

    const disclosure = Array.from(container?.querySelectorAll("button") ?? [])
      .find((button) => button.textContent?.includes("Monthly records"));
    await act(async () => disclosure?.click());

    const july = Array.from(container?.querySelectorAll<HTMLButtonElement>(".history-record-button") ?? [])
      .find((button) => button.textContent?.includes("Jul 2026"));
    expect(july?.classList.contains("button-ghost")).toBe(true);
    expect(july?.classList.contains("button-primary")).toBe(false);
    expect(july?.classList.contains("selected")).toBe(true);
    expect(july?.getAttribute("aria-current")).toBe("date");

    await act(async () => july?.click());
    expect(onSelectMonth).toHaveBeenCalledWith("2026-07");
  });
});
