import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BarChart2, Eye, EyeOff, Home, List, Moon, Settings, Sun } from "lucide-react";
import { authErrorMessage, signInWithGoogle, signOutUser, useAuthState } from "./auth/authStore";
import {
  applyAccountBeneficiaryDefaults,
  applyAccounts,
  assignAccount,
  transactionDisplayCurrency,
  withAccountBeneficiaryDefault,
} from "./domain/accounts";
import { categoryOptions } from "./domain/categories";
import { dominantMonth, isoDateOf, monthLabel, monthOf } from "./domain/dates";
import { clearTransactionHistory } from "./domain/dataCleanup";
import {
  detectSharedContributionCandidates,
  contributionReferencesTransaction,
  pruneSharedContributions,
  sharedContributionError,
  type SharedContributionCandidate,
} from "./domain/contributions";
import { filterNew } from "./domain/dedupe";
import { normalizeFxTransaction } from "./domain/fx";
import { pruneReceipts, removeReceipt, unlinkTransaction, upsertReceipt, upsertReceiptGroup, type PortionResolution } from "./domain/income";
import { detectIncomeCandidates, eligibleCredits, type IncomeCandidate } from "./domain/incomeMatch";
import { formatMoney } from "./domain/money";
import { directionForKind, isSpendKind } from "./domain/movements";
import { applyRules, cleanMerchant, matchingRuleKey, withRule } from "./domain/rules";
import { computeHistory, computeMonthSummary, monthsWithData, needsClassificationReview, reviewQueue, selectableMonths } from "./domain/summary";
import { detectTransferCandidates } from "./domain/transfers";
import {
  defaultKind,
  uid,
  type AppData,
  type CategoryKey,
  type Account,
  type Counterparty,
  type CustomCategory,
  type IncomeReceipt,
  type IncomePortion,
  type MerchantRule,
  type Member,
  type MemberId,
  type MovementKind,
  type SpendBeneficiary,
  type Split,
  type SharedContribution,
  type Transaction,
} from "./domain/types";
import { getFirebaseServices } from "./firebase/client";
import {
  FirestoreHouseholdRepository,
  createFirestoreHousehold,
  joinFirestoreHousehold,
  loadHouseholdMeta,
  loadUserHouseholds,
  loadUserProfile,
  rotateFirestoreInvite,
  saveUserProfile,
} from "./household/firestoreRepository";
import { hasLocalFinancialData } from "./household/households";
import type { HouseholdMeta, ThemePreference, UserHouseholdLink } from "./household/types";
import { parsersFor } from "./import/registry";
import { clearLegacyLocalData, hasLegacyLocalData, loadLegacyLocalData, parseBackup, serializeBackup } from "./storage/localStore";
import { saveAuthoritativeData, type DataRepository } from "./storage/repository";
import { emptyData } from "./storage/schema";
import { AuthGate } from "./ui/AuthGate";
import { IconButton, PageHeader } from "./ui/bits";
import { CLEAR_TRANSACTIONS_CONFIRMATION, ClearTransactionsModal } from "./ui/ClearTransactionsModal";
import { HistoryView } from "./ui/HistoryView";
import { HomeView } from "./ui/HomeView";
import { ImportModal, type ImportResult } from "./ui/ImportModal";
import { IncomeConfirmModal } from "./ui/IncomeConfirmModal";
import { CsvImportModal } from "./ui/CsvImportModal";
import { ManualModal, type ManualEntry } from "./ui/ManualModal";
import { MonthNavigator } from "./ui/MonthNavigator";
import { OnboardingView } from "./ui/OnboardingView";
import { OneOffIncomeModal } from "./ui/OneOffIncomeModal";
import { RESET_CONFIRMATION, ResetHouseholdModal } from "./ui/ResetHouseholdModal";
import { SettingsModal } from "./ui/SettingsModal";
import { SplitModal } from "./ui/SplitModal";
import { SharedContributionModal } from "./ui/SharedContributionModal";
import { TransactionsView, type BeneficiaryFilter, type LedgerFilters, type PayerFilter } from "./ui/TransactionsView";

type View = "home" | "transactions" | "history";
type ModalKind = null | "import" | "manual" | "settings" | "one-off-income" | "clear-transactions" | "reset";
type BootstrapPhase = "idle" | "loading-profile" | "loading-household" | "needs-household" | "ready" | "error";

const EMPTY_LEDGER_FILTERS: LedgerFilters = {
  category: "all",
  beneficiary: "all",
  payer: "all",
};

const UNASSIGNED_BENEFICIARY: SpendBeneficiary = { type: "unassigned" };

function beneficiaryFilterValue(value: string | undefined): BeneficiaryFilter {
  return value === "household" || value === "unassigned" || value?.startsWith("member:") ? value as BeneficiaryFilter : "all";
}

function payerFilterValue(value: string | undefined): PayerFilter {
  return value === "joint" || value?.startsWith("member:") ? value as PayerFilter : "all";
}

interface UndoChange {
  label: string;
  before: AppData;
  householdId: string;
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

const ACTIVE_HOUSEHOLD_KEY = "mizan.activeHouseholdId";
const PRIVACY_KEY = "mizan.privacy";
const THEME_KEY = "mizan.theme";
const STARTUP_MARKS = ["auth-start", "auth-ready", "profile-start", "profile-ready", "household-start", "meta-ready", "data-ready", "home-ready"] as const;

function startupMark(name: (typeof STARTUP_MARKS)[number]) {
  if (!import.meta.env.DEV || typeof performance === "undefined") return;
  performance.mark(`mizan:${name}`);
}

function resetStartupTiming() {
  if (!import.meta.env.DEV || typeof performance === "undefined") return;
  STARTUP_MARKS.forEach((name) => performance.clearMarks(`mizan:${name}`));
  ["auth", "profile", "household-meta", "household-data", "auth-to-home", "total"].forEach((name) =>
    performance.clearMeasures(`mizan:${name}`),
  );
}

function startupMeasure(name: string, start: (typeof STARTUP_MARKS)[number], end: (typeof STARTUP_MARKS)[number]) {
  if (!import.meta.env.DEV || typeof performance === "undefined") return;
  try {
    performance.measure(`mizan:${name}`, `mizan:${start}`, `mizan:${end}`);
  } catch {
    // A direct signed-in test render may not include every earlier startup mark.
  }
}

function reportStartupTiming() {
  if (!import.meta.env.DEV || typeof performance === "undefined") return;
  const rows = ["auth", "profile", "household-meta", "household-data", "auth-to-home", "total"]
    .map((name) => performance.getEntriesByName(`mizan:${name}`, "measure").at(-1))
    .filter((entry): entry is PerformanceMeasure => Boolean(entry))
    .map((entry) => ({ stage: entry.name.replace("mizan:", ""), milliseconds: Math.round(entry.duration) }));
  if (rows.length) console.table(rows);
}

function isView(value: string): value is View {
  return value === "home" || value === "transactions" || value === "history";
}

function readLocalConvenience(key: string): string {
  return typeof localStorage === "undefined" ? "" : localStorage.getItem(key) ?? "";
}

function writeLocalConvenience(key: string, value: string): void {
  if (typeof localStorage === "undefined") return;
  if (value) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
}

function initialTheme(): ThemePreference {
  const saved = readLocalConvenience(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export default function App() {
  const auth = useAuthState();
  const services = useMemo(() => getFirebaseServices(), []);
  const skipNextSave = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveVersion = useRef(0);
  const completedSaveVersion = useRef(0);
  const activationVersion = useRef(0);
  const repositoryRef = useRef<DataRepository | null>(null);
  const profileLoaded = useRef(false);
  const [repository, setRepository] = useState<DataRepository | null>(null);
  const [data, setData] = useState<AppData>(() => emptyData());
  const [legacyData, setLegacyData] = useState<AppData | null>(() => loadLegacyLocalData());
  const [legacyPresent, setLegacyPresent] = useState(() => hasLegacyLocalData());
  const [view, setView] = useState<View>("home");
  const [month, setMonth] = useState("");
  const [privacy, setPrivacy] = useState(() => readLocalConvenience(PRIVACY_KEY) === "true");
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);
  const [ledgerFilters, setLedgerFilters] = useState<LedgerFilters>(EMPTY_LEDGER_FILTERS);
  const [lastCheckInByHousehold, setLastCheckInByHousehold] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [undoChange, setUndoChange] = useState<UndoChange | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [splitTxn, setSplitTxn] = useState<Transaction | null>(null);
  const [incomeConfirm, setIncomeConfirm] = useState<{ item: PortionResolution; candidate?: IncomeCandidate } | null>(null);
  const [contributionConfirm, setContributionConfirm] = useState<{
    candidate?: SharedContributionCandidate;
    expenseId?: string;
    contribution?: SharedContribution;
  } | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [householdMeta, setHouseholdMeta] = useState<HouseholdMeta | null>(null);
  const [availableHouseholds, setAvailableHouseholds] = useState<UserHouseholdLink[]>([]);
  const [syncStatus, setSyncStatus] = useState("Sign in to use Firestore");
  const [bootstrapPhase, setBootstrapPhase] = useState<BootstrapPhase>("idle");
  const [bootstrapError, setBootstrapError] = useState("");
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [dismissedTransfers, setDismissedTransfers] = useState<Set<string>>(() => new Set());
  const authUid = auth.status === "signed-in" ? auth.user.uid : "";

  useEffect(() => {
    repositoryRef.current = repository;
  }, [repository]);

  useEffect(() => {
    if (auth.status === "loading") {
      resetStartupTiming();
      startupMark("auth-start");
      return;
    }
    startupMark("auth-ready");
    startupMeasure("auth", "auth-start", "auth-ready");
  }, [auth.status]);

  useEffect(() => {
    if (!repository) return undefined;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    const version = ++saveVersion.current;
    const timer = window.setTimeout(() => {
      saveTimer.current = null;
      setSyncStatus("Saving to Firestore");
      const queued = saveQueue.current.catch(() => undefined).then(() => repository.save(data));
      saveQueue.current = queued;
      queued
        .then(() => {
          completedSaveVersion.current = Math.max(completedSaveVersion.current, version);
          if (version === saveVersion.current) setSyncStatus("Synced to Firestore");
        })
        .catch(async (error) => {
          completedSaveVersion.current = Math.max(completedSaveVersion.current, version);
          const message = (error as Error).message;
          if (message.includes("changed on another device") && repositoryRef.current === repository) {
            try {
              const nextData = await repository.load();
              if (repositoryRef.current !== repository) return;
              skipNextSave.current = true;
              setUndoChange(null);
              setData(nextData);
              setSyncStatus("Reloaded newer household changes");
              return;
            } catch {
              // Preserve the original conflict below when a recovery load fails.
            }
          }
          if (version === saveVersion.current) setSyncStatus(`Save failed: ${message}`);
        });
    }, 250);
    saveTimer.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (saveTimer.current === timer) saveTimer.current = null;
    };
  }, [data, repository]);

  useEffect(() => {
    if (!repository?.subscribe) return undefined;
    setSyncStatus("Listening for household changes");
    return repository.subscribe(
      (nextData) => {
        // A Firestore snapshot can echo an older local save while a newer edit is
        // still inside the debounce window. Applying that echo would cancel the
        // newer save and visibly lose the edit, so keep local state authoritative
        // until the latest queued save settles.
        if (completedSaveVersion.current < saveVersion.current) return;
        skipNextSave.current = true;
        setData(nextData);
        setUndoChange(null);
        setSyncStatus("Synced to Firestore");
      },
      (message) => setSyncStatus(`Sync failed: ${message}`),
      { skipInitial: true },
    );
  }, [repository]);

  useEffect(() => {
    writeLocalConvenience(PRIVACY_KEY, String(privacy));
  }, [privacy]);

  useLayoutEffect(() => {
    writeLocalConvenience(THEME_KEY, theme);
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
      "content",
      theme === "dark" ? "#0f1713" : "#f1eee5",
    );
  }, [theme]);

  useEffect(() => {
    if (!authUid || !services) {
      setAvailableHouseholds([]);
      return;
    }
    loadUserHouseholds(services.db, authUid)
      .then(setAvailableHouseholds)
      .catch((error) => setSyncStatus(`Could not load households: ${(error as Error).message}`));
  }, [authUid, services, bootstrapAttempt]);

  useEffect(() => {
    if (!authUid || auth.status !== "signed-in" || !services) {
      profileLoaded.current = false;
      setBootstrapPhase("idle");
      setBootstrapError("");
      return;
    }
    let cancelled = false;
    profileLoaded.current = false;
    setRepository(null);
    setHouseholdMeta(null);
    setData(emptyData());
    setBootstrapPhase("loading-profile");
    setBootstrapError("");
    setSyncStatus("Loading cloud profile");
    startupMark("profile-start");

    const activation = ++activationVersion.current;
    void (async () => {
      try {
        const profile = await loadUserProfile(services.db, authUid);
        if (cancelled) return;
        startupMark("profile-ready");
        startupMeasure("profile", "profile-start", "profile-ready");
        setPrivacy(profile.privacy);
        if (profile.theme) setTheme(profile.theme);
        if (isView(profile.lastView)) setView(profile.lastView);
        if (profile.lastMonth) setMonth(profile.lastMonth);
        setLedgerFilters({
          category: (profile.categoryFilter || "all") as CategoryKey | "all",
          beneficiary: beneficiaryFilterValue(profile.beneficiaryFilter),
          payer: payerFilterValue(profile.payerFilter),
        });
        setLastCheckInByHousehold(profile.lastCheckInByHousehold);

        const householdId = profile.activeHouseholdId || readLocalConvenience(ACTIVE_HOUSEHOLD_KEY);
        if (!householdId) {
          profileLoaded.current = true;
          setBootstrapPhase("needs-household");
          setSyncStatus("Create or join a Firestore household");
          return;
        }

        setBootstrapPhase("loading-household");
        setSyncStatus("Loading household data");
        startupMark("household-start");
        const repo = new FirestoreHouseholdRepository(services.db, householdId, authUid);
        const metaRequest = loadHouseholdMeta(services.db, householdId).then((meta) => {
          startupMark("meta-ready");
          startupMeasure("household-meta", "household-start", "meta-ready");
          return meta;
        });
        const dataRequest = repo.load().then((cloudData) => {
          startupMark("data-ready");
          startupMeasure("household-data", "household-start", "data-ready");
          return cloudData;
        });
        const [meta, cloudData] = await Promise.all([metaRequest, dataRequest]);
        if (cancelled) return;
        const activated = await activateHousehold(
          meta,
          {
            persistSelection: profile.activeHouseholdId !== householdId,
            preserveViewState: true,
            activation,
            isCancelled: () => cancelled,
            rethrow: true,
          },
          { repo, cloudData },
        );
        if (!cancelled && activated) profileLoaded.current = true;
      } catch (error) {
        if (cancelled) return;
        const message = (error as Error).message;
        setBootstrapError(message);
        setBootstrapPhase("error");
        setSyncStatus(`Could not load household: ${message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authUid, services, bootstrapAttempt]);

  useEffect(() => {
    if (auth.status !== "signed-in" || !services || !profileLoaded.current) return undefined;
    const timer = window.setTimeout(() => {
      saveUserProfile(services.db, auth.user.uid, {
        activeHouseholdId: householdMeta?.id ?? "",
        privacy,
        theme,
        lastView: view,
        lastMonth: month,
        categoryFilter: ledgerFilters.category,
        beneficiaryFilter: ledgerFilters.beneficiary,
        payerFilter: ledgerFilters.payer,
        lastCheckInByHousehold,
      }).catch((error) => setSyncStatus(`Could not save cloud profile: ${(error as Error).message}`));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [auth, services, householdMeta?.id, privacy, theme, view, month, ledgerFilters, lastCheckInByHousehold]);

  useEffect(() => {
    if (!repository || bootstrapPhase !== "ready") return;
    startupMark("home-ready");
    startupMeasure("auth-to-home", "auth-ready", "home-ready");
    startupMeasure("total", "auth-start", "home-ready");
    reportStartupTiming();
  }, [repository, bootstrapPhase]);

  useEffect(() => {
    if (bootstrapPhase !== "ready") return;
    const validCategories = new Set(
      categoryOptions(data.settings.members, data.settings.customCategories).map((option) => option.key),
    );
    const validMembers = new Set(data.settings.members.map((member) => member.id));
    setLedgerFilters((current) => {
      const category = current.category !== "all" && !validCategories.has(current.category)
        ? "all"
        : current.category;
      const beneficiary = current.beneficiary.startsWith("member:")
        && !validMembers.has(current.beneficiary.slice("member:".length))
        ? "all"
        : current.beneficiary;
      const payer = current.payer.startsWith("member:")
        && !validMembers.has(current.payer.slice("member:".length))
        ? "all"
        : current.payer;
      return category === current.category && beneficiary === current.beneficiary && payer === current.payer
        ? current
        : { category, beneficiary, payer };
    });
  }, [bootstrapPhase, data.settings.members, data.settings.customCategories]);

  const today = new Date();
  const todayMonth = isoDateOf(today).slice(0, 7);
  const historyMonths = useMemo(() => monthsWithData(data, today), [data, todayMonth]);
  const navigationMonths = useMemo(() => selectableMonths(data, today), [data, todayMonth]);
  const monthRangeReady = bootstrapPhase === "ready";
  const currentMonth = month && (!monthRangeReady || navigationMonths.includes(month)) ? month : todayMonth;
  useEffect(() => {
    if (monthRangeReady && month && month !== currentMonth) setMonth(currentMonth);
  }, [currentMonth, month, monthRangeReady]);
  const summary = useMemo(
    () => computeMonthSummary(data, currentMonth, new Date()),
    [data, currentMonth],
  );
  const queue = useMemo(() => reviewQueue(data.transactions), [data]);
  const history = useMemo(() => computeHistory(data, historyMonths, new Date()), [data, historyMonths]);
  const transferCandidates = useMemo(
    () =>
      detectTransferCandidates(data.transactions, data.accounts).filter(
        (pair) => !dismissedTransfers.has(`${pair.debit.id}:${pair.credit.id}`),
      ),
    [data.transactions, data.accounts, dismissedTransfers],
  );
  const contributionCandidates = useMemo(
    () => detectSharedContributionCandidates(
      data.transactions,
      data.accounts,
      data.settings.members,
      data.sharedContributions,
    ),
    [data.transactions, data.accounts, data.settings.members, data.sharedContributions],
  );
  const incomeCandidates = useMemo(
    () => detectIncomeCandidates(
      data.settings.members,
      data.transactions,
      data.accounts,
      data.incomeReceipts,
      data.settings.currency,
      data.settings.fxRates,
      currentMonth,
    ),
    [data.settings.members, data.settings.currency, data.settings.fxRates, data.transactions, data.accounts, data.incomeReceipts, currentMonth],
  );
  const incomeCandidateMap = useMemo(
    () => new Map(incomeCandidates.map((candidate) => [candidate.portionId, candidate])),
    [incomeCandidates],
  );
  const incomeLinkedIds = useMemo(
    () => new Set(data.incomeReceipts.map((receipt) => receipt.transactionId).filter((id): id is string => Boolean(id))),
    [data.incomeReceipts],
  );
  const money = (value: number) =>
    privacy ? "Hidden" : formatMoney(value, { currency: data.settings.currency, locale: data.settings.locale });
  const currencyMoney = (value: number, currency: string) =>
    privacy ? "Hidden" : formatMoney(value, { currency, locale: data.settings.locale });
  const transactionMoney = (txn: Transaction, value: number) =>
    privacy ? "Hidden" : formatMoney(value, {
      currency: transactionDisplayCurrency(txn, data.accounts, data.settings.currency),
      locale: data.settings.locale,
    });

  function rememberUndo(label: string) {
    setUndoChange({ label, before: data, householdId: householdMeta?.id ?? "" });
  }

  function undoLastLedgerChange() {
    if (!undoChange || undoChange.householdId !== (householdMeta?.id ?? "")) return;
    setData(undoChange.before);
    setNotice(`${undoChange.label} undone.`);
    setUndoChange(null);
  }

  /** Apply a protected, one-transaction classification override. */
  function classifyTransaction(
    id: string,
    patch: Partial<Pick<Transaction, "category" | "beneficiary" | "kind" | "counterpartyId">>,
  ) {
    const current = data.transactions.find((item) => item.id === id);
    if (!current) return;
    rememberUndo(`Classification for ${current.description}`);
    setData((previous) => {
      const txn = previous.transactions.find((item) => item.id === id);
      if (!txn) return previous;
      let next: Transaction = { ...txn, ...patch, classificationLocked: true };
      if (patch.beneficiary) delete next.beneficiarySource;
      if (patch.kind && !isSpendKind(patch.kind)) {
        next.beneficiary = UNASSIGNED_BENEFICIARY;
        delete next.beneficiarySource;
      } else if (patch.kind && next.beneficiary.type === "unassigned") {
        next = withAccountBeneficiaryDefault(next, previous.accounts, previous.settings.members);
      }
      if (!next.counterpartyId) delete next.counterpartyId;
      const transactions = previous.transactions.map((item) => (item.id === id ? next : item));
      const sharedContributions = pruneSharedContributions(
        previous.sharedContributions.filter((item) => !contributionReferencesTransaction(item, id, previous.transactions)),
        transactions,
        previous.accounts,
        previous.settings.members,
      );
      return { ...previous, transactions, sharedContributions };
    });
    if (data.sharedContributions.some((item) => contributionReferencesTransaction(item, id, data.transactions))) {
      setNotice("Changing this loan may remove its contribution link if the three-row evidence is no longer valid.");
    }
  }

  function setTransactionCategory(id: string, category: CategoryKey) {
    classifyTransaction(id, { category });
  }

  function setTransactionBeneficiary(id: string, beneficiary: SpendBeneficiary) {
    classifyTransaction(id, { beneficiary });
  }

  function setTransactionKind(id: string, kind: MovementKind) {
    classifyTransaction(id, { kind });
  }

  function setTransactionCounterparty(id: string, counterpartyId: string | undefined) {
    classifyTransaction(id, { counterpartyId });
  }

  function rememberTransactionMerchant(id: string) {
    const current = data.transactions.find((item) => item.id === id);
    if (!current) return;
    if (needsClassificationReview(current)) {
      setNotice("Choose both a purpose and beneficiary before saving a merchant default.");
      return;
    }
    rememberUndo(`Merchant rule for ${current.description}`);
    setData((previous) => {
      const txn = previous.transactions.find((item) => item.id === id);
      if (!txn) return previous;
      const rule: MerchantRule = {
        category: txn.category,
        beneficiary: txn.beneficiarySource === "account_default" ? { type: "account_default" } : txn.beneficiary,
        kind: txn.kind,
        ...(txn.counterpartyId ? { counterpartyId: txn.counterpartyId } : {}),
      };
      const merchantRules = withRule(previous.merchantRules, txn.description, rule);
      const unlocked = previous.transactions.map((item) => item.id === id
        ? { ...item, classificationLocked: undefined }
        : item);
      const transactions = applyRules(unlocked, merchantRules, previous.accounts, previous.settings.members);
      return {
        ...previous,
        merchantRules,
        transactions,
        sharedContributions: pruneSharedContributions(
          previous.sharedContributions,
          transactions,
          previous.accounts,
          previous.settings.members,
        ),
      };
    });
    setNotice(`${current.description} will now use this purpose and beneficiary by default.`);
  }

  function setTransactionAccount(id: string, accountId: string) {
    const current = data.transactions.find((item) => item.id === id);
    const account = data.accounts.find((item) => item.id === accountId);
    if (!current || !account) return;
    rememberUndo(`Account for ${current.description}`);
    setData((previous) => {
      const transactions = previous.transactions.map((txn) => {
        if (txn.id !== id) return txn;
        const assigned = assignAccount(txn, account);
        return applyAccountBeneficiaryDefaults(
          [assigned],
          previous.accounts,
          previous.settings.members,
        )[0]!;
      });
      return {
        ...previous,
        transactions,
        sharedContributions: pruneSharedContributions(
          previous.sharedContributions.filter((item) => !contributionReferencesTransaction(item, id, previous.transactions)),
          transactions,
          previous.accounts,
          previous.settings.members,
        ),
      };
    });
  }

  function updateAccounts(accounts: Account[]) {
    setData((previous) => {
      const linked = applyAccounts(previous.transactions, accounts);
      const defaulted = applyAccountBeneficiaryDefaults(linked, accounts, previous.settings.members);
      const transactions = applyRules(defaulted, previous.merchantRules, accounts, previous.settings.members);
      return {
        ...previous,
        accounts,
        transactions,
        sharedContributions: pruneSharedContributions(previous.sharedContributions, transactions, accounts, previous.settings.members),
      };
    });
  }

  function categorizeMerchant(merchant: string, rule: MerchantRule) {
    rememberUndo(`Rule for ${merchant}`);
    setData((previous) => {
      const merchantRules = withRule(previous.merchantRules, merchant, rule);
      const merchantKey = cleanMerchant(merchant);
      const reviewRowsUnlocked = previous.transactions.map((txn) =>
        txn.classificationLocked
          && cleanMerchant(txn.description) === merchantKey
          && needsClassificationReview(txn)
          ? { ...txn, classificationLocked: undefined }
          : txn,
      );
      const transactions = applyRules(reviewRowsUnlocked, merchantRules, previous.accounts, previous.settings.members);
      return {
        ...previous,
        merchantRules,
        transactions,
        sharedContributions: pruneSharedContributions(previous.sharedContributions, transactions, previous.accounts, previous.settings.members),
      };
    });
  }

  function addManual(entry: ManualEntry) {
    const { accountId, ...manualEntry } = entry;
    const registeredAccount = accountId ? data.accounts.find((account) => account.id === accountId) : undefined;
    const txn: Transaction = {
      id: uid("txn"),
      source: "manual",
      direction: directionForKind(entry.kind),
      classificationLocked: true,
      ...manualEntry,
      account: registeredAccount?.label ?? entry.account,
      ...(registeredAccount ? { accountId: registeredAccount.id } : {}),
    };
    if (!registeredAccount && txn.beneficiarySource === "account_default") delete txn.beneficiarySource;
    if (!txn.counterpartyId) delete txn.counterpartyId;
    setData((previous) => ({
      ...previous,
      transactions: [...previous.transactions, txn].sort((a, b) => a.date.localeCompare(b.date)),
    }));
    setMonth(monthOf(txn.date));
  }

  /** Shared tail for every import route: apply accounts + rules, dedupe, store, notify. */
  function ingestTransactions(parsed: Transaction[], failures: string[], extraNotes: string[] = []): ImportResult {
    const normalized = parsed.map((txn) => normalizeFxTransaction(txn, data.settings.currency));
    const linked = applyAccounts(normalized, data.accounts);
    const defaulted = applyAccountBeneficiaryDefaults(linked, data.accounts, data.settings.members);
    const ruled = applyRules(defaulted, data.merchantRules, data.accounts, data.settings.members);
    const fresh = filterNew(data.transactions, ruled);
    const needsReview = fresh.filter(needsClassificationReview).length;
    if (fresh.length) {
      setData((previous) => ({
        ...previous,
        transactions: [...previous.transactions, ...filterNew(previous.transactions, ruled)].sort((a, b) =>
          a.date.localeCompare(b.date),
        ),
      }));
      setMonth(dominantMonth(fresh));
    }

    // A card statement period straddles a calendar boundary, so an import
    // routinely lands rows in two months while the ledger below shows one.
    // Say so, or the month we land on looks like it lost the other rows.
    const byMonth = new Map<string, number>();
    for (const txn of fresh) byMonth.set(monthOf(txn.date), (byMonth.get(monthOf(txn.date)) ?? 0) + 1);
    const spread = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, count]) => `${monthLabel(month)} (${count})`)
      .join(", ");

    const parts = [
      `Imported ${fresh.length} transaction${fresh.length === 1 ? "" : "s"}; skipped ${ruled.length - fresh.length} duplicate${ruled.length - fresh.length === 1 ? "" : "s"}.`,
      byMonth.size > 1 ? `They span ${byMonth.size} months: ${spread}.` : "",
      needsReview ? `${needsReview} need a purpose or beneficiary — see the review queue under Transactions.` : "",
      ...extraNotes,
      ...failures,
    ].filter(Boolean);
    setNotice(parts.join(" "));
    if (needsReview) {
      setLedgerFilters(EMPTY_LEDGER_FILTERS);
      setView("transactions");
    }
    return { imported: fresh.length, duplicates: ruled.length - fresh.length, needsReview, failures };
  }

  async function importStatements(
    files: File[],
    passwords: Record<string, string>,
    onProgress: (step: string) => void,
  ): Promise<ImportResult> {
    const parsed: Transaction[] = [];
    const failures: string[] = [];
    for (const file of files) {
      try {
        const [parser] = parsersFor(file);
        if (!parser) throw new Error(`Unrecognized statement format: ${file.name}`);
        onProgress(`Parsing ${file.name}`);
        parsed.push(...(await parser.parse(file, passwords[parser.id] ?? "")));
      } catch (error) {
        failures.push(`${file.name}: ${(error as Error).message}`);
      }
    }
    return ingestTransactions(parsed, failures);
  }

  function updateMembers(members: Member[]) {
    const removedNow = data.settings.members
      .filter((member) => !members.some((next) => next.id === member.id))
      .map((member) => member.id);
    setData((previous) => {
      const removed = previous.settings.members.filter((m) => !members.some((next) => next.id === m.id)).map((m) => m.id);
      if (!removed.length) {
        return {
          ...previous,
          sharedContributions: pruneSharedContributions(previous.sharedContributions, previous.transactions, previous.accounts, members),
          incomeReceipts: pruneReceipts(previous.incomeReceipts, members),
          settings: { ...previous.settings, members },
        };
      }
      // Reassign anything that pointed at a removed member so no data is orphaned.
      const hasRemovedBeneficiary = (beneficiary: MerchantRule["beneficiary"]) =>
        beneficiary.type === "member" && removed.includes(beneficiary.memberId);
      const transactions = previous.transactions.map((txn) =>
        hasRemovedBeneficiary(txn.beneficiary)
          ? {
              ...txn,
              beneficiary: UNASSIGNED_BENEFICIARY,
              beneficiarySource: undefined,
              ...(txn.beneficiarySource === "account_default" ? {} : { classificationLocked: true }),
            }
          : txn,
      );
      const fixedCosts = previous.fixedCosts.map((cost) =>
        hasRemovedBeneficiary(cost.beneficiary) ? { ...cost, beneficiary: UNASSIGNED_BENEFICIARY } : cost,
      );
      const merchantRules = Object.fromEntries(
        Object.entries(previous.merchantRules).map(([key, rule]) => [
          key,
          hasRemovedBeneficiary(rule.beneficiary) ? { ...rule, beneficiary: UNASSIGNED_BENEFICIARY } : rule,
        ]),
      );
      const accounts = previous.accounts.map((account) =>
        removed.includes(account.owner) ? { ...account, owner: "joint" } : account,
      );
      const defaultedTransactions = applyAccountBeneficiaryDefaults(
        transactions,
        accounts,
        members,
        { fillUnassigned: false },
      );
      return {
        ...previous,
        transactions: defaultedTransactions,
        fixedCosts,
        merchantRules,
        accounts,
        sharedContributions: pruneSharedContributions(previous.sharedContributions, defaultedTransactions, accounts, members),
        incomeReceipts: pruneReceipts(previous.incomeReceipts, members),
        settings: { ...previous.settings, members },
      };
    });
    if (removedNow.length) {
      setLedgerFilters((current) => ({
        ...current,
        beneficiary: current.beneficiary.startsWith("member:")
          && removedNow.includes(current.beneficiary.slice("member:".length)) ? "all" : current.beneficiary,
        payer: current.payer.startsWith("member:")
          && removedNow.includes(current.payer.slice("member:".length)) ? "all" : current.payer,
      }));
    }
  }

  function recordIncomeReceipts(receipts: IncomeReceipt[]) {
    setData((previous) => {
      const transactionId = receipts[0]?.transactionId;
      const editsExistingGroup = transactionId
        ? previous.incomeReceipts.filter((receipt) => receipt.transactionId === transactionId).length > 1
        : false;
      return {
        ...previous,
        incomeReceipts: transactionId && (receipts.length > 1 || editsExistingGroup)
          ? upsertReceiptGroup(previous.incomeReceipts, receipts)
          : upsertReceipt(previous.incomeReceipts, receipts[0]!),
      };
    });
    setIncomeConfirm(null);
  }

  function addOneOffIncome(memberId: string, portion: IncomePortion) {
    updateMembers(data.settings.members.map((member) => member.id === memberId
      ? { ...member, portions: [...member.portions, portion] }
      : member));
    setModal(null);
    setNotice(`${portion.label} added for ${monthLabel(portion.schedule.frequency === "one_off" ? portion.schedule.month : currentMonth)}.`);
  }

  function unlinkIncomeEvidence(transactionId: string) {
    setData((previous) => ({ ...previous, incomeReceipts: unlinkTransaction(previous.incomeReceipts, transactionId) }));
    setIncomeConfirm(null);
    setNotice("Statement evidence unlinked. Confirmed income amounts were preserved.");
  }

  function removeIncomeConfirmation(monthValue: string, memberId: MemberId, portionId: string) {
    setData((previous) => ({ ...previous, incomeReceipts: removeReceipt(previous.incomeReceipts, monthValue, memberId, portionId) }));
    setIncomeConfirm(null);
  }

  function saveSplit(id: string, split: Split) {
    setData((previous) => {
      const transactions = previous.transactions.map((txn) => (txn.id === id ? { ...txn, split } : txn));
      return {
        ...previous,
        transactions,
        sharedContributions: pruneSharedContributions(
          previous.sharedContributions.filter((item) => !contributionReferencesTransaction(item, id, previous.transactions)),
          transactions,
          previous.accounts,
          previous.settings.members,
        ),
      };
    });
  }

  function clearSplit(id: string) {
    setData((previous) => {
      const transactions = previous.transactions.map((txn) => {
        if (txn.id !== id) return txn;
        const { split: _removed, ...rest } = txn;
        return rest;
      });
      return {
        ...previous,
        transactions,
        sharedContributions: pruneSharedContributions(
          previous.sharedContributions.filter((item) => !contributionReferencesTransaction(item, id, previous.transactions)),
          transactions,
          previous.accounts,
          previous.settings.members,
        ),
      };
    });
  }

  function removeTransaction(id: string) {
    const removedLink = data.sharedContributions.some((item) => contributionReferencesTransaction(item, id, data.transactions));
    setData((previous) => ({
      ...previous,
      transactions: previous.transactions.filter((txn) => txn.id !== id),
      sharedContributions: previous.sharedContributions.filter((item) => !contributionReferencesTransaction(item, id, previous.transactions)),
      incomeReceipts: unlinkTransaction(previous.incomeReceipts, id),
    }));
    if (removedLink) setNotice("The linked contribution was removed and household settlement was recalculated.");
  }

  function deleteRule(merchant: string) {
    rememberUndo(`Rule for ${merchant}`);
    setData((previous) => {
      const key = merchant;
      const merchantRules = { ...previous.merchantRules };
      delete merchantRules[key];
      const reset = previous.transactions.map((txn) => {
        if (txn.classificationLocked || matchingRuleKey(txn.description, previous.merchantRules) !== key) return txn;
        let next: Transaction = {
          ...txn,
          category: "uncategorized",
          kind: defaultKind(txn.direction),
        };
        delete next.counterpartyId;
        next = withAccountBeneficiaryDefault(next, previous.accounts, previous.settings.members);
        return next;
      });
      const transactions = applyRules(reset, merchantRules, previous.accounts, previous.settings.members);
      return {
        ...previous,
        merchantRules,
        transactions,
        sharedContributions: pruneSharedContributions(previous.sharedContributions, transactions, previous.accounts, previous.settings.members),
      };
    });
    setNotice(`Removed the rule for ${merchant}; affected rows returned to review.`);
  }

  function resetTransactionClassification(id: string) {
    const current = data.transactions.find((txn) => txn.id === id);
    if (!current) return;
    rememberUndo(`Classification for ${current.description}`);
    setData((previous) => {
      const reset = previous.transactions.map((item) => {
        if (item.id !== id) return item;
        let next: Transaction = {
          ...item,
          category: "uncategorized",
          kind: defaultKind(item.direction),
          classificationLocked: true,
        };
        delete next.counterpartyId;
        next = withAccountBeneficiaryDefault(next, previous.accounts, previous.settings.members);
        return next;
      });
      return {
        ...previous,
        transactions: reset,
        sharedContributions: pruneSharedContributions(previous.sharedContributions, reset, previous.accounts, previous.settings.members),
      };
    });
    setNotice(`${current.description} returned to review as a one-transaction override.`);
  }

  function updateCounterparties(counterparties: Counterparty[]) {
    setData((previous) => {
      const ids = new Set(counterparties.map((cp) => cp.id));
      // Detach transactions/rules pointing at a removed counterparty so none dangle.
      const transactions = previous.transactions.map((txn) =>
        txn.counterpartyId && !ids.has(txn.counterpartyId) ? { ...txn, counterpartyId: undefined } : txn,
      );
      const merchantRules = Object.fromEntries(
        Object.entries(previous.merchantRules).map(([key, rule]) =>
          rule.counterpartyId && !ids.has(rule.counterpartyId)
            ? [key, { category: rule.category, beneficiary: rule.beneficiary, kind: rule.kind }]
            : [key, rule],
        ),
      );
      return { ...previous, transactions, merchantRules, settings: { ...previous.settings, counterparties } };
    });
  }

  function updateCustomCategories(customCategories: CustomCategory[]) {
    const retainedCategoryKeys = new Set(customCategories.map((category) => `custom:${category.id}`));
    setData((previous) => {
      const reassign = (category: CategoryKey): CategoryKey =>
        category.startsWith("custom:") && !retainedCategoryKeys.has(category) ? "uncategorized" : category;
      const transactions = previous.transactions.map((txn) =>
        txn.category === reassign(txn.category) ? txn : { ...txn, category: reassign(txn.category) },
      );
      const fixedCosts = previous.fixedCosts.map((cost) =>
        cost.category === reassign(cost.category) ? cost : { ...cost, category: reassign(cost.category) },
      );
      const merchantRules = Object.fromEntries(
        Object.entries(previous.merchantRules)
          .map(([key, rule]) => [key, { ...rule, category: reassign(rule.category) }] as const)
          .filter(([, rule]) => rule.category !== "uncategorized"),
      );
      return {
        ...previous,
        transactions,
        fixedCosts,
        merchantRules,
        sharedContributions: pruneSharedContributions(previous.sharedContributions, transactions, previous.accounts, previous.settings.members),
        settings: { ...previous.settings, customCategories },
      };
    });
    setLedgerFilters((current) => current.category.startsWith("custom:")
      && !retainedCategoryKeys.has(current.category)
      ? { ...current, category: "all" }
      : current);
  }

  /** Confirm a suggested transfer pair: mark both legs internal_transfer (not spend). */
  function confirmTransfer(debitId: string, creditId: string) {
    const debit = data.transactions.find((txn) => txn.id === debitId);
    rememberUndo(`Transfer${debit ? ` for ${debit.description}` : ""}`);
    setData((previous) => ({
      ...previous,
      transactions: previous.transactions.map((txn) =>
        txn.id === debitId || txn.id === creditId
          ? {
              ...txn,
              kind: "internal_transfer",
              category: "uncategorized" as CategoryKey,
              beneficiary: UNASSIGNED_BENEFICIARY,
              beneficiarySource: undefined,
              classificationLocked: true,
            }
          : txn,
      ),
    }));
  }

  function saveSharedContribution(contribution: SharedContribution) {
    const error = sharedContributionError(contribution, data.transactions, data.accounts, data.settings.members, data.sharedContributions);
    if (error) {
      setNotice(`Could not link contribution: ${error}`);
      return;
    }
    const contributor = data.settings.members.find((member) => member.id === contribution.contributorMemberId);
    rememberUndo(`Contribution from ${contributor?.name ?? "household member"}`);
    setData((previous) => {
      const transactions = previous.transactions.map((txn) =>
        txn.id === contribution.transferDebitTransactionId || txn.id === contribution.transferCreditTransactionId
          ? {
              ...txn,
              kind: "internal_transfer" as const,
              category: "uncategorized" as CategoryKey,
              beneficiary: UNASSIGNED_BENEFICIARY,
              beneficiarySource: undefined,
              classificationLocked: true,
            }
          : txn,
      );
      const sharedContributions = pruneSharedContributions(
        [...previous.sharedContributions.filter((item) => item.id !== contribution.id), contribution],
        transactions,
        previous.accounts,
        previous.settings.members,
      );
      return { ...previous, transactions, sharedContributions };
    });
    setContributionConfirm(null);
    setNotice(`${contributor?.name ?? "Household member"}'s ${money(contribution.amount)} contribution is linked to the loan payment.`);
  }

  function removeSharedContribution(id: string) {
    setData((previous) => ({
      ...previous,
      sharedContributions: previous.sharedContributions.filter((item) => item.id !== id),
    }));
    setContributionConfirm(null);
    setNotice("The contribution link was removed; its transfer rows remain internal transfers and settlement was recalculated.");
  }

  function exportBackup() {
    const blob = new Blob([serializeBackup(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mizan-backup-${isoDateOf(new Date())}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function finishLegacyMigration() {
    clearLegacyLocalData();
    setLegacyData(null);
    setLegacyPresent(false);
  }

  function importBackup(file: File) {
    if (!repository) {
      setNotice("Create or join a Firestore household before importing a backup.");
      return;
    }
    const activeRepository = repository;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const nextData = parseBackup(String(reader.result));
        const confirmed = window.confirm(
          `Replace the active Firestore household with this verified backup?\n\n`
          + `${nextData.transactions.length} transactions, ${nextData.accounts.length} accounts, `
          + `${nextData.settings.members.length} members, ${nextData.fixedCosts.length} fixed costs, and `
          + `${Object.keys(nextData.merchantRules).length} merchant rules will become authoritative.\n\n`
          + "Export the current household first if you may need to restore it.",
        );
        if (!confirmed) return;
        await saveAuthoritativeSnapshot(activeRepository, nextData);
        setUndoChange(null);
        setNotice("Backup imported to Firestore.");
      } catch (error) {
        setNotice(`That backup file could not be imported: ${(error as Error).message}`);
      }
    };
    reader.readAsText(file);
  }

  function clearAllData() {
    if (!legacyPresent && !hasLegacyLocalData()) {
      setNotice("No legacy browser financial data was found.");
      return;
    }
    if (!window.confirm("Clear old browser-stored Mizan data from this device? The active Firestore household will not be changed.")) return;
    finishLegacyMigration();
    setNotice("Legacy browser financial data cleared.");
  }

  function cancelPendingAutosave() {
    if (saveTimer.current == null) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
  }

  async function flushPendingAutosave(): Promise<void> {
    if (!repository) return;
    if (saveTimer.current != null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      const snapshot = data;
      const activeRepository = repository;
      const version = saveVersion.current;
      const queued = saveQueue.current.catch(() => undefined).then(() => activeRepository.save(snapshot));
      saveQueue.current = queued;
      try {
        await queued;
        completedSaveVersion.current = Math.max(completedSaveVersion.current, version);
      } catch (error) {
        completedSaveVersion.current = Math.max(completedSaveVersion.current, version);
        throw error;
      }
      return;
    }
    await saveQueue.current;
  }

  function acceptAuthoritativeSnapshot(nextData: AppData) {
    skipNextSave.current = true;
    const version = ++saveVersion.current;
    completedSaveVersion.current = version;
    saveQueue.current = Promise.resolve();
    setData(nextData);
  }

  async function saveAuthoritativeSnapshot(activeRepository: DataRepository, nextData: AppData): Promise<void> {
    if (repositoryRef.current !== activeRepository) {
      throw new Error("The active household changed before this operation could start. Nothing was replaced.");
    }
    cancelPendingAutosave();
    // A destructive snapshot must be the final write after anything that has
    // already entered the queue, or an older autosave could restore deleted data.
    const operation = saveAuthoritativeData(activeRepository, saveQueue.current, nextData, (snapshot) => {
      if (repositoryRef.current === activeRepository) acceptAuthoritativeSnapshot(snapshot);
    });
    saveQueue.current = operation;
    await operation;
  }

  async function clearActiveHouseholdTransactions(confirmation: string): Promise<void> {
    if (confirmation !== CLEAR_TRANSACTIONS_CONFIRMATION) {
      throw new Error(`Type ${CLEAR_TRANSACTIONS_CONFIRMATION} exactly to continue.`);
    }
    if (auth.status !== "signed-in" || !repository || !householdMeta) {
      throw new Error("An active Firestore household is required.");
    }
    if (householdMeta.ownerUid !== auth.user.uid) {
      throw new Error("Only the household owner can clear its transactions.");
    }

    const activeRepository = repository;
    const activeHousehold = householdMeta;
    const transactionCount = data.transactions.length;
    if (!transactionCount) {
      setModal(null);
      setNotice("There are no household transactions to clear.");
      return;
    }
    setSyncStatus("Clearing household transactions");

    try {
      await saveAuthoritativeSnapshot(activeRepository, clearTransactionHistory(data));
      setUndoChange(null);
      setDismissedTransfers(new Set());
      setLedgerFilters(EMPTY_LEDGER_FILTERS);
      setSplitTxn(null);
      setIncomeConfirm(null);
      setContributionConfirm(null);
      setCsvFile(null);
      setSyncStatus(`Transactions cleared from ${activeHousehold.name}`);
      setNotice(
        `${transactionCount} transaction${transactionCount === 1 ? "" : "s"} cleared. Accounts and household members were kept.`,
      );
      setModal(null);
    } catch (error) {
      const message = (error as Error).message;
      setSyncStatus(`Transaction clear failed: ${message}`);
      throw new Error(`Could not clear transactions from ${activeHousehold.name}: ${message}`);
    }
  }

  async function resetActiveHousehold(confirmation: string): Promise<void> {
    if (confirmation !== RESET_CONFIRMATION) throw new Error(`Type ${RESET_CONFIRMATION} exactly to continue.`);
    if (auth.status !== "signed-in" || !repository || !householdMeta) {
      throw new Error("An active Firestore household is required.");
    }
    if (householdMeta.ownerUid !== auth.user.uid) {
      throw new Error("Only the household owner can reset its data.");
    }

    const activeRepository = repository;
    const activeHousehold = householdMeta;
    setSyncStatus("Resetting household data");

    try {
      const nextData = emptyData();
      await saveAuthoritativeSnapshot(activeRepository, nextData);
      setUndoChange(null);
      setDismissedTransfers(new Set());
      setMonth("");
      setLedgerFilters(EMPTY_LEDGER_FILTERS);
      setView("home");
      setSplitTxn(null);
      setIncomeConfirm(null);
      setContributionConfirm(null);
      setCsvFile(null);
      setLastCheckInByHousehold((previous) => {
        const next = { ...previous };
        delete next[activeHousehold.id];
        return next;
      });
      if (legacyPresent || hasLegacyLocalData()) finishLegacyMigration();
      setSyncStatus(`Household reset. Ready to set up ${activeHousehold.name}`);
      setNotice(`${activeHousehold.name} was reset. The household and invite are still active.`);
      setModal(null);
    } catch (error) {
      const message = (error as Error).message;
      setSyncStatus(`Reset failed: ${message}`);
      throw new Error(`Could not reset ${activeHousehold.name}: ${message}`);
    }
  }

  async function activateHousehold(
    meta: HouseholdMeta,
    options: {
      persistSelection?: boolean;
      preserveViewState?: boolean;
      activation?: number;
      isCancelled?: () => boolean;
      rethrow?: boolean;
    },
    prepared?: { repo: FirestoreHouseholdRepository; cloudData: AppData },
  ) {
    if (auth.status !== "signed-in" || !services) return false;
    const activation = options.activation ?? ++activationVersion.current;
    const isCancelled = () => activation !== activationVersion.current || options.isCancelled?.() === true;
    try {
      const repo = prepared?.repo ?? new FirestoreHouseholdRepository(services.db, meta.id, auth.user.uid);
      const cloudData = prepared?.cloudData ?? await repo.load();
      if (isCancelled()) return false;
      const nextData = cloudData;

      skipNextSave.current = true;
      saveVersion.current += 1;
      completedSaveVersion.current = saveVersion.current;
      setData(nextData);
      setUndoChange(null);
      if (!options.preserveViewState) {
        setMonth("");
        setLedgerFilters(EMPTY_LEDGER_FILTERS);
      }
      setDismissedTransfers(new Set());
      setModal(null);
      setSplitTxn(null);
      setIncomeConfirm(null);
      setContributionConfirm(null);
      setCsvFile(null);
      setRepository(repo);
      setHouseholdMeta(meta);
      writeLocalConvenience(ACTIVE_HOUSEHOLD_KEY, meta.id);
      setBootstrapError("");
      setBootstrapPhase("ready");
      setSyncStatus(`Synced with ${meta.name}`);
      setNotice(`Using household: ${meta.name}.`);
      if (options.persistSelection === true) {
        void saveUserProfile(services.db, auth.user.uid, { activeHouseholdId: meta.id })
          .catch((error) => setSyncStatus(`Could not save cloud profile: ${(error as Error).message}`));
      }
      return true;
    } catch (error) {
      setNotice((error as Error).message);
      if (options.rethrow) throw error;
      return false;
    }
  }

  async function createHousehold() {
    if (auth.status !== "signed-in" || !services) {
      setNotice("Sign in with Google before creating a household.");
      return;
    }
    const migratingLegacy = Boolean(legacyData && hasLocalFinancialData(legacyData));
    const initialData = migratingLegacy ? legacyData! : emptyData();
    const prompt = migratingLegacy
      ? "Create a Firestore household and migrate this browser's old Mizan data?"
      : "Create a Firestore household for Mizan data?";
    if (!window.confirm(prompt)) return;
    const name = window.prompt("Household name", initialData.settings.members.map((member) => member.name).join(" + ") || "Household");
    if (name === null) return;
    const activation = ++activationVersion.current;
    try {
      await flushPendingAutosave();
      const meta = await createFirestoreHousehold(services.db, auth.user, name, initialData);
      const repo = new FirestoreHouseholdRepository(services.db, meta.id, auth.user.uid);
      if (activation !== activationVersion.current) return;
      const activated = await activateHousehold(meta, { activation }, { repo, cloudData: initialData });
      if (activated && migratingLegacy) finishLegacyMigration();
      void loadUserHouseholds(services.db, auth.user.uid).then(setAvailableHouseholds).catch(() => undefined);
      setNotice(`Household created. Invite code: ${meta.inviteCode}`);
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  async function joinHousehold() {
    if (auth.status !== "signed-in" || !services) {
      setNotice("Sign in with Google before joining a household.");
      return;
    }
    const inviteCode = window.prompt("Paste the household invite code");
    if (!inviteCode) return;
    const activation = ++activationVersion.current;
    try {
      await flushPendingAutosave();
      const meta = await joinFirestoreHousehold(services.db, auth.user, inviteCode);
      if (activation !== activationVersion.current) return;
      await activateHousehold(meta, { activation });
      void loadUserHouseholds(services.db, auth.user.uid).then(setAvailableHouseholds).catch(() => undefined);
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  async function switchHousehold(householdId: string) {
    if (auth.status !== "signed-in" || !services || !householdId) return;
    const activation = ++activationVersion.current;
    try {
      await flushPendingAutosave();
      const meta = await loadHouseholdMeta(services.db, householdId);
      if (activation !== activationVersion.current) return;
      await activateHousehold(meta, { activation });
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  async function rotateInvite() {
    if (!householdMeta || !services) return;
    try {
      const meta = await rotateFirestoreInvite(services.db, householdMeta.id);
      setHouseholdMeta(meta);
      setNotice(`New invite code: ${meta.inviteCode}`);
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  async function handleSignIn() {
    setNotice("");
    try {
      await signInWithGoogle();
      setNotice("Signed in with Google.");
    } catch (error) {
      setNotice(authErrorMessage(error));
    }
  }

  async function handleSignOut() {
    try {
      await flushPendingAutosave();
    } catch (error) {
      setNotice(`Could not sign out because the latest household edit was not saved: ${(error as Error).message}`);
      return;
    }
    activationVersion.current += 1;
    await signOutUser();
    setRepository(null);
    setHouseholdMeta(null);
    setAvailableHouseholds([]);
    setData(emptyData());
    setLastCheckInByHousehold({});
    profileLoaded.current = false;
    setBootstrapPhase("idle");
    setBootstrapError("");
    setSyncStatus("Signed out");
  }

  function completeWeeklyCheckIn() {
    if (!householdMeta) return;
    const checkedAt = new Date().toISOString();
    setLastCheckInByHousehold((previous) => ({ ...previous, [householdMeta.id]: checkedAt }));
    setNotice("Weekly money check-in recorded. Come back after your next statement update, or within seven days.");
  }

  const canResetHousehold =
    auth.status === "signed-in" && Boolean(householdMeta) && householdMeta?.ownerUid === auth.user.uid;
  const canClearTransactions = canResetHousehold;
  const hasResettableData = hasLocalFinancialData(data);
  const clearTransactionsModal =
    modal === "clear-transactions" && householdMeta && canClearTransactions && data.transactions.length > 0 ? (
      <ClearTransactionsModal
        householdName={householdMeta.name}
        data={data}
        onExport={exportBackup}
        onClear={clearActiveHouseholdTransactions}
        onClose={() => setModal(null)}
      />
    ) : null;
  const resetModal =
    modal === "reset" && householdMeta && canResetHousehold ? (
      <ResetHouseholdModal
        householdName={householdMeta.name}
        data={data}
        onExport={exportBackup}
        onReset={resetActiveHousehold}
        onClose={() => setModal(null)}
      />
    ) : null;

  const syncHasError = /failed|could not/i.test(syncStatus);
  const syncLabel = syncHasError
    ? "Sync issue"
    : syncStatus.startsWith("Synced") || syncStatus.startsWith("Listening")
      ? "Synced"
      : /saving|loading/i.test(syncStatus)
        ? "Syncing"
        : "Firestore";

  if (auth.status !== "signed-in") {
    return <AuthGate auth={auth} notice={notice} onSignIn={handleSignIn} />;
  }

  if (!repository) {
    const loadingProfile = bootstrapPhase === "idle" || bootstrapPhase === "loading-profile";
    const loadingHousehold = bootstrapPhase === "loading-household";
    const needsHousehold = bootstrapPhase === "needs-household";
    const failedBootstrap = bootstrapPhase === "error";
    return (
      <main className="app onboarding">
        <section className="home-hero tight onboard-wide auth-gate">
          <div className="onboard-intro">
            <div className="wordmark"><span className="wordmark-mark">M</span><span>Mizan</span></div>
            <h2>{needsHousehold ? "Choose a Firestore household" : failedBootstrap ? "Could not open your household" : "Getting Mizan ready"}</h2>
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
                  : failedBootstrap
                    ? "Household load interrupted"
                    : syncStatus}
            </strong>
            <p className="muted">Raw statement files and passwords stay on this device while imports are processed.</p>
            {needsHousehold && (
              <div className="sync-actions sync-main-actions">
                <button onClick={createHousehold}>Create household</button>
                <button className="secondary" onClick={joinHousehold}>Join with invite</button>
              </div>
            )}
            {failedBootstrap && (
              <div className="sync-actions sync-main-actions">
                <button onClick={() => setBootstrapAttempt((attempt) => attempt + 1)}>Retry household load</button>
                <button className="secondary" onClick={createHousehold}>Create household</button>
                <button className="secondary" onClick={joinHousehold}>Join with invite</button>
                <button className="secondary" onClick={handleSignOut}>Sign out</button>
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

  if (!data.settings.members.length) {
    return (
      <>
        <OnboardingView
          sync={{
            auth,
            mode: repository.mode,
            status: syncStatus,
            household: householdMeta,
            households: availableHouseholds,
          }}
          onSignIn={handleSignIn}
          onOpenSettings={() => setModal("settings")}
          onComplete={(result) => setData((previous) => ({ ...previous, settings: { ...previous.settings, ...result } }))}
        />
        {modal === "settings" && (
          <SettingsModal
            data={data}
            onUpdateMembers={updateMembers}
            onUpdateTarget={(targetSaveRate) =>
              setData((previous) => ({ ...previous, settings: { ...previous.settings, targetSaveRate } }))
            }
            onUpdateCurrency={(currency, locale) =>
              setData((previous) => ({ ...previous, settings: { ...previous.settings, currency, locale } }))
            }
            onUpdateFxRates={(fxRates) => setData((previous) => ({ ...previous, settings: { ...previous.settings, fxRates } }))}
            onUpdateFixedCosts={(fixedCosts) => setData((previous) => ({ ...previous, fixedCosts }))}
            onUpdateAccounts={updateAccounts}
            onDeleteRule={deleteRule}
            onUpdateCounterparties={updateCounterparties}
            onUpdateCustomCategories={updateCustomCategories}
            sync={{
              auth,
              mode: repository.mode,
              status: syncStatus,
              household: householdMeta,
              households: availableHouseholds,
            }}
            onSignIn={handleSignIn}
            onSignOut={handleSignOut}
            onCreateHousehold={createHousehold}
            onJoinHousehold={joinHousehold}
            onSwitchHousehold={switchHousehold}
            onRotateInvite={rotateInvite}
            onExport={exportBackup}
            onImportBackup={importBackup}
            onClearData={clearAllData}
            canClearTransactions={canClearTransactions}
            hasTransactions={data.transactions.length > 0}
            onClearTransactions={() => setModal("clear-transactions")}
            canResetHousehold={canResetHousehold}
            hasResettableData={hasResettableData}
            onResetHousehold={() => setModal("reset")}
            onClose={() => setModal(null)}
          />
        )}
        {clearTransactionsModal}
        {resetModal}
      </>
    );
  }

  return (
    <main className="app">
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
              title={syncStatus}
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
              label={privacy ? "Show amounts" : "Hide amounts"}
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
            <MonthNavigator
              value={currentMonth}
              months={navigationMonths}
              todayMonth={todayMonth}
              onChange={setMonth}
            />
            <button className="secondary" onClick={() => setModal("manual")}>Add transaction</button>
            <button onClick={() => setModal("import")}>Import activity</button>
            </>
          }
        />

        {notice && <div className="notice" role="status" aria-live="polite">{notice}</div>}

        {view === "home" && (
          <HomeView
            summary={summary}
            money={money}
            currencyMoney={currencyMoney}
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
            contributionCandidates={contributionCandidates.filter((candidate) => candidate.expenses.some((expense) => monthOf(expense.date) === currentMonth))}
            members={data.settings.members}
            onConfirmContribution={(candidate) => setContributionConfirm({ candidate })}
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
              setDismissedTransfers((previous) => new Set(previous).add(`${debitId}:${creditId}`))
            }
            onSplit={setSplitTxn}
            onRemove={removeTransaction}
            incomeLinkedIds={incomeLinkedIds}
            allTransactions={data.transactions}
            sharedContributions={data.sharedContributions}
            onLinkContribution={(expenseId) => setContributionConfirm({ expenseId })}
            onEditContribution={(contribution) => setContributionConfirm({ contribution })}
          />
        )}
        {view === "history" && <HistoryView rows={history} currentMonth={currentMonth} targetSaveRate={summary.targetSaveRate} money={money} />}
      </section>

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
          onImport={(transactions, skipped) =>
            ingestTransactions(transactions, [], skipped ? [`${skipped} CSV row${skipped === 1 ? "" : "s"} skipped.`] : [])
          }
          onSavePreset={(signature, mapping) =>
            setData((previous) => ({
              ...previous,
              settings: { ...previous.settings, csvPresets: { ...previous.settings.csvPresets, [signature]: mapping } },
            }))
          }
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
      {modal === "settings" && (
        <SettingsModal
          data={data}
          onUpdateMembers={updateMembers}
          onUpdateTarget={(targetSaveRate) =>
            setData((previous) => ({ ...previous, settings: { ...previous.settings, targetSaveRate } }))
          }
          onUpdateCurrency={(currency, locale) =>
            setData((previous) => ({ ...previous, settings: { ...previous.settings, currency, locale } }))
          }
          onUpdateFxRates={(fxRates) => setData((previous) => ({ ...previous, settings: { ...previous.settings, fxRates } }))}
          onUpdateFixedCosts={(fixedCosts) => setData((previous) => ({ ...previous, fixedCosts }))}
          onUpdateAccounts={updateAccounts}
          onDeleteRule={deleteRule}
          onUpdateCounterparties={updateCounterparties}
          onUpdateCustomCategories={updateCustomCategories}
          sync={{
            auth,
            mode: repository.mode,
            status: syncStatus,
            household: householdMeta,
            households: availableHouseholds,
          }}
          onSignIn={handleSignIn}
          onSignOut={handleSignOut}
          onCreateHousehold={createHousehold}
          onJoinHousehold={joinHousehold}
          onSwitchHousehold={switchHousehold}
          onRotateInvite={rotateInvite}
          onExport={exportBackup}
          onImportBackup={importBackup}
          onClearData={clearAllData}
          canClearTransactions={canClearTransactions}
          hasTransactions={data.transactions.length > 0}
          onClearTransactions={() => setModal("clear-transactions")}
          canResetHousehold={canResetHousehold}
          hasResettableData={hasResettableData}
          onResetHousehold={() => setModal("reset")}
          onClose={() => setModal(null)}
        />
      )}
      {clearTransactionsModal}
      {resetModal}
      {splitTxn && (
        <SplitModal
          txn={splitTxn}
          onSave={saveSplit}
          onClear={clearSplit}
          onClose={() => setSplitTxn(null)}
        />
      )}
      {incomeConfirm && (
        <IncomeConfirmModal
          item={incomeConfirm.item}
          allocationItems={summary.incomeItems.filter((item) => item.memberId === incomeConfirm.item.memberId)}
          candidate={incomeConfirm.candidate}
          linkedTransaction={data.transactions.find(
            (transaction) => transaction.id === (incomeConfirm.item.receipt?.transactionId ?? incomeConfirm.candidate?.transaction.id),
          )}
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
          onRemove={() => removeIncomeConfirmation(incomeConfirm.item.month, incomeConfirm.item.memberId, incomeConfirm.item.portion.id)}
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
    </main>
  );
}
