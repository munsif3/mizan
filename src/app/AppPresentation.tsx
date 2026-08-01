import type { ComponentProps, Dispatch, SetStateAction } from "react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Eye, EyeOff, Moon, Settings, Sun } from "lucide-react";
import { monthOf } from "../domain/dates";
import type { Transfer } from "../domain/summary";
import { eligibleCredits, type IncomeCandidate } from "../domain/incomeMatch";
import type { EfficiencyPlanInput } from "../domain/efficiency";
import type {
  Account,
  AppData,
  AssetHolding,
  CategoryKey,
  Counterparty,
  CustomCategory,
  EfficiencyOpportunity,
  EfficiencyOutcomeResult,
  EfficiencyPlan,
  FixedCost,
  IncomeReceipt,
  Member,
  MemberId,
  MerchantRule,
  MovementKind,
  SharedContribution,
  SpendBeneficiary,
  Split,
  Transaction,
  WeeklyClose as WeeklyCloseRecord,
  WeeklyCloseStep,
} from "../domain/types";
import { firstIncompleteWeeklyCloseStep, WEEKLY_CLOSE_STEP_IDS, weeklyCloseId, weeklyCloseIsClosed, weeklyCloseStreak, weeklyCloseWeekIso, weeklyCloseWeekNumber } from "../domain/weeklyClose";
import { hasLocalFinancialData } from "../household/households";
import type { ImportResult } from "../ui/ImportModal";
import type { AccountCoverageConfirmation } from "../ui/AccountCoverageConfirm";
import type { ManualEntry } from "../ui/ManualModal";
import { AuthGate } from "../ui/AuthGate";
import { Alert, Button, ConfirmDialog, IconButton, PageHeader, Skeleton } from "../ui/bits";
import { ConflictRecoveryDialog } from "../ui/ConflictRecoveryDialog";
import { CreateHouseholdDialog, JoinHouseholdDialog } from "../ui/HouseholdDialogs";
import { isSyncProblem, syncChipLabel } from "./syncState";
import { AppRail } from "../ui/AppRail";
import { BalanceConfidenceChip, BalanceView } from "../ui/BalanceView";
import { BooksView } from "../ui/BooksView";
import { CatchUpView } from "../ui/CatchUpView";
import type { HomeViewProps } from "../ui/HomeView";
import { MonthNavigator } from "../ui/MonthNavigator";
import { OnboardingView } from "../ui/OnboardingView";
import { SortView } from "../ui/SortView";
import { WeeklyClose } from "../ui/WeeklyClose";
import { WeeklyReceipt, type WeeklyReceiptValues } from "../ui/WeeklyReceipt";
import { TransactionsView } from "../ui/TransactionsView";
import type { AppDerivedState } from "./useAppDerivedState";
import type { HouseholdSession, View } from "./useHouseholdSession";
import { EMPTY_LEDGER_FILTERS } from "./useHouseholdSession";
import {
  DEFAULT_SETTINGS_TARGET,
  type SettingsTarget,
} from "./settingsTarget";

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
const BackupPasswordDialog = lazy(() => import("../ui/BackupPasswordDialog").then((m) => ({ default: m.BackupPasswordDialog })));

type SimpleModalKind = "import" | "manual" | "one-off-income" | "clear-transactions" | "reset";

export type ModalState =
  | null
  | { kind: SimpleModalKind; accountId?: string }
  | { kind: "settings"; target: SettingsTarget };

interface UndoChange {
  label: string;
  before: AppData;
  householdId: string;
}

interface PresentationUiState {
  modal: ModalState;
  setModal: Dispatch<SetStateAction<ModalState>>;
  pendingBackup: AppData | null;
  setPendingBackup: Dispatch<SetStateAction<AppData | null>>;
  backupPasswordRequest: { mode: "export" } | { mode: "import"; encryptedText: string } | null;
  setBackupPasswordRequest: Dispatch<SetStateAction<
    { mode: "export" } | { mode: "import"; encryptedText: string } | null
  >>;
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
  statementTable: { rows: string[][]; signature: string } | null;
  setStatementTable: Dispatch<SetStateAction<{ rows: string[][]; signature: string } | null>>;
  statementAccountId?: string;
  setStatementAccountId: Dispatch<SetStateAction<string | undefined>>;
  undoChange: UndoChange | null;
}

interface PresentationActions {
  household: {
    updateMembers: (members: Member[]) => void;
    updateCounterparties: (counterparties: Counterparty[]) => void;
    updateCustomCategories: (categories: CustomCategory[]) => void;
    completeWeeklyCheckIn: () => void;
    addOneOffIncome: ComponentProps<typeof OneOffIncomeModal>["onSave"];
    markSettled: (transfer: Transfer) => Promise<void>;
    undoLastSettlement: () => Promise<void>;
  };
  budget: {
    updateAccounts: (accounts: Account[]) => void;
    updateFixedCosts: (fixedCosts: FixedCost[]) => void;
    updateAssetHoldings: (holdings: AssetHolding[]) => void;
    deleteRules: (merchants: string[]) => void;
    saveEfficiencyDecision: (opportunity: EfficiencyOpportunity, input: EfficiencyPlanInput) => EfficiencyPlan;
    verifyEfficiencyOutcome: (opportunity: EfficiencyOpportunity, result: EfficiencyOutcomeResult) => void;
  };
  ledger: {
    addManual: (entry: ManualEntry) => void;
    importStatements: ComponentProps<typeof ImportModal>["onImport"];
    mapStatementTable: ComponentProps<typeof ImportModal>["onMapStatement"];
    ingestTransactions: (transactions: Transaction[], failures: string[], notes?: string[], scopedAccountId?: string) => ImportResult;
    confirmImportedAccountCoverage: (confirmations: AccountCoverageConfirmation[], source?: "statement" | "manual") => void;
    setTransactionCategory: (id: string, category: CategoryKey) => void;
    setTransactionBeneficiary: (id: string, beneficiary: SpendBeneficiary) => void;
    setTransactionKind: (id: string, kind: MovementKind) => void;
    setTransactionCounterparty: (id: string, counterpartyId: string | undefined) => void;
    setTransactionAccount: (id: string, accountId: string) => void;
    setTransactionHolding: (id: string, holdingId: string | undefined) => void;
    categorizeMerchant: (merchant: string, rule: MerchantRule) => void;
    categorizeMerchants: (entries: { merchant: string; rule: MerchantRule }[]) => void;
    rememberTransactionMerchant: (id: string) => void;
    undoLastLedgerChange: () => void;
    resetTransactionClassification: (id: string) => void;
    unlinkCommitment: (id: string) => void;
    confirmTransfer: (debitId: string, creditId: string) => void;
    rejectTransfer: (debitId: string, creditId: string) => void;
    removeTransaction: (id: string) => void;
    saveSplit: (id: string, split: Split) => void;
    clearSplit: (id: string) => void;
    recordIncomeReceipts: (receipts: IncomeReceipt[]) => void;
    removeIncomeConfirmation: (month: string, memberId: MemberId, portionId: string) => void;
    unlinkIncomeEvidence: (transactionId: string) => void;
    saveSharedContribution: ComponentProps<typeof SharedContributionModal>["onSave"];
    removeSharedContribution: ComponentProps<typeof SharedContributionModal>["onRemove"];
  };
  maintenance: {
    exportBackup: () => void;
    completeBackupPassword: (password: string) => Promise<void>;
    importBackup: (file: File) => void;
    confirmBackupImport: () => Promise<void>;
    clearAllData: () => void;
  };
}

export interface AppPresentationModel {
  session: HouseholdSession;
  derived: AppDerivedState;
  ui: PresentationUiState;
  actions: PresentationActions;
}

const VIEW_TITLES: Record<View, string> = {
  balance: "Balance",
  sort: "Sort",
  ledger: "Ledger",
  trend: "Trend",
};

const VIEW_DESCRIPTIONS: Record<View, string> = {
  balance: "One clear reading of this month and what needs attention next.",
  sort: "Teach new merchants their purpose and who they were for.",
  ledger: "Filter, inspect, and edit every statement-backed row.",
  trend: "Save-rate trend and month-by-month movement.",
};

function SettingsOverlays({ model }: { model: AppPresentationModel }) {
  const {
    auth, repository, data, setData, legacyPresent, householdMeta, availableHouseholds, syncStatus,
    clearActiveHouseholdTransactions, resetActiveHousehold, setHouseholdDialog,
    switchHousehold, rotateInvite, linkAccessMember, promoteOwner, revokeAccess, leaveHousehold,
    handleSignIn, handleSignOut,
  } = model.session;
  const {
    modal, setModal, pendingBackup, setPendingBackup,
    backupPasswordRequest, setBackupPasswordRequest,
  } = model.ui;
  const { updateMembers, updateCounterparties, updateCustomCategories } = model.actions.household;
  const { updateAccounts, updateFixedCosts, updateAssetHoldings, deleteRules } = model.actions.budget;
  const { categorizeMerchant } = model.actions.ledger;
  const {
    exportBackup, completeBackupPassword, importBackup, confirmBackupImport, clearAllData,
  } = model.actions.maintenance;
  const canResetHousehold = auth.status === "signed-in"
    && Boolean(householdMeta)
    && householdMeta?.membersByUid[auth.user.uid]?.role === "owner";
  const closeModal = () => setModal(null);
  const settingsProps: ComponentProps<typeof SettingsModal> = {
    data,
    onUpdateMembers: updateMembers,
    onUpdateTarget: (targetSaveRate) =>
      setData((previous) => ({ ...previous, settings: { ...previous.settings, targetSaveRate } })),
    onUpdateCurrency: (currency, locale) =>
      setData((previous) => ({ ...previous, settings: { ...previous.settings, currency, locale } })),
    onUpdateFxRates: (fxRates) =>
      setData((previous) => ({ ...previous, settings: { ...previous.settings, fxRates } })),
    onUpdateFixedCosts: updateFixedCosts,
    onUpdateAssetHoldings: updateAssetHoldings,
    onUpdateAccounts: updateAccounts,
    onUpsertRule: categorizeMerchant,
    onDeleteRules: deleteRules,
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
    onLinkAccessMember: linkAccessMember,
    onPromoteOwner: promoteOwner,
    onRevokeAccess: revokeAccess,
    onLeaveHousehold: leaveHousehold,
    onExport: exportBackup,
    onImportBackup: importBackup,
    hasLegacyBrowserData: legacyPresent,
    onClearData: clearAllData,
    canClearTransactions: canResetHousehold,
    hasTransactions: data.transactions.length > 0,
    onClearTransactions: () => setModal({ kind: "clear-transactions" }),
    canResetHousehold,
    hasResettableData: hasLocalFinancialData(data),
    onResetHousehold: () => setModal({ kind: "reset" }),
    onClose: closeModal,
  };

  return (
    <Suspense fallback={null}>
      {modal?.kind === "settings" && repository && <SettingsModal {...settingsProps} target={modal.target} />}
      {modal?.kind === "clear-transactions" && householdMeta && canResetHousehold && data.transactions.length > 0 && (
        <ClearTransactionsModal
          householdName={householdMeta.name}
          data={data}
          onExport={exportBackup}
          onClear={clearActiveHouseholdTransactions}
          onClose={closeModal}
        />
      )}
      {modal?.kind === "reset" && householdMeta && canResetHousehold && (
        <ResetHouseholdModal
          householdName={householdMeta.name}
          data={data}
          onExport={exportBackup}
          onReset={resetActiveHousehold}
          onClose={closeModal}
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
      {backupPasswordRequest && (
        <BackupPasswordDialog
          mode={backupPasswordRequest.mode}
          onClose={() => setBackupPasswordRequest(null)}
          onSubmit={completeBackupPassword}
        />
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
  const permissionFailure = failedBootstrap && /permission/i.test(bootstrapError);

  return (
    <main className="app onboarding">
      <section className={`home-hero tight onboard-wide auth-gate${failedBootstrap ? " auth-gate-failed" : ""}`}>
        <div className="onboard-intro">
          <div className="wordmark"><span className="wordmark-mark">M</span><span>Mizan</span></div>
          <h1>{needsHousehold ? "Choose a Firestore household" : failedBootstrap ? "We couldn’t open this household" : "Getting Mizan ready"}</h1>
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
          {failedBootstrap && bootstrapError && (
            <div className="notice bootstrap-error" role="alert">
              <strong>{permissionFailure ? "Firestore blocked the household request." : "The cloud request was interrupted."}</strong>
              <span>{bootstrapError}</span>
            </div>
          )}
          {notice && !failedBootstrap && <div className="notice" role="status" aria-live="polite">{notice}</div>}
        </div>
        <div className="auth-panel">
          <div className="auth-panel-heading">
            <span className="soft-label">Firestore</span>
            <strong>
              {loadingProfile
                ? "Loading cloud profile"
                : loadingHousehold
                  ? "Loading household data"
                  : failedBootstrap ? "Your data is still safe" : syncStatus.message}
            </strong>
            <p className="muted">
              {failedBootstrap
                ? "Retry the secure cloud connection or choose another household."
                : "Raw statement files and passwords stay on this device while imports are processed."}
            </p>
          </div>
          {(loadingProfile || loadingHousehold) && (
            <Skeleton label={loadingProfile ? "Loading cloud profile" : "Loading household data"} />
          )}
          {needsHousehold && (
            <div className="bootstrap-actions">
              <div className="bootstrap-secondary-actions">
                <Button variant="primary" onClick={() => setHouseholdDialog("create")}>Create household</Button>
                <Button variant="secondary" onClick={() => setHouseholdDialog("join")}>Join with invite</Button>
              </div>
            </div>
          )}
          {failedBootstrap && (
            <div className="bootstrap-actions">
              <Button variant="primary" onClick={retryBootstrap}>Retry household load</Button>
              <div className="bootstrap-secondary-actions">
                <Button variant="secondary" onClick={() => setHouseholdDialog("create")}>Create new</Button>
                <Button variant="secondary" onClick={() => setHouseholdDialog("join")}>Join another</Button>
                <Button variant="ghost" onClick={handleSignOut}>Sign out</Button>
              </div>
            </div>
          )}
          {(needsHousehold || failedBootstrap) && availableHouseholds.length > 0 && (
            <label className="field household-switcher">
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
        onOpenSettings={() => model.ui.setModal({
          kind: "settings",
          target: { tab: "sync", section: "access" },
        })}
        onComplete={(result) => setData((previous) => ({ ...previous, settings: { ...previous.settings, ...result } }))}
      />
      <SettingsOverlays model={model} />
    </>
  );
}

function WorkspaceContent({ model }: { model: AppPresentationModel }) {
  const [booksOpen, setBooksOpen] = useState(false);
  const [catchUpOpen, setCatchUpOpen] = useState(false);
  const [weeklyCloseOpen, setWeeklyCloseOpen] = useState(false);
  const [weeklyReceipt, setWeeklyReceipt] = useState<WeeklyReceiptValues | null>(null);
  const {
    data, view, setView, setMonth, privacy, setPrivacy, theme, setTheme, ledgerFilters, setLedgerFilters,
    lastCheckInByHousehold, notice, householdMeta, syncStatus, auth, weeklyCloses, saveWeeklyClose, setWeeklyCloses,
  } = model.session;
  const {
    today, todayMonth, navigationMonths, currentMonth, summary, completedMonthSummaries, efficiency, queue, history, coverageRows, transferCandidates,
    contributionCandidates, incomeCandidateMap, incomeLinkedIds, money, transactionMoney, percent,
  } = model.derived;
  const {
    setModal, setSplitTxn, setIncomeConfirm, setContributionConfirm, setEfficiencyReview,
    setEfficiencyVerification, undoChange,
  } = model.ui;
  const {
    setTransactionCategory, setTransactionBeneficiary, setTransactionKind, setTransactionCounterparty,
    setTransactionAccount, setTransactionHolding, categorizeMerchant, categorizeMerchants, rememberTransactionMerchant,
    undoLastLedgerChange, resetTransactionClassification, unlinkCommitment, confirmTransfer, rejectTransfer,
    removeTransaction, saveSplit,
  } = model.actions.ledger;
  const { completeWeeklyCheckIn, markSettled, undoLastSettlement } = model.actions.household;
  const { saveEfficiencyDecision } = model.actions.budget;
  const syncHasError = isSyncProblem(syncStatus);
  const syncLabel = syncChipLabel(syncStatus);
  const hasActivity = summary.monthTransactions.length > 0;
  const weekIso = weeklyCloseWeekIso(new Date());
  const weekNumber = weeklyCloseWeekNumber(weekIso);
  const weeklyRecord = weeklyCloses.find((record) => record.weekIso === weekIso && record.householdId === householdMeta?.id) ?? null;
  const weeklyCloseState = {
    weekIso,
    weekNumber,
    record: weeklyRecord,
    streak: weeklyCloseStreak(weeklyCloses, weekIso),
    accountsCurrent: coverageRows.filter((row) => row.status === "current").length,
    accountsTotal: coverageRows.length,
    sortCount: queue.reduce((total, item) => total + item.count, 0),
    movementCount: summary.movementRows.filter((row) => row.value > 0 || row.delta !== 0).length,
    opportunityCount: efficiency.topOpportunities.length,
  };
  const latestOwnSettlement = auth.status === "signed-in" && householdMeta
    ? [...data.settlements]
        .filter((settlement) => settlement.householdId === householdMeta.id
          && settlement.month === currentMonth
          && settlement.settledByUid === auth.user.uid)
        .sort((left, right) => left.settledAt.localeCompare(right.settledAt) || left.id.localeCompare(right.id))
        .at(-1)
    : undefined;
  useEffect(() => {
    const weeklyCloseRoute = window.location.hash.startsWith("#weekly-close");
    if (weeklyCloseRoute) {
      // The deep link is authoritative while the cloud profile is still
      // applying its last-view preference. Without this, a saved Trend/Sort
      // view can close the weekly route immediately after it opens.
      if (view !== "balance") setView("balance");
      setBooksOpen(false);
      setCatchUpOpen(false);
      setWeeklyCloseOpen(true);
      return;
    }
    if (view !== "balance") {
      setBooksOpen(false);
      setCatchUpOpen(false);
      setWeeklyCloseOpen(false);
      setWeeklyReceipt(null);
    }
  }, [setView, view]);
  const openSettings = (target: SettingsTarget = DEFAULT_SETTINGS_TARGET) =>
    setModal({ kind: "settings", target });
  const openModal = (kind: SimpleModalKind) => setModal({ kind });
  const openImport = (accountId?: string) => setModal({ kind: "import", ...(accountId ? { accountId } : {}) });
  const openWeeklyClose = () => {
    const firstIncomplete = firstIncompleteWeeklyCloseStep(weeklyRecord);
    if (weeklyRecord && weeklyCloseIsClosed(weeklyRecord)) {
      const committedPlan = weeklyRecord.committedPlanId
        ? data.efficiencyPlans.find((plan) => plan.id === weeklyRecord.committedPlanId)
        : undefined;
      setWeeklyReceipt({
        weekNumber,
        sortedCount: weeklyRecord.sortedCount,
        sortedAmount: 0,
        statementAdded: 0,
        accountsCurrent: coverageRows.filter((row) => row.status === "current").length,
        accountsTotal: coverageRows.length,
        saveRateBefore: summary.projectedSaveRate,
        saveRateAfter: summary.projectedSaveRate,
        committedMonthlySavings: committedPlan?.targetMonthlySavings ?? 0,
      });
    } else {
      setWeeklyReceipt(null);
    }
    setWeeklyCloseOpen(true);
    window.history.replaceState(null, "", `#weekly-close/step-${Math.max(1, firstIncomplete + 1)}`);
  };
  const closeWeeklyClose = () => {
    setWeeklyCloseOpen(false);
    setWeeklyReceipt(null);
    if (window.location.hash.startsWith("#weekly-close")) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  };
  const persistWeeklyClose = async (stepsCompleted: WeeklyCloseStep[], sortedCount: number, committedPlanId?: string) => {
    if (auth.status !== "signed-in" || !householdMeta) throw new Error("An active signed-in household is required.");
    const nextRecord: WeeklyCloseRecord = {
      id: weeklyRecord?.id ?? weeklyCloseId(auth.user.uid, weekIso),
      householdId: householdMeta.id,
      uid: auth.user.uid,
      weekIso,
      closedAt: WEEKLY_CLOSE_STEP_IDS.every((step) => stepsCompleted.includes(step)) ? new Date().toISOString() : "",
      stepsCompleted,
      sortedCount,
      ...(committedPlanId ? { committedPlanId } : weeklyRecord?.committedPlanId ? { committedPlanId: weeklyRecord.committedPlanId } : {}),
    };
    await saveWeeklyClose(nextRecord);
    setWeeklyCloses((records) => [...records.filter((record) => record.id !== nextRecord.id), nextRecord]);
    const nextStep = firstIncompleteWeeklyCloseStep(nextRecord);
    if (nextStep >= 0 && window.location.hash.startsWith("#weekly-close")) {
      window.history.replaceState(null, "", `#weekly-close/step-${nextStep + 1}`);
    }
  };
  const goToView = (nextView: View) => {
    setBooksOpen(false);
    setCatchUpOpen(false);
    setWeeklyCloseOpen(false);
    setWeeklyReceipt(null);
    if (window.location.hash.startsWith("#weekly-close")) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    setView(nextView);
  };
  const homeViewProps: HomeViewProps = {
    summary,
    money,
    percent,
    financialValuesHidden: privacy,
    lastCheckInAt: householdMeta ? (lastCheckInByHousehold[householdMeta.id] ?? "") : "",
    onOpenSettings: openSettings,
    onOpenImport: () => openImport(),
    onOpenCatchUp: () => setCatchUpOpen(true),
    weeklyClose: weeklyCloseState,
    onOpenWeeklyClose: openWeeklyClose,
    onReviewQueue: () => {
      setLedgerFilters(EMPTY_LEDGER_FILTERS);
      goToView("sort");
    },
    onCompleteCheckIn: completeWeeklyCheckIn,
    onMarkSettled: markSettled,
    onUndoLastSettlement: undoLastSettlement,
    canUndoLastSettlement: Boolean(latestOwnSettlement && latestOwnSettlement.amount > 0),
    incomeCandidates: incomeCandidateMap,
    onConfirmIncome: (item, candidate) => setIncomeConfirm({ item, ...(candidate ? { candidate } : {}) }),
    contributionCandidates: contributionCandidates.filter((candidate) =>
      candidate.expenses.some((expense) => monthOf(expense.date) === currentMonth)),
    members: data.settings.members,
    accounts: data.accounts,
    today,
    coverageRows,
    history: completedMonthSummaries,
    onConfirmContribution: (candidate) => setContributionConfirm({ candidate }),
    efficiency,
    hasActiveEfficiencyPlan: data.efficiencyPlans.some((plan) => plan.state !== "closed"),
    onReviewEfficiency: setEfficiencyReview,
    onVerifyEfficiency: setEfficiencyVerification,
    onOpenTransactions: (filters) => {
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
      goToView("ledger");
    },
  };

  return (
    <div className={`app-shell${booksOpen ? " books-open" : ""}`}>
      <AppRail view={view} sortCount={summary.reviewQueueCount} onChange={goToView} />
      <div className="app-content">
        <section className="workspace">
          <header className="view-control-row">
            <div className="view-control-primary">
              <MonthNavigator
                compact
                value={currentMonth}
                months={navigationMonths}
                todayMonth={todayMonth}
                onChange={setMonth}
              />
              {view === "balance" ? (
                <BalanceConfidenceChip
                  rows={coverageRows}
                  hasActivity={hasActivity}
                  title={syncLabel}
                  onClick={() => openSettings({ tab: "sync", section: "access" })}
                />
              ) : (
                <button
                  type="button"
                  className={`sync-chip view-sync-chip ${syncHasError ? "sync-error" : ""}`}
                  title={syncStatus.message}
                  onClick={() => openSettings({ tab: "sync", section: "access" })}
                >
                  {syncLabel}
                </button>
              )}
            </div>
            <div className="household-controls">
              <div className="member-avatar-stack" aria-label="Household members">
                {data.settings.members.map((member) => (
                  <span
                    className="member-avatar"
                    style={{ background: member.color }}
                    title={member.name}
                    key={member.id}
                  >
                    {member.name.trim().charAt(0).toUpperCase() || "?"}
                  </span>
                ))}
              </div>
              <span className="view-theme-control">
                <IconButton
                  label={theme === "dark" ? "Use light mode" : "Use dark mode"}
                  icon={theme === "dark" ? Sun : Moon}
                  onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
                />
              </span>
              <IconButton
                label={privacy ? "Show financial values" : "Hide financial values"}
                icon={privacy ? Eye : EyeOff}
                onClick={() => setPrivacy((value) => !value)}
              />
              <IconButton label="Settings" icon={Settings} onClick={() => openSettings()} />
            </div>
          </header>

          {(view === "ledger" || view === "trend") && (
            <PageHeader
              eyebrow={data.settings.members.map((member) => member.name).join(" + ") || "Household"}
              title={VIEW_TITLES[view]}
              description={VIEW_DESCRIPTIONS[view]}
              actions={view === "ledger" ? (
                <>
                  <Button variant="secondary" onClick={() => openImport()}>Import activity</Button>
                  <Button variant="primary" onClick={() => openModal("manual")}>Add transaction</Button>
                </>
              ) : null}
            />
          )}

        {notice && (
          <Alert tone={/failed|could not|error/i.test(notice) ? "danger" : "success"} live className="workspace-alert">
            {notice}
          </Alert>
        )}
        {view === "balance" && (
          catchUpOpen
            ? <CatchUpView
                accounts={data.accounts}
                members={data.settings.members}
                transactions={data.transactions}
                summary={summary}
                money={money}
                financialValuesHidden={privacy}
                onOpenImport={openImport}
                onConfirmCoverage={model.actions.ledger.confirmImportedAccountCoverage}
              />
            : weeklyCloseOpen
              ? weeklyReceipt
                ? <WeeklyReceipt
                    {...weeklyReceipt}
                    money={money}
                    percent={percent}
                    financialValuesHidden={privacy}
                    solo={data.settings.members.length === 1}
                    onBack={closeWeeklyClose}
                  />
                : <WeeklyClose
                    weekNumber={weekNumber}
                    record={weeklyRecord}
                    initialStep={Math.max(0, firstIncompleteWeeklyCloseStep(weeklyRecord))}
                    catchUpProps={{
                      accounts: data.accounts,
                      members: data.settings.members,
                      transactions: data.transactions,
                      summary,
                      money,
                      financialValuesHidden: privacy,
                      onOpenImport: openImport,
                      onConfirmCoverage: model.actions.ledger.confirmImportedAccountCoverage,
                    }}
                    sortProps={{
                      queue,
                      transferCandidates,
                      members: data.settings.members,
                      accounts: data.accounts,
                      allTransactions: data.transactions,
                      money,
                      financialValuesHidden: privacy,
                      undoLabel: undoChange?.householdId === (householdMeta?.id ?? "") ? undoChange.label : "",
                      onCategorizeMerchant: categorizeMerchant,
                      onCategorizeMerchants: categorizeMerchants,
                      onRememberMerchant: rememberTransactionMerchant,
                      onSaveSplit: saveSplit,
                      onAdjustSplit: setSplitTxn,
                      onConfirmTransfer: confirmTransfer,
                      onRejectTransfer: rejectTransfer,
                      onUndo: undoLastLedgerChange,
                    }}
                    summary={summary}
                    efficiency={efficiency}
                    existingPlan={efficiency.topOpportunities[0]?.planId
                      ? data.efficiencyPlans.find((plan) => plan.id === efficiency.topOpportunities[0]!.planId)
                      : undefined}
                    money={money}
                    onSaveEfficiencyDecision={saveEfficiencyDecision}
                    onStepAnswered={persistWeeklyClose}
                    onComplete={(receipt) => setWeeklyReceipt(receipt)}
                    onBack={closeWeeklyClose}
                  />
              : booksOpen
              ? <BooksView {...homeViewProps} onBack={() => setBooksOpen(false)} />
              : <BalanceView {...homeViewProps} onOpenBooks={() => setBooksOpen(true)} />
        )}
        {view === "sort" && (
          <SortView
            queue={queue}
            transferCandidates={transferCandidates}
            members={data.settings.members}
            accounts={data.accounts}
            allTransactions={data.transactions}
            money={money}
            financialValuesHidden={privacy}
            undoLabel={undoChange?.householdId === (householdMeta?.id ?? "") ? undoChange.label : ""}
            onCategorizeMerchant={categorizeMerchant}
            onCategorizeMerchants={categorizeMerchants}
            onRememberMerchant={rememberTransactionMerchant}
            onSaveSplit={saveSplit}
            onAdjustSplit={setSplitTxn}
            onConfirmTransfer={confirmTransfer}
            onRejectTransfer={rejectTransfer}
            onUndo={undoLastLedgerChange}
          />
        )}
        {view === "ledger" && (
          <TransactionsView
            summary={summary}
            members={data.settings.members}
            accounts={data.accounts}
            assetHoldings={data.assetHoldings}
            customCategories={data.settings.customCategories}
            counterparties={data.settings.counterparties}
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
            onSetHolding={setTransactionHolding}
            onRememberMerchant={rememberTransactionMerchant}
            onResetClassification={resetTransactionClassification}
            onUnlinkCommitment={unlinkCommitment}
            onSplit={setSplitTxn}
            onRemove={removeTransaction}
            incomeLinkedIds={incomeLinkedIds}
            allTransactions={data.transactions}
            sharedContributions={data.sharedContributions}
            onLinkContribution={(expenseId) => setContributionConfirm({ expenseId })}
            onEditContribution={(contribution) => setContributionConfirm({ contribution })}
            onOpenImport={() => openImport()}
            onAddTransaction={() => openModal("manual")}
          />
        )}
        {view === "trend" && (
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
      </div>
    </div>
  );
}

function WorkspaceModals({ model }: { model: AppPresentationModel }) {
  const { data, setData, privacy, setView, setLedgerFilters } = model.session;
  const {
    todayMonth, currentMonth, summary, money, currencyMoney, transactionMoney,
  } = model.derived;
  const {
    modal, setModal, csvFile, setCsvFile, statementTable, setStatementTable, statementAccountId, setStatementAccountId,
    splitTxn, setSplitTxn, incomeConfirm, setIncomeConfirm,
    contributionConfirm, setContributionConfirm, efficiencyReview, setEfficiencyReview,
    efficiencyVerification, setEfficiencyVerification,
  } = model.ui;
  const {
    importStatements, mapStatementTable, ingestTransactions, confirmImportedAccountCoverage, addManual,
    saveSplit, clearSplit, recordIncomeReceipts, removeIncomeConfirmation, unlinkIncomeEvidence,
    saveSharedContribution, removeSharedContribution,
  } = model.actions.ledger;
  const { saveEfficiencyDecision, verifyEfficiencyOutcome } = model.actions.budget;
  const { addOneOffIncome } = model.actions.household;

  return (
    <Suspense fallback={null}>
      {modal?.kind === "import" && (
        <ImportModal
          onImport={importStatements}
          onCsv={(file) => {
            setModal(null);
            setStatementTable(null);
            setStatementAccountId(modal.accountId);
            setCsvFile(file);
          }}
          onMapStatement={mapStatementTable}
          onReview={() => {
            setModal(null);
            setLedgerFilters(EMPTY_LEDGER_FILTERS);
            setView("sort");
          }}
          onConfirmCoverage={confirmImportedAccountCoverage}
          scopedAccountId={modal.accountId}
          scopedAccountLabel={data.accounts.find((account) => account.id === modal.accountId)?.label}
          onClose={() => setModal(null)}
        />
      )}
      {csvFile && (
        <CsvImportModal
          file={csvFile}
          extractedRows={statementTable?.rows}
          layoutSignature={statementTable?.signature}
          presets={data.settings.csvPresets}
          formatAmount={(transaction) =>
            `${transaction.direction === "credit" && !privacy ? "+" : ""}${transactionMoney(transaction, transaction.amount)}`}
          onImport={(transactions, skipped) => ingestTransactions(
            transactions,
            [],
            skipped ? [`${skipped} CSV row${skipped === 1 ? "" : "s"} skipped.`] : [],
            statementAccountId,
          )}
          onSavePreset={(signature, mapping) =>
            setData((previous) => ({
              ...previous,
              settings: { ...previous.settings, csvPresets: { ...previous.settings.csvPresets, [signature]: mapping } },
            }))}
          onConfirmCoverage={confirmImportedAccountCoverage}
          onClose={() => {
            setCsvFile(null);
            setStatementTable(null);
            setStatementAccountId(undefined);
          }}
        />
      )}
      {modal?.kind === "manual" && (
        <ManualModal
          accounts={data.accounts}
          members={data.settings.members}
          customCategories={data.settings.customCategories}
          counterparties={data.settings.counterparties}
          assetHoldings={data.assetHoldings}
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
      {modal?.kind === "one-off-income" && (
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
