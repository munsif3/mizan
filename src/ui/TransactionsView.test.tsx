import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { computeMonthSummary } from "../domain/summary";
import type { AppData, SpendBeneficiary } from "../domain/types";
import { emptyData } from "../storage/schema";
import { TransactionsView, type LedgerFilters } from "./TransactionsView";

function fixture(): AppData {
  const data = emptyData();
  data.settings.currency = "LKR";
  data.settings.members = [
    { id: "alex", name: "Alex", color: "#5b8cff", portions: [] },
    { id: "sam", name: "Sam", color: "#ff80b5", portions: [] },
  ];
  data.accounts = [
    { id: "alex-card", label: "Alex Card", owner: "alex", beneficiaryDefault: "owner", match: [] },
    { id: "joint", label: "Joint Cash", owner: "joint", beneficiaryDefault: "review", match: [] },
  ];
  data.transactions = [
    {
      id: "shared-food",
      date: "2026-07-10",
      description: "KEELLS",
      amount: 20_000,
      category: "food",
      beneficiary: { type: "household" },
      account: "Alex Card",
      accountId: "alex-card",
      note: "",
      source: "imported",
      direction: "debit",
      kind: "expense",
    },
    {
      id: "sam-transport",
      date: "2026-07-11",
      description: "UBER",
      amount: 5_000,
      category: "transport",
      beneficiary: { type: "member", memberId: "sam" },
      classificationLocked: true,
      account: "Alex Card",
      accountId: "alex-card",
      note: "",
      source: "imported",
      direction: "debit",
      kind: "expense",
    },
    {
      id: "unknown",
      date: "2026-07-12",
      description: "UNKNOWN SHOP",
      amount: 2_000,
      category: "uncategorized",
      beneficiary: { type: "unassigned" },
      classificationLocked: true,
      account: "Joint Cash",
      accountId: "joint",
      note: "",
      source: "imported",
      direction: "debit",
      kind: "expense",
    },
    {
      id: "cool-planet",
      date: "2026-07-13",
      description: "COOL PLANET",
      amount: 1_090,
      category: "uncategorized",
      beneficiary: { type: "member", memberId: "alex" },
      beneficiarySource: "account_default",
      account: "Alex Card",
      accountId: "alex-card",
      note: "",
      source: "imported",
      direction: "debit",
      kind: "expense",
    },
  ];
  return data;
}

const noop = () => {};

describe("TransactionsView beneficiary and payer workflow", () => {
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

  function mount(
    initialFilters: LedgerFilters,
    onRememberMerchant = vi.fn(),
    mutateData?: (data: AppData) => void,
    financialValuesHidden = false,
    actions: {
      onOpenImport?: () => void;
      onAddTransaction?: () => void;
      onUnlinkCommitment?: (id: string) => void;
    } = {},
  ) {
    const data = fixture();
    mutateData?.(data);
    const summary = computeMonthSummary(data, "2026-07", new Date(2026, 6, 15));
    function Harness() {
      const [filters, setFilters] = useState(initialFilters);
      return <TransactionsView
        summary={summary}
        members={data.settings.members}
        accounts={data.accounts}
        customCategories={[]}
        counterparties={[]}
        filters={filters}
        onFiltersChange={setFilters}
        money={(value) => `LKR ${value}`}
        transactionMoney={(_txn, value) => `LKR ${value}`}
        financialValuesHidden={financialValuesHidden}
        onSetCategory={noop}
        onSetBeneficiary={(_id: string, _beneficiary: SpendBeneficiary) => {}}
        onSetKind={noop}
        onSetCounterparty={noop}
        onSetAccount={noop}
        onRememberMerchant={onRememberMerchant}
        onResetClassification={noop}
        onUnlinkCommitment={actions.onUnlinkCommitment}
        onSplit={noop}
        onRemove={noop}
        onOpenImport={actions.onOpenImport}
        onAddTransaction={actions.onAddTransaction}
      />;
    }
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    return act(async () => root?.render(<Harness />));
  }

  it("combines purpose, beneficiary, and payer filters and clears them visibly", async () => {
    await mount({ category: "food", beneficiary: "household", payer: "member:alex", merchant: "KEELLS" });
    expect(container?.textContent).toContain("KEELLS");
    expect(container?.textContent).not.toContain("UBER");
    expect(container?.textContent).toContain("For: Household");
    expect(container?.textContent).toContain("Paid from: Alex");
    expect(container?.textContent).toContain("Merchant: KEELLS");

    const clear = [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => button.textContent === "Clear all");
    await act(async () => clear?.click());
    expect(container?.textContent).toContain("UBER");
    expect(container?.textContent).toContain("UNKNOWN SHOP");
  });

  it("shows a filtered empty state without rendering an orphan ledger table", async () => {
    await mount({ category: "housing", beneficiary: "all", payer: "all" });
    expect(container?.textContent).toContain("No transactions match these filters");
    expect(container?.querySelector(".ledger-table")).toBeNull();
    expect(container?.querySelector(".transaction-cards")).toBeNull();

    const clear = [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((item) => item.textContent?.trim() === "Clear filters");
    await act(async () => clear?.click());
    expect(container?.querySelector('button[aria-label="Open details for KEELLS"]')).not.toBeNull();
  });

  it("offers import and add actions for a genuinely empty month", async () => {
    const onOpenImport = vi.fn();
    const onAddTransaction = vi.fn();
    await mount(
      { category: "all", beneficiary: "all", payer: "all" },
      vi.fn(),
      (data) => { data.transactions = []; },
      false,
      { onOpenImport, onAddTransaction },
    );
    expect(container?.textContent).toContain("No activity in Jul 2026");
    expect(container?.querySelector(".ledger-table")).toBeNull();

    const buttons = [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    await act(async () => buttons.find((item) => item.textContent?.trim() === "Import activity")?.click());
    await act(async () => buttons.find((item) => item.textContent?.trim() === "Add transaction")?.click());
    expect(onOpenImport).toHaveBeenCalledOnce();
    expect(onAddTransaction).toHaveBeenCalledOnce();
  });

  it("searches across ledger context and opens editing in a focused drawer", async () => {
    await mount({ category: "all", beneficiary: "all", payer: "all" });
    const search = container?.querySelector<HTMLInputElement>('input[aria-label="Search transactions"]');
    await act(async () => {
      if (!search) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(search, "transport");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container?.textContent).toContain("UBER");
    expect(container?.querySelector('button[aria-label="Open details for KEELLS"]')).toBeNull();

    const open = container?.querySelector<HTMLButtonElement>('button[aria-label="Open details for UBER"]');
    await act(async () => open?.click());
    expect(container?.querySelector('[role="dialog"]')?.textContent).toContain("Classification");
    expect(container?.querySelector('select[aria-label="Account for UBER"]')).not.toBeNull();
  });

  it("offers an explicit unlink action for a matched commitment", async () => {
    const onUnlinkCommitment = vi.fn();
    await mount(
      { category: "all", beneficiary: "all", payer: "all" },
      vi.fn(),
      (data) => {
        data.transactions[0]!.commitmentId = "rent";
      },
      false,
      { onUnlinkCommitment },
    );

    await act(async () =>
      container?.querySelector<HTMLButtonElement>('button[aria-label="Open details for KEELLS"]')?.click());
    const unlink = [...(container?.querySelectorAll("button") ?? [])]
      .find((item) => item.textContent?.includes("Unlink from commitment"));
    expect(unlink).toBeDefined();
    await act(async () => unlink?.click());
    expect(onUnlinkCommitment).toHaveBeenCalledWith("shared-food");
  });

  it("limits results to a date range within the selected month", async () => {
    await mount({ category: "all", beneficiary: "all", payer: "all", dateFrom: "2026-07-12", dateTo: "2026-07-13" });
    expect(container?.querySelector('button[aria-label="Open details for UNKNOWN SHOP"]')).not.toBeNull();
    expect(container?.querySelector('button[aria-label="Open details for COOL PLANET"]')).not.toBeNull();
    expect(container?.querySelector('button[aria-label="Open details for KEELLS"]')).toBeNull();
  });

  it("masks transaction magnitudes and accessible values in privacy mode", async () => {
    await mount({ category: "all", beneficiary: "all", payer: "all" }, vi.fn(), undefined, true);

    expect(container?.innerHTML).not.toContain("LKR 28090");
    expect(container?.innerHTML).not.toContain("LKR 20000");
    expect(container?.textContent).toContain("••••");
    expect(container?.querySelector('[aria-label="Financial value hidden"]')).not.toBeNull();
  });
});
