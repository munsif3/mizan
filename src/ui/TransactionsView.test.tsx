import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { computeMonthSummary, reviewQueue } from "../domain/summary";
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
    onCategorizeMerchant = vi.fn(),
    onRememberMerchant = vi.fn(),
  ) {
    const data = fixture();
    const summary = computeMonthSummary(data, "2026-07", new Date(2026, 6, 15));
    function Harness() {
      const [filters, setFilters] = useState(initialFilters);
      return <TransactionsView
        summary={summary}
        members={data.settings.members}
        accounts={data.accounts}
        customCategories={[]}
        counterparties={[]}
        queue={reviewQueue(data.transactions)}
        transferCandidates={[]}
        undoLabel=""
        filters={filters}
        onFiltersChange={setFilters}
        money={(value) => `LKR ${value}`}
        transactionMoney={(_txn, value) => `LKR ${value}`}
        onSetCategory={noop}
        onSetBeneficiary={(_id: string, _beneficiary: SpendBeneficiary) => {}}
        onSetKind={noop}
        onSetCounterparty={noop}
        onSetAccount={noop}
        onCategorizeMerchant={onCategorizeMerchant}
        onRememberMerchant={onRememberMerchant}
        onUndo={noop}
        onResetClassification={noop}
        onConfirmTransfer={noop}
        onDismissTransfer={noop}
        onSplit={noop}
        onRemove={noop}
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

  it("requires both purpose and beneficiary before teaching a merchant-wide rule", async () => {
    const onCategorize = vi.fn();
    const onRemember = vi.fn();
    await mount({ category: "all", beneficiary: "all", payer: "all" }, onCategorize, onRemember);

    const category = container?.querySelector<HTMLSelectElement>('select[aria-label="Category for UNKNOWN SHOP"]');
    const beneficiary = container?.querySelector<HTMLSelectElement>('select[aria-label="Beneficiary for UNKNOWN SHOP"]');
    const apply = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Save default for UNKNOWN SHOP"]',
    );
    expect(container?.textContent).toContain("What was it?");
    expect(container?.textContent).toContain("Who was it for?");
    expect(apply?.disabled).toBe(true);

    await act(async () => {
      if (category) {
        category.value = "dining";
        category.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    expect(apply?.disabled).toBe(true);
    await act(async () => {
      if (beneficiary) {
        beneficiary.value = "household";
        beneficiary.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    expect(apply?.disabled).toBe(false);
    await act(async () => apply?.click());
    expect(onCategorize).toHaveBeenCalledWith("UNKNOWN SHOP", {
      category: "dining",
      beneficiary: { type: "household" },
      kind: "expense",
    });

    const remember = [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => button.textContent?.trim() === "Remember for merchant" && !button.disabled);
    await act(async () => remember?.click());
    expect(onRemember).toHaveBeenCalledWith("sam-transport");
  });

  it("keeps the primary review decisions labeled and reveals movement details on demand", async () => {
    await mount({ category: "all", beneficiary: "all", payer: "all" });

    const card = container?.querySelector<HTMLElement>(
      '.merchant-review-card [title="UNKNOWN SHOP"]',
    )?.closest<HTMLElement>(".merchant-review-card");
    expect(card).not.toBeNull();
    expect([...card!.querySelectorAll<HTMLElement>(".review-field > span")].map((label) => label.textContent))
      .toEqual(["Movement", "What was it?", "Who was it for?"]);

    const changeMovement = card?.querySelector<HTMLButtonElement>(".review-value-button");
    await act(async () => changeMovement?.click());
    const movement = card?.querySelector<HTMLSelectElement>('select[aria-label="Movement for UNKNOWN SHOP"]');
    expect(movement).not.toBeNull();

    await act(async () => {
      if (movement) {
        movement.value = "gift_or_handout";
        movement.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    expect(card?.textContent).toContain("Other person");
    expect(card?.querySelector('button[aria-label="Save default for UNKNOWN SHOP"]')).not.toBeNull();
  });

  it("saves an account-relative merchant beneficiary for an inferred personal row", async () => {
    const onCategorize = vi.fn();
    await mount({ category: "all", beneficiary: "all", payer: "all" }, onCategorize);
    const category = container?.querySelector<HTMLSelectElement>('select[aria-label="Category for COOL PLANET"]');
    const beneficiary = container?.querySelector<HTMLSelectElement>('select[aria-label="Beneficiary for COOL PLANET"]');
    const apply = container?.querySelector<HTMLButtonElement>('button[aria-label="Save default for COOL PLANET"]');
    expect(beneficiary?.value).toBe("account_default");
    await act(async () => {
      if (!category) return;
      category.value = "lifestyle";
      category.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(apply?.disabled).toBe(false);
    await act(async () => apply?.click());
    expect(onCategorize).toHaveBeenCalledWith("COOL PLANET", {
      category: "lifestyle",
      beneficiary: { type: "account_default" },
      kind: "expense",
    });
  });
});
