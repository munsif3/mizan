import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { computeMonthSummary } from "../domain/summary";
import { isoDateOf, monthOf } from "../domain/dates";
import type { EfficiencySnapshot } from "../domain/efficiency";
import type { AppData, EfficiencyOpportunity } from "../domain/types";
import { emptyData } from "../storage/schema";
import { BalanceConfidenceChip, BalanceView } from "./BalanceView";
import { BooksView } from "./BooksView";

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
        <BooksView
          summary={summary}
          money={() => "Hidden"}
          lastCheckInAt=""
          onOpenSettings={() => {}}
          onOpenImport={() => {}}
          onReviewQueue={() => {}}
          onCompleteCheckIn={() => {}}
          onConfirmIncome={() => {}}
          onOpenTransactions={onOpenTransactions}
          onBack={() => {}}
        />,
      );
    });

    expect(container.textContent).toContain("Where the money went");
    expect(container.textContent).toContain("By purpose");
    expect(container.textContent).toContain('Has no "who" yet');
    expect(container.textContent).toContain("Planned, not yet seen in a statement");
    expect(container.querySelector(".who-purpose-split")?.textContent).toContain("Household Hidden");
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

    const settleUp = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Settle-up");
    await act(async () => settleUp?.click());
    expect(container.textContent).toContain("Who benefited, and who actually paid");
    expect(container.textContent).toContain("Recorded responsibility");
    expect(container.textContent).toContain("Joint or unregistered funding");
    expect(container.textContent).toContain("Planning-only fixed commitments");

    const alexSpending = container.querySelector<HTMLButtonElement>('button[aria-label="View Alex\'s spending"]');
    const alexPayments = container.querySelector<HTMLButtonElement>('button[aria-label="View payments made by Alex"]');
    expect(alexSpending?.textContent).toBe("View spending");
    expect(alexPayments?.textContent).toBe("View payments");

    const fixed = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Fixed");
    await act(async () => fixed?.click());
    expect(container.textContent).toContain("Loan / debt · ends Jan 2028");

    // Privacy formatting is reused by visible and accessible amount labels.
    expect(householdGroceries?.getAttribute("aria-label")).not.toContain("20000");
  });

  it("wires Balance settlement recording and the append-only undo action", async () => {
    const summary = computeMonthSummary(fixture(), "2026-07", new Date(2026, 6, 15));
    const onMarkSettled = vi.fn();
    const onUndoLastSettlement = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <BalanceView
          summary={summary}
          money={(value) => String(value)}
          lastCheckInAt=""
          onOpenSettings={() => {}}
          onOpenImport={() => {}}
          onReviewQueue={() => {}}
          onCompleteCheckIn={() => {}}
          onConfirmIncome={() => {}}
          onMarkSettled={onMarkSettled}
          onUndoLastSettlement={onUndoLastSettlement}
          canUndoLastSettlement
          onOpenBooks={() => {}}
        />,
      );
    });

    const mark = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Mark settled");
    expect(mark).not.toBeUndefined();
    await act(async () => mark?.click());
    expect(onMarkSettled).toHaveBeenCalledWith(summary.transfers[0]);

    const undo = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Undo last settlement");
    expect(undo).not.toBeUndefined();
    await act(async () => undo?.click());
    expect(onUndoLastSettlement).toHaveBeenCalledTimes(1);
  });

  it("dates the forecast for one overdue account instead of withholding it", async () => {
    const data = fixture();
    const today = new Date();
    const todayDate = isoDateOf(today);
    // Well past a monthly statement cycle plus its grace, so genuinely overdue.
    const staleDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 45);
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
      <BalanceView
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
        onOpenBooks={() => {}}
      />,
    ));

    // The measured verdict stays visible and states the stale account boundary.
    expect(container.textContent).toContain("You've saved");
    expect(container.textContent).toContain("Measured, not projected");
    expect(container.textContent).toContain("Update Sam Card");
    const balanceReview = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Review account");
    await act(async () => balanceReview?.click());
    expect(onOpenSettings).toHaveBeenCalledWith({
      tab: "accounts",
      section: "accounts",
      itemId: "sam-card",
    });

    await act(async () => root?.render(
      <BooksView
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
        onBack={() => {}}
      />,
    ));
    const waiting = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Also waiting");
    await act(async () => waiting?.click());

    // Balance owns rank 0; The Books starts with the next ranked action.
    expect(container.textContent).not.toContain("Update Sam Card");
    expect(container.textContent).not.toContain("Bring transactions up to date");
    expect(container.textContent).toContain("new thing");
  });

  it("aggregates stale accounts and keeps forecast blockers ahead of the weekly check-in", async () => {
    const data = fixture();
    const today = new Date();
    const todayDate = isoDateOf(today);
    data.transactions = data.transactions.map((transaction, index) => ({
      ...transaction,
      date: todayDate,
      accountId: index === 1 ? "alex-card" : "sam-card",
    }));
    const summary = computeMonthSummary(data, monthOf(todayDate), today);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const sharedProps = {
      summary,
      accounts: data.accounts,
      members: data.settings.members,
      money: () => "Hidden",
      lastCheckInAt: "",
      onOpenSettings: () => {},
      onOpenImport: () => {},
      onReviewQueue: () => {},
      onCompleteCheckIn: () => {},
      onConfirmIncome: () => {},
    };

    await act(async () => root?.render(
      <BalanceView {...sharedProps} onOpenBooks={() => {}} />,
    ));

    const coverageCards = container.querySelectorAll('[data-action-family="account_coverage"]');
    expect(coverageCards).toHaveLength(1);
    expect(coverageCards[0]?.getAttribute("data-action-count")).toBe("2");
    expect(coverageCards[0]?.textContent).toContain("Update 2 accounts");
    expect(container.textContent).not.toContain("Update Alex Card");
    expect(container.textContent).not.toContain("Update Sam Card");

    await act(async () => root?.render(<BooksView {...sharedProps} onBack={() => {}} />));
    const waiting = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Also waiting");
    await act(async () => waiting?.click());

    expect(container.querySelectorAll('[data-action-family="account_coverage"]')).toHaveLength(0);

    const defaultTasks = [...container.querySelectorAll<HTMLElement>("[data-action-family]")];
    expect(defaultTasks).toHaveLength(3);
    expect(defaultTasks.map((item) => item.dataset.actionFamily)).toEqual([
      "classification",
      "weekly_check_in",
      "settlement",
    ]);
    expect(container.querySelectorAll('.attention-card[data-action-rank="primary"]')).toHaveLength(0);
    expect(container.querySelectorAll('.attention-card[data-action-rank="secondary"]')).toHaveLength(3);
    const actionQueueToggle = container.querySelector<HTMLButtonElement>(".action-queue-toggle");
    expect(actionQueueToggle?.textContent).toBe("Show 1 more");
    await act(async () => actionQueueToggle?.click());
    expect(container.querySelectorAll('.attention-card[data-action-rank="backlog"]')).toHaveLength(1);
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
      <BooksView
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
        onBack={() => {}}
      />,
    ));

    const efficiencyFilter = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Efficiency");
    await act(async () => efficiencyFilter?.click());
    expect(container.textContent).toContain("Efficiency opportunities");
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

  it("hides empty optional sections but keeps an active efficiency plan reachable", async () => {
    const summary = computeMonthSummary(fixture(), "2026-07", new Date(2026, 6, 15));
    const efficiency: EfficiencySnapshot = {
      readiness: "ready",
      readinessReason: "Based on 3 completed months of classified recorded spending.",
      baselineMonths: ["2026-04", "2026-05", "2026-06"],
      targetGap: 0,
      opportunities: [],
      topOpportunities: [],
      awaitingVerification: [],
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const sharedProps = {
      summary,
      money: () => "Hidden",
      lastCheckInAt: "",
      onOpenSettings: () => {},
      onOpenImport: () => {},
      onReviewQueue: () => {},
      onCompleteCheckIn: () => {},
      onConfirmIncome: () => {},
      efficiency,
      onReviewEfficiency: () => {},
      onVerifyEfficiency: () => {},
      onBack: () => {},
    };

    await act(async () => root?.render(<BooksView {...sharedProps} />));
    const efficiencyFilter = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Efficiency");
    await act(async () => efficiencyFilter?.click());

    expect(container.textContent).not.toContain("Efficiency opportunities");
    expect(container.textContent).not.toContain("Assets & investments");

    const assetsFilter = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Assets");
    await act(async () => assetsFilter?.click());
    expect(container.textContent).toContain("No holdings are recorded yet");
    expect(container.textContent).toContain("Add a holding");

    await act(async () => root?.render(<BooksView {...sharedProps} hasActiveEfficiencyPlan />));
    const activeEfficiencyFilter = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Efficiency");
    await act(async () => activeEfficiencyFilter?.click());

    const efficiencyDetails = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Efficiency opportunities"));
    expect(efficiencyDetails).not.toBeUndefined();
    expect(container.textContent).toContain("Active household plan in progress");
    expect(container.textContent).toContain("An active plan is in progress");
  });

  it("opens a named holding action at the focused Assets editor", async () => {
    const data = fixture();
    data.assetHoldings = [{
      id: "rainy-day",
      label: "Rainy day fund",
      type: "cash",
      currency: "USD",
      owner: "joint",
      status: "active",
      valuations: [{ id: "value-1", date: "2026-07-01", amount: 5_000 }],
    }];
    const onOpenSettings = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(
      <BooksView
        summary={computeMonthSummary(data, "2026-07", new Date(2026, 6, 15))}
        money={() => "Hidden"}
        lastCheckInAt=""
        onOpenSettings={onOpenSettings}
        onOpenImport={() => {}}
        onReviewQueue={() => {}}
        onCompleteCheckIn={() => {}}
        onConfirmIncome={() => {}}
        onBack={() => {}}
      />,
    ));

    const assetsFilter = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Assets");
    await act(async () => assetsFilter?.click());
    await act(async () => container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit Rainy day fund holding"]',
    )?.click());
    expect(onOpenSettings).toHaveBeenCalledWith({
      tab: "assets",
      section: "assets",
      itemId: "rainy-day",
    });
  });

  it("hides settlement, member statements, and beneficiary columns for a one-member household", async () => {
    const summary = computeMonthSummary(soloFixture(), "2026-07", new Date(2026, 6, 15));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <BalanceView
          summary={summary}
          money={() => "Hidden"}
          lastCheckInAt=""
          onOpenSettings={() => {}}
          onOpenImport={() => {}}
          onReviewQueue={() => {}}
          onCompleteCheckIn={() => {}}
          onConfirmIncome={() => {}}
          onOpenBooks={() => {}}
        />,
      );
    });

    // Verdict copy drops the shared-household framing and the settle-up card.
    expect(container.textContent).toContain("you promised yourself");
    expect(container.textContent).not.toContain("you promised each other");
    expect(container.querySelector(".balance-settle-card")).toBeNull();

    await act(async () => root?.render(
      <BooksView
        summary={summary}
        money={() => "Hidden"}
        lastCheckInAt=""
        onOpenSettings={() => {}}
        onOpenImport={() => {}}
        onReviewQueue={() => {}}
        onCompleteCheckIn={() => {}}
        onConfirmIncome={() => {}}
        onBack={() => {}}
      />,
    ));

    expect(container.textContent).toContain("Where the money went");
    expect(container.textContent).toContain("By purpose");
    expect(container.textContent).not.toContain("Who spent what");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Settle-up")).toBe(false);
    expect(container.textContent).not.toContain("Member statements");
    expect(container.textContent).not.toContain("Recorded responsibility");
    expect(container.textContent).not.toContain("Joint or unregistered funding");

    // The purpose matrix collapses to purpose x total, with no beneficiary columns.
    const headers = [...container.querySelectorAll('.who-matrix-header [role="columnheader"]')].map((cell) => cell.textContent);
    expect(headers).toEqual(["What for", "Total"]);
  });

  it("keeps the detailed sections behind a reversible Books push", async () => {
    const summary = computeMonthSummary(fixture(), "2026-07", new Date(2026, 6, 15));
    const onOpenBooks = vi.fn();
    const onBack = vi.fn();
    const props = {
      summary,
      money: () => "Hidden",
      lastCheckInAt: "",
      onOpenSettings: () => {},
      onOpenImport: () => {},
      onReviewQueue: () => {},
      onCompleteCheckIn: () => {},
      onConfirmIncome: () => {},
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(<BalanceView {...props} onOpenBooks={onOpenBooks} />));
    expect(container.textContent).toContain("Open the books");
    expect(container.textContent).not.toContain("Efficiency opportunities");
    await act(async () => [...container!.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Open the books")?.click());
    expect(onOpenBooks).toHaveBeenCalledTimes(1);

    await act(async () => root?.render(<BooksView {...props} onBack={onBack} />));
    await act(async () => [...container!.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Balance")?.click());
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("renders an unfilled, entirely hollow bar when the month has no statement activity", async () => {
    const data = fixture();
    data.transactions = [];
    const summary = computeMonthSummary(data, "2026-07", new Date(2026, 6, 15));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(
      <BalanceView
        summary={summary}
        money={(value) => `LKR ${value}`}
        lastCheckInAt=""
        onOpenSettings={() => {}}
        onOpenImport={() => {}}
        onReviewQueue={() => {}}
        onCompleteCheckIn={() => {}}
        onConfirmIncome={() => {}}
        onOpenBooks={() => {}}
      />,
    ));

    expect(container.textContent).toContain("July 2026 hasn't been measured yet.");
    expect(container.querySelector(".accounted-bar.entirely-unmeasured")).not.toBeNull();
    expect(container.querySelector(".accounted-segment.unmeasured.full")).not.toBeNull();
    expect(container.querySelector(".accounted-segment.spent")).toBeNull();
    expect(container.querySelector(".accounted-segment.saved")).toBeNull();
  });

  it("keeps the no-income case focused on one setup action", async () => {
    const data = fixture();
    data.settings.members = data.settings.members.map((member) => ({ ...member, portions: [] }));
    const onOpenSettings = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(
      <BalanceView
        summary={computeMonthSummary(data, "2026-07", new Date(2026, 6, 15))}
        money={(value) => `LKR ${value}`}
        lastCheckInAt=""
        onOpenSettings={onOpenSettings}
        onOpenImport={() => {}}
        onReviewQueue={() => {}}
        onCompleteCheckIn={() => {}}
        onConfirmIncome={() => {}}
        onOpenBooks={() => {}}
      />,
    ));

    expect(container.textContent).toContain("Start with your income");
    expect(container.querySelector(".accounted-card")).toBeNull();
    await act(async () => [...container!.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Add income")?.click());
    expect(onOpenSettings).toHaveBeenCalledWith({ tab: "household", section: "income" });
  });

  it("shows empty, partial, and full measurement confidence states", async () => {
    const tracked = fixture().accounts;
    const rows = tracked.map((account, index) => ({
      account,
      ownerLabel: index === 0 ? "Alex" : "Sam",
      throughDate: index === 0 ? "2026-07-31" : "",
      ageDays: index === 0 ? 0 : null,
      nextExpectedDate: null,
      status: index === 0 ? "current" as const : "missing" as const,
    }));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(
      <BalanceConfidenceChip rows={rows} hasActivity={false} title="Synced" onClick={() => {}} />,
    ));
    expect(container.textContent).toBe("Not yet measured");

    await act(async () => root?.render(
      <BalanceConfidenceChip rows={rows} hasActivity title="Synced" onClick={() => {}} />,
    ));
    expect(container.textContent).toBe("Partly measured · 1 of 2 accounts");
    expect(container.querySelector(".balance-confidence-dot")).not.toBeNull();

    await act(async () => root?.render(
      <BalanceConfidenceChip
        rows={rows.map((row) => ({ ...row, status: "current" as const }))}
        hasActivity
        title="Synced"
        onClick={() => {}}
      />,
    ));
    expect(container.textContent).toBe("Fully measured");
    expect(container.querySelector("button")?.title).toBe("Synced");
  });

  it("masks every new Balance amount in privacy mode", async () => {
    const summary = computeMonthSummary(fixture(), "2026-07", new Date(2026, 6, 15));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(
      <BalanceView
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
        onOpenBooks={() => {}}
      />,
    ));

    expect(container.innerHTML).not.toContain("600000");
    expect(container.querySelectorAll('[aria-label="Financial value hidden"]').length).toBeGreaterThanOrEqual(4);
  });
});
