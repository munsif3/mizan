import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { computeMonthSummary, reviewQueue } from "../domain/summary";
import type { AppData, MerchantRule, SpendBeneficiary } from "../domain/types";
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
    mutateData?: (data: AppData) => void,
    financialValuesHidden = false,
    actions: {
      onOpenImport?: () => void;
      onAddTransaction?: () => void;
      onUnlinkCommitment?: (id: string) => void;
      onCategorizeMerchants?: (entries: { merchant: string; rule: MerchantRule }[]) => void;
    } = {},
  ) {
    const onCategorizeMerchants = actions.onCategorizeMerchants ?? vi.fn();
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
        queue={reviewQueue(data.transactions)}
        transferCandidates={[]}
        undoLabel=""
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
        onCategorizeMerchant={onCategorizeMerchant}
        onCategorizeMerchants={onCategorizeMerchants}
        onRememberMerchant={onRememberMerchant}
        onUndo={noop}
        onResetClassification={noop}
        onUnlinkCommitment={actions.onUnlinkCommitment}
        onConfirmTransfer={noop}
        onDismissTransfer={noop}
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

  it("requires both purpose and beneficiary before teaching a merchant-wide rule", async () => {
    const onCategorize = vi.fn();
    const onRemember = vi.fn();
    await mount({ category: "all", beneficiary: "all", payer: "all" }, onCategorize, onRemember);

    const category = container?.querySelector<HTMLSelectElement>('select[aria-label="Category for UNKNOWN SHOP"]');
    const beneficiary = container?.querySelector<HTMLSelectElement>('select[aria-label="Who it was for: UNKNOWN SHOP"]');
    const apply = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Save merchant default for UNKNOWN SHOP"]',
    );
    expect(container?.textContent).toContain("Purpose");
    expect(container?.textContent).toContain("Who it was for");
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

    const openUber = container?.querySelector<HTMLButtonElement>('button[aria-label="Open details for UBER"]');
    await act(async () => openUber?.click());
    const remember = [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => button.textContent?.trim() === "Save merchant default" && !button.disabled);
    await act(async () => remember?.click());
    expect(onRemember).toHaveBeenCalledWith("sam-transport");
  });

  it("keeps default expenses category-first and reveals movement on request", async () => {
    await mount({ category: "all", beneficiary: "all", payer: "all" });

    const card = container?.querySelector<HTMLElement>(
      '.merchant-review-card [title="UNKNOWN SHOP"]',
    )?.closest<HTMLElement>(".merchant-review-card");
    expect(card).not.toBeNull();
    expect([...card!.querySelectorAll<HTMLElement>(".review-field > span")].map((label) => label.textContent))
      .toEqual(["Purpose", "Who it was for"]);
    expect(card?.querySelector('select[aria-label="Movement for UNKNOWN SHOP"]')).toBeNull();

    const changeMovement = card?.querySelector<HTMLButtonElement>('button[aria-label="Change movement for UNKNOWN SHOP"]');
    expect(changeMovement?.textContent).toContain("Change movement");
    await act(async () => changeMovement?.click());

    const movement = card?.querySelector<HTMLSelectElement>('select[aria-label="Movement for UNKNOWN SHOP"]');
    expect(movement).not.toBeNull();
    expect([...card!.querySelectorAll<HTMLElement>(".review-field > span")].map((label) => label.textContent))
      .toEqual(["Movement", "Purpose", "Who it was for"]);
    await act(async () => {
      if (movement) {
        movement.value = "gift_or_handout";
        movement.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    expect(card?.textContent).toContain("Other person");
    expect(card?.querySelector('button[aria-label="Save merchant default for UNKNOWN SHOP"]')).not.toBeNull();
  });

  it("shows a suggested non-default movement with all of its controls", async () => {
    await mount(
      { category: "all", beneficiary: "all", payer: "all" },
      vi.fn(),
      vi.fn(),
      (data) => {
        data.transactions = [{
          id: "lent", date: "2026-07-12", description: "FRIEND LOAN", amount: 2_000,
          category: "uncategorized", beneficiary: { type: "unassigned" },
          account: "Alex Card", accountId: "alex-card", note: "", source: "imported",
          direction: "debit", kind: "gift_or_handout",
        }];
      },
    );

    const card = container?.querySelector<HTMLElement>(".merchant-review-card");
    expect(card?.querySelector<HTMLSelectElement>('select[aria-label="Movement for FRIEND LOAN"]')?.value).toBe("gift_or_handout");
    expect(card?.querySelector('select[aria-label="Category for FRIEND LOAN"]')).not.toBeNull();
    expect(card?.querySelector('select[aria-label="Person for FRIEND LOAN"]')).not.toBeNull();
    expect(card?.querySelector('button[aria-label="Change movement for FRIEND LOAN"]')).toBeNull();
  });

  it("asks about every merchant that matters, with no artificial page size", async () => {
    await mount(
      { category: "all", beneficiary: "all", payer: "all" },
      vi.fn(),
      vi.fn(),
      (data) => {
        // These inherit an unassigned beneficiary, so each one changes settlement.
        const base = data.transactions.find((transaction) => transaction.id === "unknown")!;
        data.transactions.push(
          { ...base, id: "unknown-two", description: "SECOND UNKNOWN", amount: 1_500 },
          { ...base, id: "unknown-three", description: "THIRD UNKNOWN", amount: 1_250 },
          { ...base, id: "unknown-four", description: "FOURTH UNKNOWN", amount: 1_000 },
        );
      },
    );

    // Four settlement-critical merchants plus the one material purpose gap.
    expect(container?.querySelectorAll(".merchant-review-card")).toHaveLength(5);
    expect(container?.textContent).toContain("4 of these change who owes whom.");
    const paging = [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => /Show all|Show next/.test(button.textContent ?? ""));
    expect(paging).toBeUndefined();
  });

  it("stops asking about immaterial merchants and discloses them instead", async () => {
    await mount(
      { category: "all", beneficiary: "all", payer: "all" },
      vi.fn(),
      vi.fn(),
      (data) => {
        // Purpose-only gaps (beneficiary already resolves from the account), each
        // far too small to be worth a decision.
        const base = data.transactions.find((transaction) => transaction.id === "cool-planet")!;
        for (let index = 0; index < 6; index += 1) {
          data.transactions.push({ ...base, id: `crumb-${index}`, description: `CRUMB ${index}`, amount: 50 });
        }
      },
    );

    // Asked: the settlement gap and the one material purpose gap. Not: the crumbs.
    expect(container?.querySelectorAll(".merchant-review-card")).toHaveLength(2);
    expect(container?.textContent).toContain("6 smaller merchants");
    expect(container?.textContent).toContain("already counted in your");

    const classifyAnyway = [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => button.textContent?.trim() === "Classify them anyway");
    await act(async () => classifyAnyway?.click());
    expect(container?.querySelectorAll(".merchant-review-card")).toHaveLength(8);
  });

  it("accepts every complete suggestion as one change", async () => {
    const onCategorizeMerchants = vi.fn();
    await mount(
      { category: "all", beneficiary: "all", payer: "all" },
      vi.fn(),
      vi.fn(),
      (data) => {
        // Seeded merchants: purpose comes from the starter table, and the account
        // policy already answers who it was for, so each is a complete rule.
        const base = data.transactions.find((transaction) => transaction.id === "cool-planet")!;
        data.transactions.push(
          { ...base, id: "seeded-one", description: "KEELLS SUPER WATTALA", amount: 3_000 },
          { ...base, id: "seeded-two", description: "UBER EATS COLOMBO", amount: 3_000 },
        );
      },
      false,
      { onCategorizeMerchants },
    );

    expect(container?.textContent).toContain("Purpose suggested from Mizan's starter list");
    const acceptAll = [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => button.textContent?.trim() === "Accept all 2 suggestions");
    expect(acceptAll).toBeDefined();

    await act(async () => acceptAll?.click());

    // One call, so one undo snapshot reverses the whole sitting.
    expect(onCategorizeMerchants).toHaveBeenCalledTimes(1);
    expect(onCategorizeMerchants.mock.calls[0]![0]).toEqual([
      { merchant: "KEELLS SUPER WATTALA", rule: { category: "food", beneficiary: { type: "account_default" }, kind: "expense" } },
      { merchant: "UBER EATS COLOMBO", rule: { category: "dining", beneficiary: { type: "account_default" }, kind: "expense" } },
    ]);
  });

  it("shows every paying account and owner on a grouped review card", async () => {
    await mount(
      { category: "all", beneficiary: "all", payer: "all" },
      vi.fn(),
      vi.fn(),
      (data) => {
        const base = data.transactions.find((transaction) => transaction.id === "unknown")!;
        const withoutAccountId = { ...base };
        delete withoutAccountId.accountId;
        data.transactions.push(
          { ...base, id: "unknown-joint-2" },
          { ...base, id: "unknown-alex", account: "Old Alex label", accountId: "alex-card" },
          { ...withoutAccountId, id: "unknown-unregistered", account: "DFCC 9999", rawAccount: "DFCC 9999" },
        );
      },
    );

    const card = container?.querySelector<HTMLElement>(
      '.merchant-review-card [title="UNKNOWN SHOP"]',
    )?.closest<HTMLElement>(".merchant-review-card");
    expect(card?.textContent).toContain("Paid from:");
    expect(card?.textContent).toContain("Joint Cash · Joint ×2");
    expect(card?.textContent).toContain("Alex Card · Alex");
    expect(card?.textContent).toContain("DFCC 9999");
  });

  it("saves an account-relative merchant beneficiary for an inferred personal row", async () => {
    const onCategorize = vi.fn();
    await mount({ category: "all", beneficiary: "all", payer: "all" }, onCategorize);
    const category = container?.querySelector<HTMLSelectElement>('select[aria-label="Category for COOL PLANET"]');
    const beneficiary = container?.querySelector<HTMLSelectElement>('select[aria-label="Who it was for: COOL PLANET"]');
    const apply = container?.querySelector<HTMLButtonElement>('button[aria-label="Save merchant default for COOL PLANET"]');
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

  it("drops the beneficiary axis from review in a one-member household", async () => {
    const onCategorize = vi.fn();
    await mount(
      { category: "all", beneficiary: "all", payer: "all" },
      onCategorize,
      vi.fn(),
      (data) => {
        data.settings.members = [{ id: "alex", name: "Alex", color: "#5b8cff", portions: [] }];
        data.transactions = [{
          id: "solo-unknown", date: "2026-07-12", description: "UNKNOWN SHOP", amount: 2_000,
          category: "uncategorized", beneficiary: { type: "member", memberId: "alex" }, beneficiarySource: "account_default",
          account: "Alex Card", accountId: "alex-card", note: "", source: "imported", direction: "debit", kind: "expense",
        }];
      },
    );

    // The "for whom?" field is gone; review asks only for purpose.
    expect(container?.querySelector('select[aria-label="Who it was for: UNKNOWN SHOP"]')).toBeNull();
    expect(container?.textContent).not.toContain("Who it was for");

    const category = container?.querySelector<HTMLSelectElement>('select[aria-label="Category for UNKNOWN SHOP"]');
    const apply = container?.querySelector<HTMLButtonElement>('button[aria-label="Save merchant default for UNKNOWN SHOP"]');
    await act(async () => {
      if (!category) return;
      category.value = "dining";
      category.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(apply?.disabled).toBe(false);
    await act(async () => apply?.click());
    // The sole member is filled through the account default, keeping the rule recalculable.
    expect(onCategorize).toHaveBeenCalledWith("UNKNOWN SHOP", {
      category: "dining",
      beneficiary: { type: "account_default" },
      kind: "expense",
    });
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
    await mount({ category: "all", beneficiary: "all", payer: "all" }, vi.fn(), vi.fn(), undefined, true);

    expect(container?.innerHTML).not.toContain("LKR 28090");
    expect(container?.innerHTML).not.toContain("LKR 20000");
    expect(container?.textContent).toContain("••••");
    expect(container?.querySelector('[aria-label="Financial value hidden"]')).not.toBeNull();
  });
});
