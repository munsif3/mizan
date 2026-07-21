import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { computeMonthSummary } from "../domain/summary";
import { isoDateOf, monthOf } from "../domain/dates";
import type { EfficiencySnapshot } from "../domain/efficiency";
import type { AppData, EfficiencyOpportunity } from "../domain/types";
import { emptyData } from "../storage/schema";
import { HomeView } from "./HomeView";

function fixture(): AppData {
  const data = emptyData();
  data.settings.currency = "LKR";
  data.settings.locale = "en-LK";
  data.settings.members = [
    {
      id: "alex",
      name: "Alex",
      color: "#5b8cff",
      portions: [{ id: "alex-income", label: "Monthly income", amount: 300_000, currency: "LKR", taxRate: 0, taxWithheld: true, window: null, schedule: { frequency: "monthly" }, budgetTreatment: "ordinary" }],
    },
    {
      id: "sam",
      name: "Sam",
      color: "#ff80b5",
      portions: [{ id: "sam-income", label: "Monthly income", amount: 300_000, currency: "LKR", taxRate: 0, taxWithheld: true, window: null, schedule: { frequency: "monthly" }, budgetTreatment: "ordinary" }],
    },
  ];
  data.accounts = [
    { id: "alex-card", label: "Alex Card", owner: "alex", beneficiaryDefault: "review", match: [] },
    { id: "sam-card", label: "Sam Card", owner: "sam", beneficiaryDefault: "review", match: [] },
  ];
  data.fixedCosts = [
    { id: "rent", label: "Rent", amount: 90_000, kind: "expense", category: "housing", beneficiary: { type: "household" } },
    { id: "car-loan", label: "Car loan", amount: 50_000, kind: "loan_payment", category: "transport", beneficiary: { type: "household" }, until: "2028-01" },
  ];
  data.transactions = [
    {
      id: "groceries",
      date: "2026-07-10",
      description: "KEELLS",
      amount: 20_000,
      category: "food",
      beneficiary: { type: "household" },
      account: "Alex Card",
      note: "",
      source: "imported",
      direction: "debit",
      kind: "expense",
    },
    {
      id: "personal",
      date: "2026-07-11",
      description: "SPA",
      amount: 8_000,
      category: "lifestyle",
      beneficiary: { type: "member", memberId: "sam" },
      account: "Alex Card",
      note: "",
      source: "imported",
      direction: "debit",
      kind: "expense",
    },
    {
      id: "unknown-beneficiary",
      date: "2026-07-12",
      description: "BUS",
      amount: 2_000,
      category: "transport",
      beneficiary: { type: "unassigned" },
      account: "Sam Card",
      note: "",
      source: "manual",
      direction: "debit",
      kind: "expense",
    },
  ];
  return data;
}

function soloFixture(): AppData {
  const data = emptyData();
  data.settings.currency = "LKR";
  data.settings.locale = "en-LK";
  data.settings.members = [{
    id: "kai",
    name: "Kai",
    color: "#5b8cff",
    portions: [{ id: "kai-income", label: "Monthly income", amount: 300_000, currency: "LKR", taxRate: 0, taxWithheld: true, window: null, schedule: { frequency: "monthly" }, budgetTreatment: "ordinary" }],
  }];
  data.accounts = [{ id: "kai-card", label: "Kai Card", owner: "kai", beneficiaryDefault: "owner", match: [] }];
  data.transactions = [{
    id: "groceries",
    date: "2026-07-10",
    description: "KEELLS",
    amount: 20_000,
    category: "food",
    beneficiary: { type: "member", memberId: "kai" },
    account: "Kai Card",
    accountId: "kai-card",
    note: "",
    source: "imported",
    direction: "debit",
    kind: "expense",
  }];
  return data;
}

describe("HomeView spending attribution", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  it("separates purpose, beneficiary, payer, and planning-only commitments", async () => {
    const onOpenTransactions = vi.fn();
    const summary = computeMonthSummary(fixture(), "2026-07", new Date(2026, 6, 15));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <HomeView
          summary={summary}
          money={() => "Hidden"}
          lastCheckInAt=""
          onOpenSettings={() => {}}
          onOpenImport={() => {}}
          onReviewQueue={() => {}}
          onCompleteCheckIn={() => {}}
          onConfirmIncome={() => {}}
          onOpenTransactions={onOpenTransactions}
        />,
      );
    });

    const spendingDetails = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Spending and settlement"));
    await act(async () => spendingDetails?.click());

    expect(container.textContent).toContain("Who spent what");
    expect(container.textContent).toContain("Purpose, responsibility, and who paid");
    expect(container.textContent).toContain("Recorded responsibility");
    expect(container.textContent).toContain("Joint or unregistered funding");
    expect(container.textContent).toContain("Planning-only fixed commitments");
    expect(container.textContent).toContain("Loan / debt · ends Jan 2028");
    expect(container.textContent).not.toContain("Biggest area");
    expect(container.textContent).not.toContain("Monthly categories");

    const householdGroceries = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Groceries, Household: Hidden. Open matching transactions"]',
    );
    expect(householdGroceries).not.toBeNull();
    await act(async () => householdGroceries?.click());
    expect(onOpenTransactions).toHaveBeenCalledWith({ category: "food", beneficiary: "household" });

    const groceriesToggle = [...container.querySelectorAll<HTMLButtonElement>(".purpose-toggle")]
      .find((button) => button.textContent?.includes("Groceries"));
    expect(groceriesToggle?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => groceriesToggle?.click());
    expect(groceriesToggle?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("KEELLS");
    const merchantTotal = container.querySelector<HTMLButtonElement>(
      'button[aria-label="KEELLS, Groceries, Total: Hidden. Open matching transactions"]',
    );
    await act(async () => merchantTotal?.click());
    expect(onOpenTransactions).toHaveBeenLastCalledWith({ category: "food", merchant: "KEELLS" });

    const alexSpending = container.querySelector<HTMLButtonElement>('button[aria-label="View Alex\'s spending"]');
    const alexPayments = container.querySelector<HTMLButtonElement>('button[aria-label="View payments made by Alex"]');
    expect(alexSpending?.textContent).toBe("View spending");
    expect(alexPayments?.textContent).toBe("View payments");

    // Privacy formatting is reused by visible and accessible amount labels.
    expect(householdGroceries?.getAttribute("aria-label")).not.toContain("20000");
  });

  it("pauses the forecast for one stale account and points to account coverage", async () => {
    const data = fixture();
    const today = new Date();
    const todayDate = isoDateOf(today);
    const staleDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 10);
    data.transactions = data.transactions.map((transaction, index) => ({
      ...transaction,
      date: todayDate,
      accountId: index === 2 ? "sam-card" : "alex-card",
    }));
    data.accounts = data.accounts.map((account) => ({
      ...account,
      coverage: {
        throughDate: account.id === "sam-card" ? isoDateOf(staleDay) : todayDate,
        confirmedAt: today.toISOString(),
        confirmedByUid: "user",
        source: "manual" as const,
      },
    }));
    const onOpenSettings = vi.fn();
    const summary = computeMonthSummary(data, monthOf(todayDate), today);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(
      <HomeView
        summary={summary}
        accounts={data.accounts}
        members={data.settings.members}
        money={() => "Hidden"}
        lastCheckInAt=""
        onOpenSettings={onOpenSettings}
        onOpenImport={() => {}}
        onReviewQueue={() => {}}
        onCompleteCheckIn={() => {}}
        onConfirmIncome={() => {}}
      />,
    ));

    expect(container.textContent).toContain("Waiting for account coverage");
    expect(container.textContent).toContain("Update Sam Card");
    expect(container.textContent).not.toContain("Bring transactions up to date");
    const review = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Review account coverage");
    await act(async () => review?.click());
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("shows the top three efficiency opportunities and expands the same-screen backlog", async () => {
    const summary = computeMonthSummary(fixture(), "2026-07", new Date(2026, 6, 15));
    const opportunities: EfficiencyOpportunity[] = Array.from({ length: 4 }, (_, index) => ({
      fingerprint: `opp-${index + 1}`,
      kind: "recurring_value_check",
      subject: { type: "merchant", merchantKey: `MERCHANT ${index + 1}`, category: "dining", beneficiary: { type: "household" } },
      subjectLabel: `Opportunity ${index + 1}`,
      confidence: "high",
      evidenceMonths: ["2026-04", "2026-05", "2026-06"],
      currentMonthlyCost: 100 - index,
      baselineMonthlyCost: 100 - index,
      estimatedMonthlySavings: 0,
      estimatedAnnualSavings: 0,
      saveRatePoints: 0,
      targetGapCoverage: 0,
      score: 100 - index,
      suggestedAction: "keep",
      evidence: ["Stable recurring evidence."],
    }));
    const efficiency: EfficiencySnapshot = {
      readiness: "ready",
      readinessReason: "Based on 3 completed months of classified recorded spending.",
      baselineMonths: ["2026-04", "2026-05", "2026-06"],
      targetGap: 50,
      opportunities,
      topOpportunities: opportunities.slice(0, 3),
      awaitingVerification: [],
    };
    const onReview = vi.fn();
    const onOpenTransactions = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(
      <HomeView
        summary={summary}
        money={(value) => `LKR ${value}`}
        lastCheckInAt=""
        onOpenSettings={() => {}}
        onOpenImport={() => {}}
        onReviewQueue={() => {}}
        onCompleteCheckIn={() => {}}
        onConfirmIncome={() => {}}
        onOpenTransactions={onOpenTransactions}
        efficiency={efficiency}
        onReviewEfficiency={onReview}
        onVerifyEfficiency={() => {}}
      />,
    ));

    expect(container.textContent).toContain("Efficiency opportunities");
    const efficiencyDetails = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Efficiency opportunities"));
    await act(async () => efficiencyDetails?.click());
    expect(container.textContent).toContain("Opportunity 3");
    expect(container.textContent).not.toContain("Opportunity 4");
    const expand = [...container.querySelectorAll("button")].find((item) => item.textContent?.includes("See all 4"));
    await act(async () => expand?.click());
    expect(container.textContent).toContain("Opportunity 4");

    const review = [...container.querySelectorAll("button")].find((item) => item.textContent === "Review opportunity");
    await act(async () => review?.click());
    expect(onReview).toHaveBeenCalledWith(opportunities[0]);
    const evidence = [...container.querySelectorAll("button")].find((item) => item.textContent === "Open evidence");
    await act(async () => evidence?.click());
    expect(onOpenTransactions).toHaveBeenCalledWith({ category: "dining", beneficiary: "household", merchant: "MERCHANT 1" });
  });

  it("hides settlement, member statements, and beneficiary columns for a one-member household", async () => {
    const summary = computeMonthSummary(soloFixture(), "2026-07", new Date(2026, 6, 15));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <HomeView
          summary={summary}
          money={() => "Hidden"}
          lastCheckInAt=""
          onOpenSettings={() => {}}
          onOpenImport={() => {}}
          onReviewQueue={() => {}}
          onCompleteCheckIn={() => {}}
          onConfirmIncome={() => {}}
        />,
      );
    });

    // Hero copy drops the shared-household framing.
    expect(container.textContent).toContain("Your target");
    expect(container.textContent).not.toContain("shared target");

    const spendingDetails = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Spending"));
    await act(async () => spendingDetails?.click());

    expect(container.textContent).toContain("Where the money went");
    expect(container.textContent).toContain("By purpose");
    expect(container.textContent).not.toContain("Who spent what");
    expect(container.textContent).not.toContain("Member statements");
    expect(container.textContent).not.toContain("Recorded responsibility");
    expect(container.textContent).not.toContain("Joint or unregistered funding");

    // The purpose matrix collapses to purpose x total, with no beneficiary columns.
    const headers = [...container.querySelectorAll('.who-matrix-header [role="columnheader"]')].map((cell) => cell.textContent);
    expect(headers).toEqual(["What for", "Total"]);
  });

  it("masks amounts, percentages, chart magnitudes, and accessible values in privacy mode", async () => {
    const summary = computeMonthSummary(fixture(), "2026-07", new Date(2026, 6, 15));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(
      <HomeView
        summary={summary}
        money={() => "••••"}
        percent={() => "••••"}
        financialValuesHidden
        lastCheckInAt=""
        onOpenSettings={() => {}}
        onOpenImport={() => {}}
        onReviewQueue={() => {}}
        onCompleteCheckIn={() => {}}
        onConfirmIncome={() => {}}
      />,
    ));

    expect(container.innerHTML).not.toContain("25%");
    expect(container.querySelector(".comfort-track span")?.getAttribute("style")).toBe("width: 0%;");
    expect(container.querySelector(".comfort-track i")?.getAttribute("style")).toBe("left: 0%;");
    expect(container.querySelector('[aria-label="Financial value hidden"]')).not.toBeNull();
  });
});
