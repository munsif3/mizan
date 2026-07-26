// @vitest-environment jsdom

import { act, type ComponentProps, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppData } from "../domain/types";
import { sync } from "../app/syncState";
import { emptyData } from "../storage/schema";
import { SettingsModal } from "./SettingsModal";

function button(view: HTMLElement, label: string): HTMLButtonElement {
  const match = [...view.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

function baseProps(data: AppData): ComponentProps<typeof SettingsModal> {
  return {
    data,
    onUpdateMembers: () => {},
    onUpdateTarget: () => {},
    onUpdateCurrency: () => {},
    onUpdateFxRates: () => {},
    onUpdateFixedCosts: () => {},
    onUpdateAccounts: () => {},
    onUpsertRule: () => {},
    onDeleteRules: () => {},
    onUpdateCounterparties: () => {},
    onUpdateCustomCategories: () => {},
    sync: { auth: { status: "signed-out", user: null, error: "" }, mode: "none", status: sync.idle(""), household: null, households: [] },
    onSignIn: () => {},
    onSignOut: () => {},
    onCreateHousehold: () => {},
    onJoinHousehold: () => {},
    onSwitchHousehold: () => {},
    onRotateInvite: () => {},
    onExport: () => {},
    onImportBackup: () => {},
    hasLegacyBrowserData: false,
    onClearData: () => {},
    canClearTransactions: false,
    hasTransactions: false,
    onClearTransactions: () => {},
    canResetHousehold: false,
    hasResettableData: false,
    onResetHousehold: () => {},
    onClose: () => {},
  };
}

async function enterText(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
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
          onUpsertRule={() => {}}
          onDeleteRules={() => {}}
          onUpdateCounterparties={() => {}}
          onUpdateCustomCategories={() => {}}
          sync={{ auth: { status: "signed-out", user: null, error: "" }, mode: "none", status: sync.idle(""), household: null, households: [] }}
          onSignIn={() => {}}
          onSignOut={() => {}}
          onCreateHousehold={() => {}}
          onJoinHousehold={() => {}}
          onSwitchHousehold={() => {}}
          onRotateInvite={() => {}}
          onExport={() => {}}
          onImportBackup={() => {}}
          hasLegacyBrowserData={false}
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

    const budgetTab = button(container, "Budget");
    expect(budgetTab.getAttribute("aria-selected")).toBe("true");
    expect(budgetTab.getAttribute("aria-controls")).toBe("settings-panel-budget");
    expect(container.querySelector("#settings-panel-budget")?.getAttribute("aria-labelledby")).toBe("settings-tab-budget");

    expect(container.textContent).toContain("Open one commitment when it needs attention.");
    expect(container.querySelector('select[aria-label="Payment type for Personal Loan - Car"]')).toBeNull();
    await act(async () => button(container, "Edit").click());
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

  it("shows legacy cleanup only when an old browser copy exists", async () => {
    const onClearData = vi.fn();
    const props: ComponentProps<typeof SettingsModal> = {
      data: emptyData(),
      onUpdateMembers: () => {},
      onUpdateTarget: () => {},
      onUpdateCurrency: () => {},
      onUpdateFxRates: () => {},
      onUpdateFixedCosts: () => {},
      onUpdateAccounts: () => {},
      onUpsertRule: () => {},
      onDeleteRules: () => {},
      onUpdateCounterparties: () => {},
      onUpdateCustomCategories: () => {},
      sync: { auth: { status: "signed-out", user: null, error: "" }, mode: "none", status: sync.idle(""), household: null, households: [] },
      onSignIn: () => {},
      onSignOut: () => {},
      onCreateHousehold: () => {},
      onJoinHousehold: () => {},
      onSwitchHousehold: () => {},
      onRotateInvite: () => {},
      onExport: () => {},
      onImportBackup: () => {},
      hasLegacyBrowserData: false,
      onClearData,
      canClearTransactions: false,
      hasTransactions: false,
      onClearTransactions: () => {},
      canResetHousehold: false,
      hasResettableData: false,
      onResetHousehold: () => {},
      onClose: () => {},
    };

    await act(async () => root.render(<SettingsModal {...props} />));
    expect(container.textContent).toContain("Saved");
    expect(container.textContent).toContain("Simple changes autosave; editors use Save");
    await act(async () => root.render(<SettingsModal {...props} sync={{ ...props.sync, status: sync.syncing("Saving to Firestore") }} />));
    expect(container.textContent).toContain("Saving");
    await act(async () => root.render(<SettingsModal {...props} sync={{ ...props.sync, status: sync.error("Save failed: offline") }} />));
    expect(container.textContent).toContain("Sync issue");
    await act(async () => root.render(<SettingsModal {...props} />));
    await act(async () => button(container, "Sync & backup").click());
    expect(container.textContent).not.toContain("Remove old browser copy");
    expect(container.textContent).not.toContain("Clear legacy browser data");

    await act(async () => root.render(<SettingsModal {...props} hasLegacyBrowserData />));
    await act(async () => button(container, "Remove old browser copy").click());

    expect(onClearData).not.toHaveBeenCalled();
    expect(container.textContent).toContain("active Firestore household will not be changed");
    await act(async () => button(container, "Remove browser copy").click());
    expect(onClearData).toHaveBeenCalledOnce();

    expect(container.textContent).not.toContain("Clear transactions");
    expect(container.textContent).not.toContain("Reset household data");
    await act(async () => root.render(
      <SettingsModal
        {...props}
        canClearTransactions
        hasTransactions
        canResetHousehold
        hasResettableData
      />,
    ));
    expect(container.textContent).toContain("Clear transactions");
    expect(container.textContent).toContain("Reset household data");

    await act(async () => root.render(
      <SettingsModal
        {...props}
        canClearTransactions={false}
        hasTransactions
        canResetHousehold={false}
        hasResettableData
      />,
    ));
    expect(container.textContent).not.toContain("Clear transactions");
    expect(container.textContent).not.toContain("Reset household data");
  });

  it("keeps commitment matcher typing local until preview and confirmation", async () => {
    const data = emptyData();
    data.settings.members = [{ id: "owner", name: "Owner", color: "#5b8cff", portions: [] }];
    data.fixedCosts = [{
      id: "loan",
      label: "Car loan",
      amount: 1_000,
      kind: "loan_payment",
      category: "transport",
      beneficiary: { type: "member", memberId: "owner" },
    }];
    data.transactions = [{
      id: "payment",
      date: "2026-07-10",
      description: "BANK LOAN PAYMENT",
      amount: 1_000,
      category: "uncategorized",
      beneficiary: { type: "unassigned" },
      account: "Card",
      note: "",
      source: "imported",
      direction: "debit",
      kind: "expense",
    }];
    const onUpdateFixedCosts = vi.fn();

    await act(async () => root.render(
      <SettingsModal {...baseProps(data)} onUpdateFixedCosts={onUpdateFixedCosts} />,
    ));
    await act(async () => button(container, "Budget").click());
    await act(async () => button(container, "Edit").click());
    const matcher = container.querySelector<HTMLInputElement>('input[aria-label="Merchant match for Car loan"]')!;
    await enterText(matcher, "BANK LOAN");

    expect(onUpdateFixedCosts).not.toHaveBeenCalled();
    expect(container.textContent).toContain("1 ledger row will change");
    await act(async () => button(container, "Cancel").click());
    expect(onUpdateFixedCosts).not.toHaveBeenCalled();

    await act(async () => button(container, "Edit").click());
    await enterText(
      container.querySelector<HTMLInputElement>('input[aria-label="Merchant match for Car loan"]')!,
      "BANK LOAN",
    );
    await act(async () => button(container, "Save commitment").click());
    expect(onUpdateFixedCosts).not.toHaveBeenCalled();
    expect(container.textContent).toContain("1 existing transaction will change");
    await act(async () => button(container, "Apply match").click());
    expect(onUpdateFixedCosts).toHaveBeenCalledOnce();
    expect(onUpdateFixedCosts.mock.calls[0]?.[0][0]?.merchantMatch).toEqual(["BANK LOAN"]);
  });

  it("routes to a focused account and saves its matcher atomically", async () => {
    const data = emptyData();
    data.settings.members = [{ id: "owner", name: "Owner", color: "#5b8cff", portions: [] }];
    data.accounts = [{
      id: "card",
      label: "Main card",
      owner: "owner",
      beneficiaryDefault: "owner",
      currency: "LKR",
      match: [],
    }];
    data.transactions = [{
      id: "row",
      date: "2026-07-10",
      description: "SHOP",
      amount: 500,
      category: "uncategorized",
      beneficiary: { type: "unassigned" },
      account: "CARD 1234",
      note: "",
      source: "imported",
      direction: "debit",
      kind: "expense",
    }];
    const onUpdateAccounts = vi.fn();

    await act(async () => root.render(
      <SettingsModal
        {...baseProps(data)}
        target={{ tab: "accounts", section: "accounts", itemId: "card" }}
        onUpdateAccounts={onUpdateAccounts}
      />,
    ));

    expect(button(container, "Accounts & rules").getAttribute("aria-selected")).toBe("true");
    const matcher = container.querySelector<HTMLInputElement>('input[aria-label="Main card statement match text"]')!;
    await enterText(matcher, "1234");
    expect(onUpdateAccounts).not.toHaveBeenCalled();
    expect(container.textContent).toContain("1 ledger row will change");

    await act(async () => button(container, "Save account").click());
    expect(onUpdateAccounts).not.toHaveBeenCalled();
    await act(async () => button(container, "Apply match").click());
    expect(onUpdateAccounts).toHaveBeenCalledOnce();
    expect(onUpdateAccounts.mock.calls[0]?.[0][0]?.match).toEqual(["1234"]);
  });

  it("keeps Assets hidden until relevant or explicitly activated", async () => {
    const data = emptyData();
    data.settings.members = [{ id: "owner", name: "Owner", color: "#5b8cff", portions: [] }];
    await act(async () => root.render(<SettingsModal {...baseProps(data)} />));

    expect([...container.querySelectorAll("button")].some((item) => item.textContent === "Assets & investments")).toBe(false);
    await act(async () => button(container, "Budget").click());
    expect(container.textContent).toContain("Asset and investment tracking stays hidden");
    await act(async () => button(container, "Track assets and investments").click());
    expect(button(container, "Assets & investments").getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("No holdings yet");
    await act(async () => button(container, "Household").click());
    expect(button(container, "Assets & investments")).toBeTruthy();
    await act(async () => button(container, "Assets & investments").click());
    expect(container.textContent).toContain("No holdings yet");
  });

  it("drafts a merchant rule and applies the transition only on Save", async () => {
    const data = emptyData();
    data.settings.members = [
      { id: "owner", name: "Owner", color: "#5b8cff", portions: [] },
      { id: "partner", name: "Partner", color: "#ff5b8c", portions: [] },
    ];
    data.settings.counterparties = [{ id: "sam", name: "Sam" }];
    data.merchantRules = { KEELLS: { category: "food", beneficiary: { type: "household" }, kind: "expense" } };
    const onUpsertRule = vi.fn();

    const props: ComponentProps<typeof SettingsModal> = {
      data,
      onUpdateMembers: () => {},
      onUpdateTarget: () => {},
      onUpdateCurrency: () => {},
      onUpdateFxRates: () => {},
      onUpdateFixedCosts: () => {},
      onUpdateAccounts: () => {},
      onUpsertRule,
      onDeleteRules: () => {},
      onUpdateCounterparties: () => {},
      onUpdateCustomCategories: () => {},
      sync: { auth: { status: "signed-out", user: null, error: "" }, mode: "none", status: sync.idle(""), household: null, households: [] },
      onSignIn: () => {},
      onSignOut: () => {},
      onCreateHousehold: () => {},
      onJoinHousehold: () => {},
      onSwitchHousehold: () => {},
      onRotateInvite: () => {},
      onExport: () => {},
      onImportBackup: () => {},
      hasLegacyBrowserData: false,
      onClearData: () => {},
      canClearTransactions: false,
      hasTransactions: false,
      onClearTransactions: () => {},
      canResetHousehold: false,
      hasResettableData: false,
      onResetHousehold: () => {},
      onClose: () => {},
    };

    await act(async () => root.render(<SettingsModal {...props} />));
    await act(async () => button(container, "Accounts & rules").click());
    await act(async () => button(container, "Edit").click());

    const purpose = container.querySelector<HTMLSelectElement>('select[aria-label="Category for KEELLS"]')!;
    await act(async () => {
      purpose.value = "transport";
      purpose.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onUpsertRule).not.toHaveBeenCalled();

    // Switching to a kind that needs neither a purpose nor a beneficiary drops both.
    const movement = container.querySelector<HTMLSelectElement>('select[aria-label="Movement for KEELLS"]')!;
    await act(async () => {
      movement.value = "internal_transfer";
      movement.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onUpsertRule).not.toHaveBeenCalled();
    await act(async () => button(container, "Save rule").click());
    expect(onUpsertRule).toHaveBeenCalledOnce();
    expect(onUpsertRule).toHaveBeenLastCalledWith("KEELLS", {
      category: "uncategorized",
      beneficiary: { type: "unassigned" },
      kind: "internal_transfer",
    });
  });

  it("deletes several merchant rules from one checkbox selection", async () => {
    const data = emptyData();
    data.settings.members = [{ id: "owner", name: "Owner", color: "#5b8cff", portions: [] }];
    data.merchantRules = {
      KEELLS: { category: "food", beneficiary: { type: "household" }, kind: "expense" },
      UBER: { category: "transport", beneficiary: { type: "household" }, kind: "expense" },
      NETFLIX: { category: "lifestyle", beneficiary: { type: "household" }, kind: "expense" },
    };
    const onDeleteRules = vi.fn();

    const props: ComponentProps<typeof SettingsModal> = {
      data,
      onUpdateMembers: () => {},
      onUpdateTarget: () => {},
      onUpdateCurrency: () => {},
      onUpdateFxRates: () => {},
      onUpdateFixedCosts: () => {},
      onUpdateAccounts: () => {},
      onUpsertRule: () => {},
      onDeleteRules,
      onUpdateCounterparties: () => {},
      onUpdateCustomCategories: () => {},
      sync: { auth: { status: "signed-out", user: null, error: "" }, mode: "none", status: sync.idle(""), household: null, households: [] },
      onSignIn: () => {},
      onSignOut: () => {},
      onCreateHousehold: () => {},
      onJoinHousehold: () => {},
      onSwitchHousehold: () => {},
      onRotateInvite: () => {},
      onExport: () => {},
      onImportBackup: () => {},
      hasLegacyBrowserData: false,
      onClearData: () => {},
      canClearTransactions: false,
      hasTransactions: false,
      onClearTransactions: () => {},
      canResetHousehold: false,
      hasResettableData: false,
      onResetHousehold: () => {},
      onClose: () => {},
    };

    await act(async () => root.render(<SettingsModal {...props} />));
    await act(async () => button(container, "Accounts & rules").click());

    expect(button(container, "Delete selected").disabled).toBe(true);

    const check = (label: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    await act(async () => check("Select merchant rule for KEELLS").click());
    await act(async () => check("Select merchant rule for NETFLIX").click());
    expect(container.textContent).toContain("2 selected");

    await act(async () => button(container, "Delete selected").click());
    expect(container.textContent).toContain("Delete 2 merchant rules?");
    await act(async () => button(container, "Delete 2 rules").click());
    expect(onDeleteRules).toHaveBeenCalledWith(["KEELLS", "NETFLIX"]);

    // Select all covers every rule, and clearing it empties the selection again.
    await act(async () => check("Select all merchant rules").click());
    expect(container.textContent).toContain("3 selected");
    await act(async () => check("Select all merchant rules").click());
    expect(button(container, "Delete selected").disabled).toBe(true);
  });

  it("keeps household summaries compact and discards a cancelled member draft", async () => {
    const data = emptyData();
    data.settings.currency = "LKR";
    data.settings.members = [{
      id: "owner",
      name: "Owner",
      color: "#5b8cff",
      portions: [
        {
          id: "salary",
          label: "Salary",
          amount: 100_000,
          currency: "LKR",
          taxRate: 0,
          taxWithheld: true,
          window: null,
          schedule: { frequency: "monthly" },
          budgetTreatment: "ordinary",
        },
        {
          id: "bonus",
          label: "Bonus",
          amount: 25_000,
          currency: "LKR",
          taxRate: 0,
          taxWithheld: true,
          window: null,
          schedule: { frequency: "one_off", month: "2026-12" },
          budgetTreatment: "protected",
        },
      ],
    }];
    const onUpdateMembers = vi.fn();
    const props = { ...baseProps(data), onUpdateMembers };

    await act(async () => root.render(<SettingsModal {...props} />));

    expect(container.textContent).toContain("2 income sources");
    expect(container.textContent).toContain("Salary");
    expect(container.textContent).toContain("Bonus");
    expect(container.querySelector('input[aria-label="Owner name"]')).toBeNull();

    await act(async () => button(container, "Edit").click());
    expect(container.querySelectorAll(".income-deposit-card")).toHaveLength(0);
    expect(
      [...container.querySelectorAll("#settings-section-income button")]
        .filter((item) => item.textContent?.trim() === "Edit"),
    ).toHaveLength(2);
    await act(async () => button(
      container.querySelector<HTMLElement>("#settings-item-salary")!,
      "Edit",
    ).click());
    expect(container.querySelectorAll(".income-deposit-card")).toHaveLength(1);
    expect(container.querySelector('input[aria-label="Salary amount"]')).toBeTruthy();
    expect(container.querySelector('input[aria-label="Bonus amount"]')).toBeNull();
    await enterText(
      container.querySelector<HTMLInputElement>('input[aria-label="Owner portion label"]')!,
      "Changed salary",
    );
    await enterText(
      container.querySelector<HTMLInputElement>('input[aria-label="Owner name"]')!,
      "Changed owner",
    );
    await act(async () => button(
      container.querySelector<HTMLElement>("#settings-item-bonus")!,
      "Edit",
    ).click());
    expect(container.querySelectorAll(".income-deposit-card")).toHaveLength(1);
    expect(container.querySelector('input[aria-label="Changed salary amount"]')).toBeNull();
    expect(container.querySelector('input[aria-label="Bonus amount"]')).toBeTruthy();
    expect(onUpdateMembers).not.toHaveBeenCalled();

    await act(async () => button(container, "Cancel").click());
    expect(onUpdateMembers).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Owner");
    expect(container.textContent).toContain("Salary");
    expect(container.textContent).not.toContain("Changed owner");

    await act(async () => root.render(
      <SettingsModal
        {...props}
        target={{ tab: "household", section: "income", itemId: "bonus" }}
      />,
    ));
    expect(container.querySelectorAll(".income-deposit-card")).toHaveLength(1);
    expect(container.querySelector('input[aria-label="Bonus amount"]')).toBeTruthy();
    expect(container.querySelector('input[aria-label="Salary amount"]')).toBeNull();
    const focusedName = container.querySelector<HTMLInputElement>(
      'input[aria-label="Owner name"]',
    )!;
    expect(focusedName).toBeTruthy();
    await enterText(focusedName, "Saved owner");
    await act(async () => button(container, "Save member").click());
    expect(onUpdateMembers).toHaveBeenCalledOnce();
    expect(onUpdateMembers.mock.calls[0]?.[0][0]?.name).toBe("Saved owner");
  });

  it("fixes ownership and beneficiary choices automatically for a solo household", async () => {
    const data = emptyData();
    data.settings.currency = "LKR";
    data.settings.members = [{
      id: "owner",
      name: "Owner",
      color: "#5b8cff",
      portions: [],
    }];
    const onUpdateFixedCosts = vi.fn();
    const onUpdateAccounts = vi.fn();
    const onUpdateAssetHoldings = vi.fn();

    await act(async () => root.render(
      <SettingsModal
        {...baseProps(data)}
        onUpdateFixedCosts={onUpdateFixedCosts}
        onUpdateAccounts={onUpdateAccounts}
        onUpdateAssetHoldings={onUpdateAssetHoldings}
      />,
    ));

    await act(async () => button(container, "Budget").click());
    await act(async () => button(container, "Add commitment").click());
    expect(container.querySelector('select[aria-label="Who commitment is for"]')).toBeNull();
    await enterText(
      container.querySelector<HTMLInputElement>('input[aria-label="Commitment name"]')!,
      "Rent",
    );
    await act(async () => button(container, "Save commitment").click());
    expect(onUpdateFixedCosts.mock.calls[0]?.[0][0]?.beneficiary).toEqual({
      type: "member",
      memberId: "owner",
    });

    await act(async () => button(container, "Accounts & rules").click());
    await act(async () => button(container, "Add account").click());
    expect(container.querySelector('select[aria-label$=" paid from"]')).toBeNull();
    expect(container.querySelector('select[aria-label$=" usually for"]')).toBeNull();
    await enterText(
      container.querySelector<HTMLInputElement>('input[aria-label="Account label"]')!,
      "Main account",
    );
    await act(async () => button(container, "Save account").click());
    expect(onUpdateAccounts.mock.calls[0]?.[0][0]).toMatchObject({
      owner: "owner",
      beneficiaryDefault: "owner",
    });

    await act(async () => button(container, "Budget").click());
    await act(async () => button(container, "Track assets and investments").click());
    await act(async () => button(container, "Add holding").click());
    expect(container.querySelector('select[aria-label^="Owner for"]')).toBeNull();
    await enterText(
      container.querySelector<HTMLInputElement>('input[aria-label="Holding name for "]')!,
      "Fixed deposit",
    );
    await act(async () => button(container, "Save holding").click());
    expect(onUpdateAssetHoldings.mock.calls[0]?.[0][0]?.owner).toBe("owner");
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

    await act(async () => root.render(
      <SettingsModal
        data={data}
        onUpdateMembers={onUpdateMembers}
        onUpdateTarget={() => {}}
        onUpdateCurrency={() => {}}
        onUpdateFxRates={() => {}}
        onUpdateFixedCosts={() => {}}
        onUpdateAccounts={() => {}}
        onUpsertRule={() => {}}
        onDeleteRules={() => {}}
        onUpdateCounterparties={() => {}}
        onUpdateCustomCategories={() => {}}
        sync={{ auth: { status: "signed-out", user: null, error: "" }, mode: "none", status: sync.idle(""), household: null, households: [] }}
        onSignIn={() => {}}
        onSignOut={() => {}}
        onCreateHousehold={() => {}}
        onJoinHousehold={() => {}}
        onSwitchHousehold={() => {}}
        onRotateInvite={() => {}}
        onExport={() => {}}
        onImportBackup={() => {}}
        hasLegacyBrowserData={false}
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

    expect(container.querySelector('input[aria-label="Owner name"]')).toBeNull();
    await act(async () => button(container, "Edit").click());
    await act(async () => button(container, "Edit").click());
    const deleteButton = container.querySelector<HTMLButtonElement>('button[aria-label="Delete Annual bonus"]')!;
    const scheduleButtons = container.querySelectorAll<HTMLButtonElement>('[aria-label="Annual bonus schedule"] button');
    expect([...scheduleButtons].every((scheduleButton) => scheduleButton.disabled)).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[type="month"]')?.disabled).toBe(true);
    expect(container.textContent).toContain("Schedule locked after confirmation");
    await act(async () => deleteButton.click());
    expect(container.querySelector('[role="dialog"]')?.parentElement?.textContent).toContain("1 historical confirmation");
    expect(onUpdateMembers).not.toHaveBeenCalled();

    await act(async () => button(container, "Delete income source").click());
    expect(onUpdateMembers).not.toHaveBeenCalled();
    await act(async () => button(container, "Save member").click());
    expect(onUpdateMembers.mock.calls[0]?.[0][0]?.portions).toEqual([]);
  });
});
