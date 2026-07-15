// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppData } from "../domain/types";
import { emptyData } from "../storage/schema";
import { SettingsModal } from "./SettingsModal";

function button(view: HTMLElement, label: string): HTMLButtonElement {
  const match = [...view.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

describe("SettingsModal recurring commitments", () => {
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

  it("separates loan payment type from purpose and uses a month control", async () => {
    const initial = emptyData();
    initial.settings.members = [{ id: "owner", name: "Owner", color: "#5b8cff", portions: [] }];
    initial.fixedCosts = [{
      id: "car-loan",
      label: "Personal Loan - Car",
      amount: 264_795.26,
      kind: "expense",
      category: "transport",
      beneficiary: { type: "household" },
      until: "2028-01",
    }];

    function Harness() {
      const [data, setData] = useState<AppData>(initial);
      return (
        <SettingsModal
          data={data}
          onUpdateMembers={(members) => setData((value) => ({ ...value, settings: { ...value.settings, members } }))}
          onUpdateTarget={() => {}}
          onUpdateCurrency={() => {}}
          onUpdateFxRates={() => {}}
          onUpdateFixedCosts={(fixedCosts) => setData((value) => ({ ...value, fixedCosts }))}
          onUpdateAccounts={() => {}}
          onDeleteRule={() => {}}
          onUpdateCounterparties={() => {}}
          onUpdateCustomCategories={() => {}}
          sync={{ auth: { status: "signed-out", user: null, error: "" }, mode: "none", status: "", household: null, households: [] }}
          onSignIn={() => {}}
          onSignOut={() => {}}
          onCreateHousehold={() => {}}
          onJoinHousehold={() => {}}
          onSwitchHousehold={() => {}}
          onRotateInvite={() => {}}
          onExport={() => {}}
          onImportBackup={() => {}}
          onClearData={() => {}}
          canClearTransactions={false}
          hasTransactions={false}
          onClearTransactions={() => {}}
          canResetHousehold={false}
          hasResettableData={false}
          onResetHousehold={() => {}}
          onClose={() => {}}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () => button(container, "Budget").click());

    expect(container.textContent).toContain("Payment type says how money moves; purpose says what it paid for.");
    expect(container.textContent).toContain("This name looks like a loan.");

    await act(async () => button(container, "Mark as loan / debt").click());
    expect(container.textContent).toContain("Purpose stays separate from the loan.");

    const paymentType = container.querySelector<HTMLSelectElement>('select[aria-label="Payment type for Personal Loan - Car"]')!;
    const purpose = container.querySelector<HTMLSelectElement>('select[aria-label="Purpose for Personal Loan - Car"]')!;
    const finalMonth = container.querySelector<HTMLInputElement>('input[aria-label="Last month for Personal Loan - Car"]')!;
    expect(paymentType.value).toBe("loan_payment");
    expect(purpose.value).toBe("transport");
    expect(finalMonth.type).toBe("month");
    expect(finalMonth.value).toBe("2028-01");

    await act(async () => button(container, "Manage custom purposes").click());
    expect(container.textContent).toContain("Your own spending buckets");

    await act(async () => button(container, "Budget").click());
    const updatedPaymentType = container.querySelector<HTMLSelectElement>('select[aria-label="Payment type for Personal Loan - Car"]')!;
    await act(async () => {
      updatedPaymentType.value = "expense";
      updatedPaymentType.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).not.toContain("Purpose stays separate from the loan.");
    expect(container.textContent).toContain("This name looks like a loan.");
    expect(container.textContent).toContain("Bill / regular expense");
  });

  it("warns before deleting an income source with historical confirmations", async () => {
    const data = emptyData();
    data.settings.currency = "LKR";
    data.settings.members = [{
      id: "owner", name: "Owner", color: "#5b8cff", portions: [{
        id: "bonus", label: "Annual bonus", amount: 1000, currency: "LKR", taxRate: 0, taxWithheld: true,
        window: null, schedule: { frequency: "one_off", month: "2026-07" }, budgetTreatment: "protected",
      }],
    }];
    data.incomeReceipts = [{ id: "receipt", month: "2026-07", memberId: "owner", portionId: "bonus", amount: 1000 }];
    const onUpdateMembers = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    await act(async () => root.render(
      <SettingsModal
        data={data}
        onUpdateMembers={onUpdateMembers}
        onUpdateTarget={() => {}}
        onUpdateCurrency={() => {}}
        onUpdateFxRates={() => {}}
        onUpdateFixedCosts={() => {}}
        onUpdateAccounts={() => {}}
        onDeleteRule={() => {}}
        onUpdateCounterparties={() => {}}
        onUpdateCustomCategories={() => {}}
        sync={{ auth: { status: "signed-out", user: null, error: "" }, mode: "none", status: "", household: null, households: [] }}
        onSignIn={() => {}}
        onSignOut={() => {}}
        onCreateHousehold={() => {}}
        onJoinHousehold={() => {}}
        onSwitchHousehold={() => {}}
        onRotateInvite={() => {}}
        onExport={() => {}}
        onImportBackup={() => {}}
        onClearData={() => {}}
        canClearTransactions={false}
        hasTransactions={false}
        onClearTransactions={() => {}}
        canResetHousehold={false}
        hasResettableData={false}
        onResetHousehold={() => {}}
        onClose={() => {}}
      />,
    ));

    const deleteButton = container.querySelector<HTMLButtonElement>('button[aria-label="Delete Annual bonus"]')!;
    const scheduleButtons = container.querySelectorAll<HTMLButtonElement>('[aria-label="Annual bonus schedule"] button');
    expect([...scheduleButtons].every((scheduleButton) => scheduleButton.disabled)).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[type="month"]')?.disabled).toBe(true);
    expect(container.textContent).toContain("Schedule locked after confirmation");
    await act(async () => deleteButton.click());
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/1 historical confirmation/i));
    expect(onUpdateMembers).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await act(async () => deleteButton.click());
    expect(onUpdateMembers.mock.calls[0]?.[0][0]?.portions).toEqual([]);
    confirm.mockRestore();
  });
});
