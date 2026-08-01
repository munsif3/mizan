import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { computeMonthSummary } from "../domain/summary";
import { emptyData } from "../storage/schema";
import { CatchUpView } from "./CatchUpView";

describe("CatchUpView", () => {
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

  it("orders non-current accounts first and scopes the two account actions", async () => {
    const data = emptyData();
    data.settings.members = [
      { id: "alex", name: "Alex", color: "#14483a", portions: [] },
      { id: "sam", name: "Sam", color: "#7a4d8f", portions: [] },
    ];
    data.accounts = [
      {
        id: "current", label: "Alex card", owner: "alex", beneficiaryDefault: "review", match: [],
        coverage: {
          throughDate: "2026-07-30",
          confirmedAt: "2026-07-29T00:00:00.000Z",
          confirmedByUid: "u1",
          source: "statement",
        },
      },
      {
        id: "behind", label: "Sam card", owner: "sam", beneficiaryDefault: "review", match: [],
        coverage: {
          throughDate: "2026-07-01",
          confirmedAt: "2026-07-02T00:00:00.000Z",
          confirmedByUid: "u1",
          source: "statement",
        },
        cadence: { period: "monthly", dueDay: 3 },
      },
    ];
    data.transactions = [{
      id: "row",
      date: "2026-07-30",
      description: "SHOP",
      amount: 500,
      category: "food",
      beneficiary: { type: "household" },
      account: "Alex card",
      accountId: "current",
      note: "",
      source: "imported",
      direction: "debit",
      kind: "expense",
    }];
    const summary = {
      ...computeMonthSummary(data, "2026-07", new Date(2026, 6, 31)),
      reviewQueueCount: 2,
      transfers: [{ fromId: "sam", toId: "alex", fromName: "Sam", toName: "Alex", amount: 48_600 }],
    };
    const onOpenImport = vi.fn();
    const onConfirmCoverage = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(
      <CatchUpView
        accounts={data.accounts}
        members={data.settings.members}
        transactions={data.transactions}
        summary={summary}
        today={new Date(2026, 6, 31)}
        money={(value) => `LKR ${value.toLocaleString("en")}`}
        onOpenImport={onOpenImport}
        onConfirmCoverage={onConfirmCoverage}
      />,
    ));

    expect([...container.querySelectorAll<HTMLElement>(".catch-up-account-row")].map((row) => row.dataset.accountId))
      .toEqual(["behind", "current"]);
    expect(container.textContent).toContain("When this one lands");
    expect(container.textContent).toContain("don't settle until this is in");
    expect(container.textContent).not.toContain("Forward the bank");

    const addIt = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Add it"))!;
    await act(async () => addIt.click());
    expect(onOpenImport).toHaveBeenCalledWith("behind");

    const nothingNew = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Nothing new"))!;
    await act(async () => nothingNew.click());
    expect(onConfirmCoverage).toHaveBeenCalledWith([
      { accountId: "behind", throughDate: "2026-07-31" },
    ], "manual");
  });
});
