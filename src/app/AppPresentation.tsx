import type { ComponentProps, Dispatch, SetStateAction } from "react";
import { lazy, Suspense } from "react";
import { BarChart2, Eye, EyeOff, Home, List, Moon, Settings, Sun } from "lucide-react";
import { monthOf } from "../domain/dates";
import { eligibleCredits, type IncomeCandidate } from "../domain/incomeMatch";
import type { EfficiencyPlanInput } from "../domain/efficiency";
import type {
  Account,
  AppData,
  CategoryKey,
  Counterparty,
  CustomCategory,
  EfficiencyOpportunity,
  EfficiencyOutcomeResult,
  IncomeReceipt,
  Member,
  MemberId,
  MerchantRule,
  MovementKind,
  SharedContribution,
  SpendBeneficiary,
  Split,
  Transaction,
} from "../domain/types";
import { hasLocalFinancialData } from "../household/households";
import type { ImportResult } from "../ui/ImportModal";
import type { ManualEntry } from "../ui/ManualModal";
import { AuthGate } from "../ui/AuthGate";
import { Alert, Button, ConfirmDialog, IconButton, PageHeader, Skeleton } from "../ui/bits";
import { ConflictRecoveryDialog } from "../ui/ConflictRecoveryDialog";
import { CreateHouseholdDialog, JoinHouseholdDialog } from "../ui/HouseholdDialogs";
import { isSyncProblem, syncChipLabel } from "./syncState";
import { HomeView } from "../ui/HomeView";
import { MonthNavigator } from "../ui/MonthNavigator";
import { OnboardingView } from "../ui/OnboardingView";
import { TransactionsView } from "../ui/TransactionsView";
import type { AppDerivedState } from "./useAppDerivedState";
import type { HouseholdSession, View } from "./useHouseholdSession";
import { EMPTY_LEDGER_FILTERS } from "./useHouseholdSession";

// History, Settings, import tooling, and the secondary modals are split into
// their own chunks so their code (and heavy dependencies such as the statement
// parsers) is fetched only when a user opens the matching screen or modal.
const HistoryView = lazy(() => import("../ui/HistoryView").then((m) => ({ default: m.HistoryView })));
const SettingsModal = lazy(() => import("../ui/SettingsModal").then((m) => ({ default: m.SettingsModal })));
const ClearTransactionsModal = lazy(() => import("../ui/ClearTransactionsModal").then((m) => ({ default: m.ClearTransactionsModal })));
const ResetHouseholdModal = lazy(() => import("../ui/ResetHouseholdModal").then((m) => ({ default: m.ResetHouseholdModal })));
const ImportModal = lazy(() => import("../ui/ImportModal").then((m) => ({ default: m.ImportModal })));
const CsvImportModal = lazy(() => import("../ui/CsvImportModal").then((m) => ({ default: m.CsvImportModal })));
const ManualModal = lazy(() => import("../ui/ManualModal").then((m) => ({ default: m.ManualModal })));
const IncomeConfirmModal = lazy(() => import("../ui/IncomeConfirmModal").then((m) => ({ default: m.IncomeConfirmModal })));
const OneOffIncomeModal = lazy(() => import("../ui/OneOffIncomeModal").then((m) => ({ default: m.OneOffIncomeModal })));
const SharedContributionModal = lazy(() => import("../ui/SharedContributionModal").then((m) => ({ default: m.SharedContributionModal })));
const SplitModal = lazy(() => import("../ui/SplitModal").then((m) => ({ default: m.SplitModal })));
const EfficiencyOutcomeModal = lazy(() => import("../ui/EfficiencyModal").then((m) => ({ default: m.EfficiencyOutcomeModal })));
const EfficiencyReviewModal = lazy(() => import("../ui/EfficiencyModal").then((m) => ({ default: m.EfficiencyReviewModal })));

export type ModalKind = null | "import" | "manual" | "settings" | "one-off-income" | "clear-transactions" | "reset";

interface UndoChange {
  label: string;
  before: AppData;
  householdId: string;
}

interface PresentationUiState {
  modal: ModalKind;
  setModal: Dispatch<SetStateAction<ModalKind>>;
  pendingBackup: AppData | null;
  setPendingBackup: Dispatch<SetStateAction<AppData | null>>;
  splitTxn: Transaction | null;
  setSplitTxn: Dispatch<SetStateAction<Transaction | null>>;
  incomeConfirm: { item: ComponentProps<typeof IncomeConfirmModal>["item"]; candidate?: IncomeCandidate } | null;
  setIncomeConfirm: Dispatch<SetStateAction<{ item: ComponentProps<typeof IncomeConfirmModal>["item"]; candidate?: IncomeCandidate } | null>>;
  contributionConfirm: {
    candidate?: ComponentProps<typeof SharedContributionModal>["candidate"];
    expenseId?: string;
    contribution?: SharedContribution;
  } | null;
  setContributionConfirm: Dispatch<SetStateAction<{
    candidate?: ComponentProps<typeof SharedContributionModal>["candidate"];
    expenseId?: string;
    contribution?: SharedContribution;
  } | null>>;
  efficiencyReview: EfficiencyOpportunity | null;
  setEfficiencyReview: Dispatch<SetStateAction<EfficiencyOpportunity | null>>;
  efficiencyVerification: EfficiencyOpportunity | null;
  setEfficiencyVerification: Dispatch<SetStateAction<EfficiencyOpportunity | null>>;
  csvFile: File | null;
  setCsvFile: Dispatch<SetStateAction<File | null>>;
  dismissedTransfers: Dispatch<SetStateAction<Set<string>>>;
  undoChange: UndoChange | null;
}

interface PresentationActions {
  updateMembers: (members: Member[]) => void;
  updateAccounts: (accounts: Account[]) => void;
  deleteRule: (merchant: string) => void;
  updateCounterparties: (counterparties: Counterparty[]) => void;
  updateCustomCategories: (categories: CustomCategory[]) => void;
  exportBackup: () => void;
  importBackup: (file: File) => void;
  confirmBackupImport: () => Promise<void>;
  clearAllData: () => void;
  addManual: (entry: ManualEntry) => void;
  importStatements: ComponentProps<typeof ImportModal>["onImport"];
  ingestTransactions: (transactions: Transaction[], failures: string[], notes?: string[]) => ImportResult;
  setTransactionCategory: (id: string, category: CategoryKey) => void;
  setTransactionBeneficiary: (id: string, beneficiary: SpendBeneficiary) => void;
  setTransactionKind: (id: string, kind: MovementKind) => void;
  setTransactionCounterparty: (id: string, counterpartyId: string | undefined) => void;
  setTransactionAccount: (id: string, accountId: string) => void;
  categorizeMerchant: (merchant: string, rule: MerchantRule) => void;
  rememberTransactionMerchant: (id: string) => void;
  undoLastLedgerChange: () => void;
  resetTransactionClassification: (id: string) => void;
  confirmTransfer: (debitId: string, creditId: string) => void;
  removeTransaction: (id: string) => void;
  completeWeeklyCheckIn: () => void;
  saveEfficiencyDecision: (opportunity: EfficiencyOpportunity, input: EfficiencyPlanInput) => void;
  verifyEfficiencyOutcome: (opportunity: EfficiencyOpportunity, result: EfficiencyOutcomeResult) => void;
  saveSplit: (id: string, split: Split) => void;
  clearSplit: (id: string) => void;
  recordIncomeReceipts: (receipts: IncomeReceipt[]) => void;
  removeIncomeConfirmation: (month: string, memberId: MemberId, portionId: string) => void;
  unlinkIncomeEvidence: (transactionId: string) => void;
  addOneOffIncome: ComponentProps<typeof OneOffIncomeModal>["onSave"];
  saveSharedContribution: ComponentProps<typeof SharedContributionModal>["onSave"];
  removeSharedContribution: ComponentProps<typeof SharedContributionModal>["onRemove"];
}

export interface AppPresentationModel {
  session: HouseholdSession;
  derived: AppDerivedState;
  ui: PresentationUiState;
  actions: PresentationActions;
}

const VIEW_TITLES: Record<View, string> = {
  home: "Money check-in",
  transactions: "Transactions",
  history: "Month by month",
};

const VIEW_DESCRIPTIONS: Record<View, string> = {
  home: "Weekly review of what spending was for, who benefited, and who paid.",
  transactions: "Review purpose and beneficiary, then filter the ledger by payer or account.",
  history: "Save-rate trend and month-by-month movement.",
};

const NAV_ITEMS = [
  ["home", "Home", Home],
  ["transactions", "Transactions", List],
  ["history", "History", BarChart2],
] as const;

function SettingsOverlays({ model }: { model: AppPresentationModel }) {
  const {
    auth, repository, data, setData, legacyPresent, householdMeta, availableHouseholds, syncStatus,
    clearActiveHouseholdTransactions, resetActiveHousehold, setHouseholdDialog,
    switchHousehold, rotateInvite, handleSignIn, handleSignOut,
  } = model.session;
  const { modal, setModal, pendingBackup, setPendingBackup } = model.ui;
  const {
    updateMembers, updateAccounts, deleteRule, updateCounterparties, updateCustomCategories,
    exportBackup, importBackup, confirmBackupImport, clearAllData,
  } = model.actions;
  const canResetHousehold = auth.status === "signed-in"
    && Boolean(householdMeta)
    && householdMeta?.ownerUid === auth.user.uid;
  const settingsProps: ComponentProps<typeof SettingsModal> = {
    data,
    onUpdateMembers: updateMembers,
    onUpdateTarget: (targetSaveRate) =>
      setData((previous) => ({ ...previous, settings: { ...previous.settings, targetSaveRate } })),
    onUpdateCurrency: (currency, locale) =>
      setData((previous) => ({ ...previous, settings: { ...previous.settings, currency, locale } })),
    onUpdateFxRates: (fxRates) =>
      setData((previous) => ({ ...previous, settings: { ...previous.settings, fxRates } })),
    onUpdateFixedCosts: (fixedCosts) => setData((previous) => ({ ...previous, fixedCosts })),
    onUpdateAccounts: updateAccounts,
    onDeleteRule: deleteRule,
    onUpdateCounterparties: updateCounterparties,
    onUpdateCustomCategories: updateCustomCategories,
    sync: {
      auth,
      mode: repository!.mode,
      status: syncStatus,
      household: householdMeta,
      households: availableHouseholds,
    },
    onSignIn: handleSignIn,
    onSignOut: handleSignOut,
    onCreateHousehold: () => setHouseholdDialog("create"),
    onJoinHousehold: () => setHouseholdDialog("join"),
    onSwitchHousehold: switchHousehold,
    onRotateInvite: rotateInvite,
    onExport: exportBackup,
    onImportBackup: importBackup,
    hasLegacyBrowserData: legacyPresent,
    onClearData: clearAllData,
    canClearTransactions: canResetHousehold,
    hasTransactions: data.transactions.length > 0,
    onClearTransactions: () => setModal("clear-transactions"),
    canResetHousehold,
    hasResettableData: hasLocalFinancialData(data),
    onResetHousehold: () => setModal("reset"),
    onClose: () => setModal(null),
  };

  return (
    <Suspense fallback={null}>
      {modal === "settings" && repository && <SettingsModal {...settingsProps} />}
      {modal === "clear-transactions" && householdMeta && canResetHousehold && data.transactions.length > 0 && (
        <ClearTransactionsModal
          householdName={householdMeta.name}
          data={data}
          onExport={exportBackup}
          onClear={clearActiveHouseholdTransactions}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "reset" && householdMeta && canResetHousehold && (
        <ResetHouseholdModal
          householdName={householdMeta.name}
          data={data}
          onExport={exportBackup}
          onReset={resetActiveHousehold}
          onClose={() => setModal(null)}
        />
      )}
      {pendingBackup && (
        <ConfirmDialog
          title="Replace household from backup?"
          confirmLabel="Import and replace"
          onClose={() => setPendingBackup(null)}
          onConfirm={() => void confirmBackupImport()}
        >
          <p>
            This verified backup contains {pendingBackup.transactions.length} transactions, {pendingBackup.accounts.length} accounts,
            {" "}{pendingBackup.settings.members.length} members, {pendingBackup.fixedCosts.length} commitments, and
            {" "}{Object.keys(pendingBackup.merchantRules).length} merchant rules. It will become the authoritative Firestore household.
          </p>
          <p>Export the current household first if you may need to restore it.</p>
        </ConfirmDialog>
      )}
    </Suspense>
  );
}

function HouseholdGate({ model }: { model: AppPresentationModel }) {
  const {
    legacyPresent, notice, availableHouseholds, syncStatus, bootstrapPhase, bootstrapError,
    retryBootstrap, setHouseholdDialog, switchHousehold, handleSignOut,
  } = model.session;
  const loadingProfile = bootstrapPhase === "idle" || bootstrapPhase === "loading-profile";
  const loadingHousehold = bootstrapPhase === "loading-household";
  const needsHousehold = bootstrapPhase === "needs-household";
  const failedBootstrap = bootstrapPhase === "error";

  return (
    <main className="app onboarding">
      <section className="home-hero tight onboard-wide auth-gate">
        <div className="onboard-intro">
          <div className="wordmark"><span className="wordmark-mark">M</span><span>Mizan</span></div>
          <h1>{needsHousehold ? "Choose a Firestore household" : failedBootstrap ? "Could not open your household" : "Getting Mizan ready"}</h1>
          <p>
            {needsHousehold
              ? "Mizan stores financial data in a signed-in Firestore household. Create one for this budget or join an existing household with an invite code."
              : failedBootstrap
                ? "Your signed-in session is still active, but Mizan could not finish loading the household data. Nothing was replaced or cleared."
                : "Your session is ready. Mizan is securely loading the active household from Firestore."}
          </p>
          {legacyPresent && needsHousehold && (
            <div className="notice">
              Legacy browser financial data was found. Create a new household to migrate it safely; joining or switching
              will never overwrite an existing household.
            </div>
          )}
          {failedBootstrap && bootstrapError && <div className="notice" role="alert">{bootstrapError}</div>}
          {notice && !failedBootstrap && <div className="notice" role="status" aria-live="polite">{notice}</div>}
        </div>
        <div className="auth-panel">
          <span className="soft-label">Firestore</span>
          <strong>
            {loadingProfile
              ? "Loading cloud profile"
              : loadingHousehold
                ? "Loading household data"
                : failedBootstrap ? "Household load interrupted" : syncStatus.message}
          </strong>
          <p className="muted">Raw statement files and passwords stay on this device while imports are processed.</p>
          {(loadingProfile || loadingHousehold) && (
            <Skeleton label={loadingProfile ? "Loading cloud profile" : "Loading household data"} />
          )}
          {needsHousehold && (
            <div className="sync-actions sync-main-actions">
              <Button variant="primary" onClick={() => setHouseholdDialog("create")}>Create household</Button>
              <Button variant="secondary" onClick={() => setHouseholdDialog("join")}>Join with invite</Button>
            </div>
          )}
          {failedBootstrap && (
            <div className="sync-actions sync-main-actions">
              <Button variant="primary" onClick={retryBootstrap}>Retry household load</Button>
              <Button variant="secondary" onClick={() => setHouseholdDialog("create")}>Create household</Button>
              <Button variant="secondary" onClick={() => setHouseholdDialog("join")}>Join with invite</Button>
              <Button variant="secondary" onClick={handleSignOut}>Sign out</Button>
            </div>
          )}
          {(needsHousehold || failedBootstrap) && availableHouseholds.length > 0 && (
            <label className="field">
              <span>Existing household</span>
              <select defaultValue="" onChange={(event) => switchHousehold(event.target.value)}>
                <option value="" disabled>Choose household</option>
                {availableHouseholds.map((household) => (
                  <option key={household.householdId} value={household.householdId}>
                    {household.name} ({household.role})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>
    </main>
  );
}

function OnboardingPresentation({ model }: { model: AppPresentationModel }) {
  const { auth, repository, setData, householdMeta, availableHouseholds, syncStatus, handleSignIn } = model.session;
  return (
    <>
      <OnboardingView
        sync={{ auth, mode: repository!.mode, status: syncStatus, household: householdMeta, households: availableHouseholds }}
        onSignIn={handleSignIn}
        onOpenSettings={() => model.ui.setModal("settings")}
        onComplete={(result) => setData((previous) => ({ ...previous, settings: { ...previous.settings, ...result } }))}
      />
      <SettingsOverlays model={model} />
    </>
  );
}

function WorkspaceContent({ model }: { model: AppPresentationModel }) {
  const {
    data, view, setView, setMonth, privacy, setPrivacy, theme, setTheme, ledgerFilters, setLedgerFilters,
    lastCheckInByHousehold, notice, householdMeta, syncStatus,
  } = model.session;
  const {
    todayMonth, navigationMonths, currentMonth, summary, efficiency, queue, history, transferCandidates,
    contributionCandidates, incomeCandidateMap, incomeLinkedIds, money, currencyMoney, transactionMoney, percent,
  } = model.derived;
  const {
    setModal, setSplitTxn, setIncomeConfirm, setContributionConfirm, setEfficiencyReview,
    setEfficiencyVerification, dismissedTransfers: setDismissedTransfers, undoChange,
  } = model.ui;
  const {
    setTransactionCategory, setTransactionBeneficiary, setTransactionKind, setTransactionCounterparty,
    setTransactionAccount, categorizeMerchant, rememberTransactionMerchant, undoLastLedgerChange,
    resetTransactionClassification, confirmTransfer, removeTransaction, completeWeeklyCheckIn,
  } = model.actions;
  const syncHasError = isSyncProblem(syncStatus);
  const syncLabel = syncChipLabel(syncStatus);

  return (
    <>
      <header className="topbar">
        <div className="shell-inner topbar-inner">
          <div className="wordmark"><span className="wordmark-mark">M</span><span>Mizan</span></div>
          <nav className="primary-nav" aria-label="Primary">
            {NAV_ITEMS.map(([id, label, Icon]) => (
              <button
                key={id}
                className={`nav-item ${view === id ? "active" : ""}`}
                aria-current={view === id ? "page" : undefined}
                onClick={() => setView(id)}
              >
                <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
                <span>{label}</span>
                {id === "transactions" && summary.reviewQueueCount > 0 && (
                  <b className="nav-badge" aria-label={`${summary.reviewQueueCount} transactions need review`}>
                    {summary.reviewQueueCount}
                  </b>
                )}
              </button>
            ))}
          </nav>
          <div className="utility-actions">
            <button
              className={`sync-chip ${syncHasError ? "sync-error" : ""}`}
              title={syncStatus.message}
              onClick={() => setModal("settings")}
            >
              {syncLabel}
            </button>
            <IconButton
              label={theme === "dark" ? "Use light mode" : "Use dark mode"}
              icon={theme === "dark" ? Sun : Moon}
              onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
            />
            <IconButton
              label={privacy ? "Show financial values" : "Hide financial values"}
              icon={privacy ? Eye : EyeOff}
              onClick={() => setPrivacy((value) => !value)}
            />
            <IconButton label="Settings" icon={Settings} onClick={() => setModal("settings")} />
          </div>
        </div>
      </header>
      <section className="workspace">
        <PageHeader
          eyebrow={data.settings.members.map((member) => member.name).join(" + ") || "Household"}
          title={VIEW_TITLES[view]}
          description={VIEW_DESCRIPTIONS[view]}
          actions={
            <>
              <MonthNavigator value={currentMonth} months={navigationMonths} todayMonth={todayMonth} onChange={setMonth} />
              {view === "home" && (
                <>
                  <Button variant="secondary" onClick={() => setModal("manual")}>Add transaction</Button>
                  <Button variant="primary" onClick={() => setModal("import")}>Import activity</Button>
                </>
              )}
              {view === "transactions" && (
                <>
                  <Button variant="secondary" onClick={() => setModal("import")}>Import activity</Button>
                  <Button variant="primary" onClick={() => setModal("manual")}>Add transaction</Button>
                </>
              )}
            </>
          }
        />
        {notice && (
          <Alert tone={/failed|could not|error/i.test(notice) ? "danger" : "success"} live className="workspace-alert">
            {notice}
          </Alert>
        )}
        {view === "home" && (
          <HomeView
            summary={summary}
            money={money}
            currencyMoney={currencyMoney}
            percent={percent}
            financialValuesHidden={privacy}
            lastCheckInAt={householdMeta ? (lastCheckInByHousehold[householdMeta.id] ?? "") : ""}
            onOpenSettings={() => setModal("settings")}
            onOpenImport={() => setModal("import")}
            onReviewQueue={() => {
              setLedgerFilters(EMPTY_LEDGER_FILTERS);
              setView("transactions");
            }}
            onCompleteCheckIn={completeWeeklyCheckIn}
            incomeCandidates={incomeCandidateMap}
            onConfirmIncome={(item, candidate) => setIncomeConfirm({ item, ...(candidate ? { candidate } : {}) })}
            onAddOneOffIncome={() => setModal("one-off-income")}
            contributionCandidates={contributionCandidates.filter((candidate) =>
              candidate.expenses.some((expense) => monthOf(expense.date) === currentMonth))}
            members={data.settings.members}
            onConfirmContribution={(candidate) => setContributionConfirm({ candidate })}
            efficiency={efficiency}
            onReviewEfficiency={setEfficiencyReview}
            onVerifyEfficiency={setEfficiencyVerification}
            onOpenTransactions={(filters) => {
              setLedgerFilters({
                category: filters.category ?? "all",
                beneficiary: filters.beneficiary
                  ? filters.beneficiary === "household" || filters.beneficiary === "unassigned"
                    ? filters.beneficiary
                    : `member:${filters.beneficiary}`
                  : "all",
                payer: filters.payer
                  ? filters.payer === "joint" ? "joint" : `member:${filters.payer}`
                  : "all",
                merchant: filters.merchant,
                spendOnly: true,
              });
              setView("transactions");
            }}
          />
        )}
        {view === "transactions" && (
          <TransactionsView
            summary={summary}
            members={data.settings.members}
            accounts={data.accounts}
            customCategories={data.settings.customCategories}
            counterparties={data.settings.counterparties}
            queue={queue}
            transferCandidates={transferCandidates}
            undoLabel={undoChange?.householdId === (householdMeta?.id ?? "") ? undoChange.label : ""}
            filters={ledgerFilters}
            onFiltersChange={setLedgerFilters}
            money={money}
            transactionMoney={transactionMoney}
            financialValuesHidden={privacy}
            onSetCategory={setTransactionCategory}
            onSetBeneficiary={setTransactionBeneficiary}
            onSetKind={setTransactionKind}
            onSetCounterparty={setTransactionCounterparty}
            onSetAccount={setTransactionAccount}
            onCategorizeMerchant={categorizeMerchant}
            onRememberMerchant={rememberTransactionMerchant}
            onUndo={undoLastLedgerChange}
            onResetClassification={resetTransactionClassification}
            onConfirmTransfer={confirmTransfer}
            onDismissTransfer={(debitId, creditId) =>
              setDismissedTransfers((previous) => new Set(previous).add(`${debitId}:${creditId}`))}
            onSplit={setSplitTxn}
            onRemove={removeTransaction}
            incomeLinkedIds={incomeLinkedIds}
            allTransactions={data.transactions}
            sharedContributions={data.sharedContributions}
            onLinkContribution={(expenseId) => setContributionConfirm({ expenseId })}
            onEditContribution={(contribution) => setContributionConfirm({ contribution })}
            onOpenImport={() => setModal("import")}
            onAddTransaction={() => setModal("manual")}
          />
        )}
        {view === "history" && (
          <Suspense fallback={<Skeleton label="Loading history" />}>
            <HistoryView
              rows={history}
              currentMonth={currentMonth}
              targetSaveRate={summary.targetSaveRate}
              money={money}
              percent={percent}
              financialValuesHidden={privacy}
              efficiencyPlans={data.efficiencyPlans}
              onSelectMonth={setMonth}
            />
          </Suspense>
        )}
      </section>
    </>
  );
}

function WorkspaceModals({ model }: { model: AppPresentationModel }) {
  const { data, setData, privacy, setView, setLedgerFilters } = model.session;
  const {
    todayMonth, currentMonth, summary, money, currencyMoney, transactionMoney,
  } = model.derived;
  const {
    modal, setModal, csvFile, setCsvFile, splitTxn, setSplitTxn, incomeConfirm, setIncomeConfirm,
    contributionConfirm, setContributionConfirm, efficiencyReview, setEfficiencyReview,
    efficiencyVerification, setEfficiencyVerification,
  } = model.ui;
  const {
    importStatements, ingestTransactions, addManual, saveEfficiencyDecision, verifyEfficiencyOutcome,
    saveSplit, clearSplit, recordIncomeReceipts, removeIncomeConfirmation, unlinkIncomeEvidence,
    addOneOffIncome, saveSharedContribution, removeSharedContribution,
  } = model.actions;

  return (
    <Suspense fallback={null}>
      {modal === "import" && (
        <ImportModal
          onImport={importStatements}
          onCsv={(file) => {
            setModal(null);
            setCsvFile(file);
          }}
          onReview={() => {
            setModal(null);
            setLedgerFilters(EMPTY_LEDGER_FILTERS);
            setView("transactions");
          }}
          onClose={() => setModal(null)}
        />
      )}
      {csvFile && (
        <CsvImportModal
          file={csvFile}
          presets={data.settings.csvPresets}
          formatAmount={(transaction) =>
            `${transaction.direction === "credit" && !privacy ? "+" : ""}${transactionMoney(transaction, transaction.amount)}`}
          onImport={(transactions, skipped) =>
            ingestTransactions(transactions, [], skipped ? [`${skipped} CSV row${skipped === 1 ? "" : "s"} skipped.`] : [])}
          onSavePreset={(signature, mapping) =>
            setData((previous) => ({
              ...previous,
              settings: { ...previous.settings, csvPresets: { ...previous.settings.csvPresets, [signature]: mapping } },
            }))}
          onClose={() => setCsvFile(null)}
        />
      )}
      {modal === "manual" && (
        <ManualModal
          accounts={data.accounts}
          members={data.settings.members}
          customCategories={data.settings.customCategories}
          counterparties={data.settings.counterparties}
          onAdd={addManual}
          onClose={() => setModal(null)}
        />
      )}
      {efficiencyReview && (
        <EfficiencyReviewModal
          opportunity={efficiencyReview}
          existingPlan={efficiencyReview.planId
            ? data.efficiencyPlans.find((plan) => plan.id === efficiencyReview.planId)
            : undefined}
          contextMonth={currentMonth}
          todayMonth={todayMonth}
          money={money}
          onSave={(input) => saveEfficiencyDecision(efficiencyReview, input)}
          onClose={() => setEfficiencyReview(null)}
        />
      )}
      {efficiencyVerification
        && efficiencyVerification.planId
        && data.efficiencyPlans.find((plan) => plan.id === efficiencyVerification.planId) && (
        <EfficiencyOutcomeModal
          opportunity={efficiencyVerification}
          plan={data.efficiencyPlans.find((plan) => plan.id === efficiencyVerification.planId)!}
          money={money}
          onConfirm={(result) => verifyEfficiencyOutcome(efficiencyVerification, result)}
          onClose={() => setEfficiencyVerification(null)}
        />
      )}
      {splitTxn && (
        <SplitModal txn={splitTxn} onSave={saveSplit} onClear={clearSplit} onClose={() => setSplitTxn(null)} />
      )}
      {incomeConfirm && (
        <IncomeConfirmModal
          item={incomeConfirm.item}
          allocationItems={summary.incomeItems.filter((item) => item.memberId === incomeConfirm.item.memberId)}
          candidate={incomeConfirm.candidate}
          linkedTransaction={data.transactions.find((transaction) =>
            transaction.id === (incomeConfirm.item.receipt?.transactionId ?? incomeConfirm.candidate?.transaction.id))}
          alternatives={eligibleCredits(
            incomeConfirm.item.portion,
            incomeConfirm.item.memberId,
            data.transactions,
            data.accounts,
            data.incomeReceipts,
            incomeConfirm.item.month,
          )}
          accounts={data.accounts}
          householdCurrency={data.settings.currency}
          fxRates={data.settings.fxRates}
          locale={data.settings.locale}
          money={money}
          currencyMoney={currencyMoney}
          onSave={recordIncomeReceipts}
          onRemove={() =>
            removeIncomeConfirmation(incomeConfirm.item.month, incomeConfirm.item.memberId, incomeConfirm.item.portion.id)}
          onUnlinkEvidence={unlinkIncomeEvidence}
          onClose={() => setIncomeConfirm(null)}
        />
      )}
      {modal === "one-off-income" && (
        <OneOffIncomeModal
          members={data.settings.members}
          month={currentMonth}
          householdCurrency={data.settings.currency}
          onSave={addOneOffIncome}
          onClose={() => setModal(null)}
        />
      )}
      {contributionConfirm && (
        <SharedContributionModal
          transactions={data.transactions}
          accounts={data.accounts}
          members={data.settings.members}
          contributions={data.sharedContributions}
          candidate={contributionConfirm.candidate}
          expenseId={contributionConfirm.expenseId}
          contribution={contributionConfirm.contribution}
          money={money}
          onSave={saveSharedContribution}
          onRemove={removeSharedContribution}
          onClose={() => setContributionConfirm(null)}
        />
      )}
    </Suspense>
  );
}

export function AppPresentation({ model }: { model: AppPresentationModel }) {
  const {
    auth, repository, data, notice, handleSignIn, conflict, resolveConflict,
    householdDialog, setHouseholdDialog, createHousehold, joinHousehold,
    willMigrateLegacyData, householdNameSuggestion,
  } = model.session;
  const content = auth.status !== "signed-in"
    ? <AuthGate auth={auth} notice={notice} onSignIn={handleSignIn} />
    : !repository
      ? <HouseholdGate model={model} />
      : !data.settings.members.length
        ? <OnboardingPresentation model={model} />
        : (
          <main className="app">
            <WorkspaceContent model={model} />
            <WorkspaceModals model={model} />
            <SettingsOverlays model={model} />
          </main>
        );
  return (
    <>
      {content}
      {conflict && <ConflictRecoveryDialog conflict={conflict} onResolve={resolveConflict} />}
      {householdDialog === "create" && (
        <CreateHouseholdDialog
          suggestion={householdNameSuggestion}
          willMigrateLegacyData={willMigrateLegacyData}
          onCreate={createHousehold}
          onClose={() => setHouseholdDialog(null)}
        />
      )}
      {householdDialog === "join" && (
        <JoinHouseholdDialog onJoin={joinHousehold} onClose={() => setHouseholdDialog(null)} />
      )}
    </>
  );
}
