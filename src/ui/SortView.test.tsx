import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { reviewQueue } from "../domain/summary";
import type { Transaction } from "../domain/types";
import { SortView } from "./SortView";

const members = [
  { id: "munsif", name: "Munsif", color: "#14483a", portions: [] },
  { id: "sara", name: "Sara", color: "#7a4d8f", portions: [] },
];

function row(id: string, description: string, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id,
    date: "2026-07-26",
    description,
    amount: 34_600,
    category: "uncategorized",
    beneficiary: { type: "unassigned" },
    account: "Sara's HSBC",
    note: "",
    source: "imported",
    direction: "debit",
    kind: "expense",
    classificationLocked: true,
    ...overrides,
  };
}

describe("SortView", () => {
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

  async function mount(transactions: Transaction[], overrides: Partial<React.ComponentProps<typeof SortView>> = {}) {
    const onCategorizeMerchant = overrides.onCategorizeMerchant ?? vi.fn();
    const onCategorizeMerchants = overrides.onCategorizeMerchants ?? vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(
      <SortView
        queue={reviewQueue(transactions)}
        transferCandidates={[]}
        members={members}
        accounts={[]}
        allTransactions={transactions}
        money={(value) => `LKR ${value.toFixed(2)}`}
        undoLabel=""
        onCategorizeMerchant={onCategorizeMerchant}
        onCategorizeMerchants={onCategorizeMerchants}
        onSaveSplit={overrides.onSaveSplit ?? vi.fn()}
        onAdjustSplit={overrides.onAdjustSplit ?? vi.fn()}
        onConfirmTransfer={overrides.onConfirmTransfer ?? vi.fn()}
        onRejectTransfer={overrides.onRejectTransfer ?? vi.fn()}
        onUndo={overrides.onUndo ?? vi.fn()}
        {...overrides}
      />,
    ));
    return { onCategorizeMerchant, onCategorizeMerchants };
  }

  it("picks categories and members from the keyboard before committing one merchant", async () => {
    const { onCategorizeMerchant } = await mount([row("current", "UNKNOWN SHOP", { amount: 2_000 })]);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "3" })));
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "s" })));
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })));

    expect(onCategorizeMerchant).toHaveBeenCalledWith("UNKNOWN SHOP", {
      category: "dining",
      beneficiary: { type: "member", memberId: "sara" },
      kind: "expense",
    });
  });

  it("shows transfer candidates before merchant naming", async () => {
    const debit = row("debit", "FT TO CARD", { amount: 75_000, account: "NTB Current" });
    const credit = row("credit", "PAYMENT RECEIVED", {
      amount: 75_000,
      account: "HSBC Visa",
      direction: "credit",
      kind: "account_credit",
      category: "uncategorized",
      beneficiary: { type: "unassigned" },
    });
    const onConfirmTransfer = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(
      <SortView
        queue={reviewQueue([row("merchant", "UNKNOWN SHOP", { amount: 2_000 })])}
        transferCandidates={[{ debit, credit, daysApart: 1 }]}
        members={members}
        accounts={[]}
        allTransactions={[debit, credit]}
        money={(value) => `LKR ${value}`}
        undoLabel=""
        onCategorizeMerchant={vi.fn()}
        onCategorizeMerchants={vi.fn()}
        onSaveSplit={vi.fn()}
        onAdjustSplit={vi.fn()}
        onConfirmTransfer={onConfirmTransfer}
        onRejectTransfer={vi.fn()}
        onUndo={vi.fn()}
      />,
    ));

    expect(container.textContent).toContain("Looks like your own money moving");
    expect(container.textContent).not.toContain("UNKNOWN SHOP");
    await act(async () => container?.querySelector<HTMLButtonElement>("button")?.click());
    expect(onConfirmTransfer).toHaveBeenCalledWith("debit", "credit");
  });

  it("offers a remembered ratio and reconciles the current charge exactly", async () => {
    const priorOne = row("prior-one", "ARPICO SUPERCENTRE", { classificationLocked: false, category: "food", beneficiary: { type: "household" }, split: { mine: 7, of: 10 } });
    const priorTwo = row("prior-two", "ARPICO SUPERCENTRE", { date: "2026-07-20", classificationLocked: false, category: "food", beneficiary: { type: "household" }, split: { mine: 7, of: 10 } });
    const current = row("current", "ARPICO SUPERCENTRE");
    const onSaveSplit = vi.fn();
    const { onCategorizeMerchants } = await mount([priorOne, priorTwo, current], { onSaveSplit });

    expect(container?.textContent).toContain("Split it that way");
    expect(container?.textContent).toContain("Adds up to");
    expect(container?.textContent).toContain("exact");
    expect(container?.textContent).toContain("3 older ones in your history get corrected too.");
    await act(async () => {
      [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
        .find((button) => button.textContent?.includes("Split it that way"))?.click();
    });
    expect(onSaveSplit).toHaveBeenCalledWith("current", { mine: 7, of: 10 });
    expect(onCategorizeMerchants).toHaveBeenCalledTimes(1);
  });
});
