import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { detectIncomeCandidates } from "../domain/incomeMatch";
import { resolveMonthIncome } from "../domain/income";
import type { Account, IncomePortion, Member, Transaction } from "../domain/types";
import { IncomeConfirmModal } from "./IncomeConfirmModal";

describe("IncomeConfirmModal currency resolution", () => {
  let container: HTMLDivElement | null = null;

  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    container?.remove();
    container = null;
  });

  it("stores a native USD credit as a converted household receipt", async () => {
    const portion: IncomePortion = {
      id: "usd",
      label: "USD portion",
      amount: 2200,
      currency: "USD",
      taxRate: 15,
      taxWithheld: false,
      window: null,
    };
    const members: Member[] = [{ id: "sara", name: "Sara", color: "#ff80b5", portions: [portion] }];
const accounts: Account[] = [{ id: "rfc", label: "NTB RFC - Sara", currency: "LKR", owner: "sara", beneficiaryDefault: "review", match: [] }];
    const transaction: Transaction = {
      id: "salary",
      date: "2026-06-24",
      description: "Inward TT STP 2026062400231088",
      amount: 2109.8,
      category: "uncategorized",
      beneficiary: { type: "unassigned" },
      account: "NTB RFC - Sara",
      accountId: "rfc",
      note: "",
      source: "imported",
      direction: "credit",
      kind: "account_credit",
    };
    const fxRates = { USD: 332 };
    const item = resolveMonthIncome(members, [], "LKR", fxRates, "2026-06", new Date(2026, 5, 24)).items[0]!;
    const candidate = detectIncomeCandidates(members, [transaction], accounts, [], "LKR", fxRates, "2026-06")[0]!;
    const onSave = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <IncomeConfirmModal
          item={item}
          candidate={candidate}
          accounts={accounts}
          householdCurrency="LKR"
          fxRates={fxRates}
          locale="en-LK"
          money={(value) => `LKR ${value}`}
          currencyMoney={(value, currency) => `${currency} ${Math.round(value).toLocaleString("en-US")}`}
          onSave={onSave}
          onRemove={() => {}}
          onClose={() => {}}
        />,
      );
    });

    expect(container.textContent).toContain("Amount received (USD)");
    expect(container.textContent).toContain("USD 2,110");
    expect(container.textContent).toContain("LKR 700453.6");
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Currency received"]')?.value).toBe("USD");

    const confirm = [...container.querySelectorAll("button")].find((button) => button.textContent === "Confirm income")!;
    await act(async () => confirm.click());

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      receivedAmount: 2109.8,
      receivedCurrency: "USD",
      fxRate: 332,
      transactionId: "salary",
    }));
    expect(onSave.mock.calls[0]?.[0].amount).toBeCloseTo(700453.6, 6);

    const currencySelect = container.querySelector<HTMLSelectElement>('select[aria-label="Currency received"]')!;
    await act(async () => {
      currencySelect.value = "LKR";
      currencySelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("Amount received (LKR)");
    await act(async () => confirm.click());
    expect(onSave.mock.calls[1]?.[0]).toMatchObject({ amount: 2109.8, transactionId: "salary" });
    expect(onSave.mock.calls[1]?.[0].receivedCurrency).toBeUndefined();
    await act(async () => root.unmount());
  });

  it("uses edit-specific actions for an existing income confirmation", async () => {
    const portion: IncomePortion = {
      id: "salary",
      label: "Salary",
      amount: 1000,
      currency: "LKR",
      taxRate: 0,
      taxWithheld: true,
      window: null,
    };
    const members: Member[] = [{ id: "sara", name: "Sara", color: "#ff80b5", portions: [portion] }];
    const receipt = {
      id: "rcpt_2026-07_salary",
      month: "2026-07",
      memberId: "sara",
      portionId: "salary",
      amount: 1000,
    };
    const item = resolveMonthIncome(members, [receipt], "LKR", {}, "2026-07", new Date(2026, 6, 15)).items[0]!;
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <IncomeConfirmModal
          item={item}
          householdCurrency="LKR"
          money={(value) => `LKR ${value}`}
          onSave={() => {}}
          onRemove={() => {}}
          onClose={() => {}}
        />,
      );
    });

    expect(container.textContent).toContain("Save changes");
    expect(container.textContent).toContain("Delete income confirmation");
    expect(container.textContent).not.toContain("Confirm income");
    await act(async () => root.unmount());
  });
});
