import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App, { importedMonthContext } from "./App";
import { sync } from "./app/syncState";
import { computeMonthSummary, reviewQueue } from "./domain/summary";
import type { AppData } from "./domain/types";
import { emptyData } from "./storage/schema";
import { AuthGate } from "./ui/AuthGate";
import { ClearTransactionsModal, isClearTransactionsConfirmation } from "./ui/ClearTransactionsModal";
import { CsvImportModal } from "./ui/CsvImportModal";
import { HomeView } from "./ui/HomeView";
import { ImportModal } from "./ui/ImportModal";
import { IncomeConfirmModal } from "./ui/IncomeConfirmModal";
import { ManualModal } from "./ui/ManualModal";
import { OnboardingView } from "./ui/OnboardingView";
import { isResetConfirmation, ResetHouseholdModal } from "./ui/ResetHouseholdModal";
import { SettingsModal } from "./ui/SettingsModal";
import { SplitModal } from "./ui/SplitModal";
import { SharedContributionModal } from "./ui/SharedContributionModal";
import { TransactionsView } from "./ui/TransactionsView";

function threeMemberData(): AppData {
  const data = emptyData();
  data.settings.members = [
    { id: "a", name: "Ana", color: "#5b8cff", portions: [{ id: "pa", label: "Monthly income", amount: 500000, currency: "USD", taxRate: 0, taxWithheld: true, window: null, schedule: { frequency: "monthly" }, budgetTreatment: "ordinary" }] },
    { id: "b", name: "Ben", color: "#ff80b5", portions: [{ id: "pb", label: "Monthly income", amount: 400000, currency: "USD", taxRate: 0, taxWithheld: true, window: null, schedule: { frequency: "monthly" }, budgetTreatment: "ordinary" }] },
    { id: "c", name: "Cyd", color: "#f2b84b", portions: [{ id: "pc", label: "Monthly income", amount: 300000, currency: "USD", taxRate: 0, taxWithheld: true, window: null, schedule: { frequency: "monthly" }, budgetTreatment: "ordinary" }] },
  ];
  data.settings.currency = "USD";
  data.settings.locale = "en-US";
  data.accounts = [
    { id: "aa", label: "Ana Card", owner: "a", beneficiaryDefault: "review", match: [] },
    { id: "bb", label: "Ben Card", owner: "b", beneficiaryDefault: "review", match: [] },
  ];
  data.transactions = [
    { id: "t1", date: "2026-07-01", description: "RENT SHARE", amount: 90000, category: "housing", beneficiary: { type: "household" }, account: "Ana Card", note: "", source: "imported", direction: "debit", kind: "expense" },
    { id: "t2", date: "2026-07-02", description: "GIFT FOR CYD", amount: 30000, category: "lifestyle", beneficiary: { type: "member", memberId: "c" }, account: "Ben Card", note: "", source: "imported", direction: "debit", kind: "expense" },
    { id: "t3", date: "2026-07-03", description: "UNKNOWN SHOP", amount: 12000, category: "uncategorized", beneficiary: { type: "unassigned" }, account: "Ben Card", note: "", source: "imported", direction: "debit", kind: "expense" },
  ];
  return data;
}

describe("import month presentation", () => {
  it("lands on the newest imported month while listing every affected month", () => {
    const context = importedMonthContext([
      ...Array.from({ length: 19 }, (_, index) => ({ date: `2025-12-${String(index + 1).padStart(2, "0")}` })),
      ...Array.from({ length: 5 }, (_, index) => ({ date: `2026-01-${String(index + 1).padStart(2, "0")}` })),
    ]);
    expect(context.latest).toBe("2026-01");
    expect(context.spreadNotice).toBe("They span 2 months: Dec 2025 (19), Jan 2026 (5).");
  });

  it("leaves duplicate-only imports without a replacement month", () => {
    expect(importedMonthContext([])).toEqual({ latest: "", spreadNotice: "" });
  });
});

describe("UI render smoke", () => {
  it("renders onboarding without throwing", () => {
    expect(() =>
      renderToString(
        <OnboardingView
          sync={{ auth: { status: "signed-out", user: null, error: "" }, mode: "none", status: sync.idle("Sign in to use Firestore"), household: null, households: [] }}
          onSignIn={() => {}}
          onOpenSettings={() => {}}
          onComplete={() => {}}
        />,
      ),
    ).not.toThrow();
    const html = renderToString(
      <OnboardingView
        sync={{ auth: { status: "unconfigured", user: null, error: "Firebase is not configured." }, mode: "none", status: sync.idle("Configure Firebase"), household: null, households: [] }}
        onSignIn={() => {}}
        onOpenSettings={() => {}}
        onComplete={() => {}}
      />,
    );
    expect(html).toContain("Members and income");
    expect(html).toContain("Add at least one named member and a currency code.");
  });

  it("renders the configured Firebase sign-in gate", () => {
    const html = renderToString(
      <AuthGate
        auth={{ status: "signed-out", user: null, error: "" }}
        notice="Google sign-in is not enabled for this Firebase project."
        onSignIn={() => {}}
      />,
    );
    expect(html).toContain("Sign in to continue");
    expect(html).toContain("Google sign-in is not enabled");
  });

  it("renders the home view with N-member settlement", () => {
    const data = threeMemberData();
    const summary = computeMonthSummary(data, "2026-07", new Date(2026, 6, 15));
    const html = renderToString(
      <HomeView
        summary={summary}
        money={(v) => `USD ${v}`}
        lastCheckInAt=""
        onOpenSettings={() => {}}
        onOpenImport={() => {}}
        onReviewQueue={() => {}}
        onCompleteCheckIn={() => {}}
        onConfirmIncome={() => {}}
      />,
    );
    expect(html).toContain("Monthly financial summary");
    expect(html).toContain("Spending and settlement");
    expect(html).toContain("Needs attention");
    expect(html).toContain("Income");
    expect(html).toContain("0 of 3 expected deposits confirmed");
    expect(html).toContain("Bring transactions up to date");
    expect(html).toContain("Review queue");
  });

  it("renders the income confirmation modal with self-paid tax guidance", () => {
    const data = threeMemberData();
    const member = data.settings.members[0]!;
    member.portions[0] = { ...member.portions[0]!, taxRate: 15, taxWithheld: false };
    const item = computeMonthSummary(data, "2026-07", new Date(2026, 6, 15)).incomeItems[0]!;
    const html = renderToString(
      <IncomeConfirmModal
        item={item}
        householdCurrency="USD"
        money={(value) => `USD ${value}`}
        onSave={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("Confirm Monthly income");
    expect(html).toContain("income-net-caption");
    expect(html).toContain("setting aside");
  });

  it("confirms a foreign income portion in the receiving account currency", () => {
    const data = threeMemberData();
    data.settings.members = [data.settings.members[0]!];
    data.settings.currency = "LKR";
    data.settings.fxRates = { USD: 332 };
    data.settings.members[0]!.portions[0] = {
      ...data.settings.members[0]!.portions[0]!,
      amount: 2200,
      currency: "USD",
      taxRate: 15,
      taxWithheld: false,
      schedule: { frequency: "monthly" },
      budgetTreatment: "ordinary",
    };
    const item = computeMonthSummary(data, "2026-07", new Date(2026, 6, 15)).incomeItems[0]!;
    const html = renderToString(
      <IncomeConfirmModal
        item={item}
        accounts={data.accounts}
        householdCurrency="LKR"
        fxRates={data.settings.fxRates}
        locale="en-LK"
        money={(value) => `LKR ${value}`}
        onSave={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toMatch(/Amount received .*USD/);
    expect(html).toMatch(/FX rate .*LKR.* per .*USD/);
    expect(html).toContain("Mizan converts it to LKR");

    data.incomeReceipts = [{
      id: "rcpt_2026-07_pa",
      month: "2026-07",
      memberId: "a",
      portionId: "pa",
      amount: 2109.8 * 332,
      receivedAmount: 2109.8,
      receivedCurrency: "USD",
      fxRate: 332,
    }];
    const confirmed = computeMonthSummary(data, "2026-07", new Date(2026, 6, 15));
    const home = renderToString(
      <HomeView
        summary={confirmed}
        money={(value) => `LKR ${Math.round(value).toLocaleString("en-US")}`}
        currencyMoney={(value, currency) => `${currency} ${Math.round(value).toLocaleString("en-US")}`}
        lastCheckInAt=""
        onOpenSettings={() => {}}
        onOpenImport={() => {}}
        onReviewQueue={() => {}}
        onCompleteCheckIn={() => {}}
        onConfirmIncome={() => {}}
      />,
    );
    expect(home).toContain("1 of 1 expected deposits confirmed");
    expect(home).toContain("LKR 595,386");
  });

  it("pauses the forecast when the current month has no activity", () => {
    const data = threeMemberData();
    data.transactions = [];
    const summary = computeMonthSummary(data, "2026-07", new Date(2026, 6, 10));
    const html = renderToString(
      <HomeView
        summary={summary}
        money={(v) => `USD ${v}`}
        lastCheckInAt=""
        onOpenSettings={() => {}}
        onOpenImport={() => {}}
        onReviewQueue={() => {}}
        onCompleteCheckIn={() => {}}
        onConfirmIncome={() => {}}
      />,
    );
    expect(html).toContain("Add activity to read this month");
    expect(html).toContain("Waiting for activity");
    expect(html).not.toContain("You are on track");
    expect(html).not.toContain("Monthly categories");
  });

  it("offers a weekly completion action only after current data is clean", () => {
    const data = threeMemberData();
    data.transactions = data.transactions
      .filter((txn) => txn.category !== "uncategorized")
      .concat({
        id: "fresh",
        date: "2026-07-15",
        description: "FRESH ACTIVITY",
        amount: 1000,
        category: "food",
        beneficiary: { type: "household" },
        account: "Ana Card",
        note: "",
        source: "manual",
        direction: "debit",
        kind: "expense",
      });
    const summary = computeMonthSummary(data, "2026-07", new Date(2026, 6, 15));
    const html = renderToString(
      <HomeView
        summary={summary}
        money={(v) => `USD ${v}`}
        lastCheckInAt=""
        onOpenSettings={() => {}}
        onOpenImport={() => {}}
        onReviewQueue={() => {}}
        onCompleteCheckIn={() => {}}
        onConfirmIncome={() => {}}
      />,
    );
    expect(html).toContain("Complete this week&#x27;s money check-in");
    expect(html).toContain("Mark reviewed");
    expect(html).not.toContain("Update first");
  });

  it("renders transactions with review placement and accessible row actions", () => {
    const data = threeMemberData();
    const summary = computeMonthSummary(data, "2026-07", new Date(2026, 6, 15));
    const html = renderToString(
      <TransactionsView
        summary={summary}
        members={data.settings.members}
        accounts={data.accounts}
        customCategories={data.settings.customCategories}
        counterparties={data.settings.counterparties}
        queue={reviewQueue(data.transactions)}
        transferCandidates={[]}
        undoLabel=""
        filters={{ category: "all", beneficiary: "all", payer: "all" }}
        onFiltersChange={() => {}}
        money={(v) => `USD ${v}`}
        transactionMoney={(_txn, v) => `USD ${v}`}
        onSetCategory={() => {}}
        onSetBeneficiary={() => {}}
        onSetKind={() => {}}
        onSetCounterparty={() => {}}
        onSetAccount={() => {}}
        onCategorizeMerchant={() => {}}
        onRememberMerchant={() => {}}
        onUndo={() => {}}
        onResetClassification={() => {}}
        onConfirmTransfer={() => {}}
        onDismissTransfer={() => {}}
        onSplit={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(html).toContain("need a default");
    expect(html).toContain('aria-label="Save merchant default for UNKNOWN SHOP"');
    expect(html).toContain("aria-label=\"Category for UNKNOWN SHOP\"");
    expect(html).toContain("aria-label=\"Open details for UNKNOWN SHOP\"");
    expect(html).toContain("Search transactions");
    expect(html).toContain("transaction-cards");
  });

  it("renders settings with the members editor", () => {
    const data = threeMemberData();
    const html = renderToString(
      <SettingsModal
        data={data}
        onUpdateMembers={() => {}}
        onUpdateTarget={() => {}}
        onUpdateCurrency={() => {}}
        onUpdateFxRates={() => {}}
        onUpdateFixedCosts={() => {}}
        onUpdateAccounts={() => {}}
        onUpsertRule={() => {}}
        onDeleteRule={() => {}}
        onUpdateCounterparties={() => {}}
        onUpdateCustomCategories={() => {}}
        sync={{
          auth: { status: "signed-in", user: { uid: "user_1", displayName: "Owner", email: "owner@example.com", photoURL: "" }, error: "" },
          mode: "cloud",
          status: sync.synced("Synced to Firestore"),
          household: {
            id: "hh_1",
            name: "Shared budget",
            ownerUid: "user_1",
            membersByUid: {},
            inviteCode: "hh_1_invite",
            createdAt: "2026-07-09T00:00:00.000Z",
            updatedAt: "2026-07-09T00:00:00.000Z",
          },
          households: [],
        }}
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
        canClearTransactions={true}
        hasTransactions={true}
        onClearTransactions={() => {}}
        canResetHousehold={true}
        hasResettableData={true}
        onResetHousehold={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("Household members");
    expect(html).toContain("Member name");
    expect(html).toContain("Add monthly deposit");
    expect(html).toContain("Add one-off income");
    expect(html).toContain("What reaches the account?");
    expect(html).toContain("How is tax handled?");
    expect(html).toContain("When does it arrive?");
    expect(html).toContain("Already deducted");
    expect(html).toContain("Mizan reserves tax first.");
    expect(html).toContain("income-member-header");
    expect(html).toContain("income-deposit-card");
    expect(html).toContain("arrival-inputs");
    expect(html).toContain("Change participation");
    expect(html).not.toContain('aria-label="Delete Ana"');
    expect(html).toContain("Accounts &amp; rules");
    expect(html).toContain("Sync &amp; backup");
    expect(html).toContain("aria-label=\"Close Settings\"");
  });

  it("renders a guarded reset summary with optional export", () => {
    const data = threeMemberData();
    data.merchantRules.SHOP = { category: "food", beneficiary: { type: "household" }, kind: "expense" };
    const html = renderToString(
      <ResetHouseholdModal
        householdName="Shared budget"
        data={data}
        onExport={() => {}}
        onReset={async () => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("This permanently clears");
    expect(html).toContain("Shared budget");
    expect(html).toContain("Export JSON");
    expect(html).toContain("Type");
    expect(html).toContain("RESET");
    expect(html).toContain("Budget members");
    expect(html).toContain("disabled=\"\"");
    expect(isResetConfirmation("RESET")).toBe(true);
    expect(isResetConfirmation("reset")).toBe(false);
    expect(isResetConfirmation(" RESET ")).toBe(false);
  });

  it("explains the transaction-only boundary and requires exact confirmation", () => {
    const data = threeMemberData();
    data.sharedContributions = [{
      id: "contribution-1",
      allocations: [{ expenseTransactionId: "t1", amount: 10 }],
      transferDebitTransactionId: "t2",
      transferCreditTransactionId: "t3",
      contributorMemberId: "b",
      amount: 10,
    }];
    data.incomeReceipts = [{
      id: "receipt-1",
      month: "2026-07",
      memberId: "a",
      portionId: "pa",
      amount: 500000,
      transactionId: "t3",
    }];
    const html = renderToString(
      <ClearTransactionsModal
        householdName="Shared budget"
        data={data}
        onExport={() => {}}
        onClear={async () => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("Clear transaction history");
    expect(html).toContain("Accounts, card and bank matching");
    expect(html).toContain("Transactions removed");
    expect(html).toContain("Contribution links removed");
    expect(html).toContain("Income links detached");
    expect(html).toContain("Export JSON");
    expect(html).toContain("disabled=\"\"");
    expect(isClearTransactionsConfirmation("CLEAR")).toBe(true);
    expect(isClearTransactionsConfirmation("clear")).toBe(false);
    expect(isClearTransactionsConfirmation(" CLEAR ")).toBe(false);
  });

  it("renders the import modal with type-first placement", () => {
    const html = renderToString(
      <ImportModal
        onImport={async () => ({ imported: 0, duplicates: 0, needsReview: 0, failures: [] })}
        onCsv={() => {}}
        onReview={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("Bank statement");
    expect(html).toContain("CSV export");
    expect(html).toContain("Files and passwords are processed in this browser");
  });

  it("renders a keyboard-submittable manual entry form with positive amount validation", () => {
    const html = renderToString(
      <ManualModal
        accounts={[]}
        members={threeMemberData().settings.members}
        customCategories={[]}
        counterparties={[]}
        onAdd={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("<form");
    expect(html).toContain('min="0.01"');
    expect(html).toContain("Who was it for?");
    expect(html).toContain('type="submit"');
  });

  it("renders the remaining CSV and split modal surfaces", () => {
    const csvHtml = renderToString(
      <CsvImportModal
        file={new File(["date,description,amount"], "activity.csv", { type: "text/csv" })}
        presets={{}}
        onImport={() => {}}
        onSavePreset={() => {}}
        onClose={() => {}}
      />,
    );
    const transaction = threeMemberData().transactions[0]!;
    const splitHtml = renderToString(
      <SplitModal txn={transaction} onSave={() => {}} onClear={() => {}} onClose={() => {}} />,
    );
    const existingSplitHtml = renderToString(
      <SplitModal txn={{ ...transaction, split: { mine: 1, of: 2 } }} onSave={() => {}} onClear={() => {}} onClose={() => {}} />,
    );
    expect(csvHtml).toContain("Import CSV");
    expect(splitHtml).toContain("Split transaction");
    expect(splitHtml).toContain("Total parts");
    expect(splitHtml).toContain("Save split");
    expect(splitHtml).toContain("Cancel");
    expect(splitHtml).not.toContain("Remove split");
    expect(existingSplitHtml).toContain("Remove split");
  });

  it("renders a guarded shared-contribution preview across partial recovery rows", () => {
    const data = threeMemberData();
    data.transactions = [
      { id: "out", date: "2026-07-01", description: "BEN CAR LOAN", amount: 45_000, category: "uncategorized", beneficiary: { type: "unassigned" }, account: "Ben Card", note: "", source: "imported", direction: "debit", kind: "expense" },
      { id: "in", date: "2026-07-01", description: "BEN CAR LOAN", amount: 45_000, category: "uncategorized", beneficiary: { type: "unassigned" }, account: "Ana Card", note: "", source: "imported", direction: "credit", kind: "account_credit" },
      { id: "loan-early", date: "2026-06-30", description: "BANK RECOVERY FOR500240015943", amount: 40_000, category: "housing", beneficiary: { type: "household" }, account: "Ana Card", note: "", source: "imported", direction: "debit", kind: "loan_payment" },
      { id: "loan-late", date: "2026-07-02", description: "BANK RECOVERY FOR500240015943", amount: 50_000, category: "housing", beneficiary: { type: "household" }, account: "Ana Card", note: "", source: "imported", direction: "debit", kind: "loan_payment" },
    ];
    const contribution = {
      id: "shared-1",
      allocations: [{ expenseTransactionId: "loan-late", amount: 45_000 }],
      transferDebitTransactionId: "out",
      transferCreditTransactionId: "in",
      contributorMemberId: "b",
      amount: 45_000,
    };
    const html = renderToString(
      <SharedContributionModal
        transactions={data.transactions}
        accounts={data.accounts}
        members={data.settings.members}
        contributions={[]}
        candidate={{
          debit: data.transactions[0]!,
          credit: data.transactions[1]!,
          expenses: [data.transactions[2]!, data.transactions[3]!],
          allocations: [{ expenseTransactionId: "loan-late", amount: 45_000 }],
          contributorMemberId: "b",
          amount: 45_000,
          daysApart: 2,
          sameMonth: true,
        }}
        money={(value) => `USD ${value}`}
        onSave={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    );
    const editHtml = renderToString(
      <SharedContributionModal
        transactions={data.transactions}
        accounts={data.accounts}
        members={data.settings.members}
        contributions={[contribution]}
        contribution={contribution}
        money={(value) => `USD ${value}`}
        onSave={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("Confirm shared contribution");
    expect(html).toContain("Ben");
    expect(html).toContain("funded");
    expect(html).toContain("USD 45000");
    expect(html).toContain("Ana");
    expect(html).toContain("USD 40000");
    expect(html).toContain("USD 5000");
    expect(html).toContain("Loan recovery deductions funded");
    expect(html).toContain("Total recovered");
    expect(html).toContain("BANK RECOVERY FOR500240015943");
    expect(editHtml).toContain("Save changes");
    expect(editHtml).toContain("Unlink contribution");
  });

  it("App requires Firebase sign-in before any household data screen", () => {
    localStorage.clear();
    expect(renderToString(<App />)).toContain("Sign in to continue");

    localStorage.setItem("mizan_v2", JSON.stringify(threeMemberData()));
    expect(renderToString(<App />)).toContain("Sign in to continue");
    localStorage.clear();
  });
});
