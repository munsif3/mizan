import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BarChart2, ChevronLeft, ChevronRight, Eye, EyeOff, Home, List, Moon, Settings, Sun } from "lucide-react";
import { authErrorMessage, signInWithGoogle, signOutUser, useAuthState } from "./auth/authStore";
import { applyAccounts, assignAccount, resolveAccountLabel, transactionDisplayCurrency } from "./domain/accounts";
import { dominantMonth, isoDateOf, monthLabel, monthOf } from "./domain/dates";
import {
  detectSharedContributionCandidates,
  contributionReferencesTransaction,
  pruneSharedContributions,
  sharedContributionError,
  type SharedContributionCandidate,
} from "./domain/contributions";
import { filterNew } from "./domain/dedupe";
import { normalizeFxTransaction } from "./domain/fx";
import { pruneReceipts, removeReceipt, unlinkTransaction, upsertReceipt, type PortionResolution } from "./domain/income";
import { detectIncomeCandidates, eligibleCredits, type IncomeCandidate } from "./domain/incomeMatch";
import { formatMoney } from "./domain/money";
import { directionForKind } from "./domain/movements";
import { applyRules, matchingRuleKey, withRule } from "./domain/rules";
import { computeHistory, computeMonthSummary, monthsWithData, reviewQueue } from "./domain/summary";
import { detectTransferCandidates } from "./domain/transfers";
import {
  defaultKind,
  personalCategory,
  uid,
  type AppData,
  type CategoryKey,
  type Account,
  type Counterparty,
  type CustomCategory,
  type IncomeReceipt,
  type MerchantRule,
  type Member,
  type MovementKind,
  type OwnerFilter,
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
import { type DataRepository } from "./storage/repository";
import { emptyData } from "./storage/schema";
import { AuthGate } from "./ui/AuthGate";
import { IconButton, PageHeader } from "./ui/bits";
import { HistoryView } from "./ui/HistoryView";
import { HomeView } from "./ui/HomeView";
import { ImportModal, type ImportResult } from "./ui/ImportModal";
import { IncomeConfirmModal } from "./ui/IncomeConfirmModal";
import { CsvImportModal } from "./ui/CsvImportModal";
import { ManualModal, type ManualEntry } from "./ui/ManualModal";
import { OnboardingView } from "./ui/OnboardingView";
import { RESET_CONFIRMATION, ResetHouseholdModal } from "./ui/ResetHouseholdModal";
import { SettingsModal } from "./ui/SettingsModal";
import { SplitModal } from "./ui/SplitModal";
import { SharedContributionModal } from "./ui/SharedContributionModal";
import { TransactionsView } from "./ui/TransactionsView";

type View = "home" | "transactions" | "history";
type ModalKind = null | "import" | "manual" | "settings" | "reset";
type BootstrapPhase = "idle" | "loading-profile" | "loading-household" | "needs-household" | "ready" | "error";

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
  home: "Weekly review of month health, next actions, and shared household balance.",
  transactions: "Review merchants, filter the ledger, and correct categories.",
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
  const profileLoaded = useRef(false);
  const [repository, setRepository] = useState<DataRepository | null>(null);
  const [data, setData] = useState<AppData>(() => emptyData());
  const [legacyData, setLegacyData] = useState<AppData | null>(() => loadLegacyLocalData());
  const [legacyPresent, setLegacyPresent] = useState(() => hasLegacyLocalData());
  const [view, setView] = useState<View>("home");
  const [month, setMonth] = useState("");
  const [owner, setOwner] = useState<OwnerFilter>("all");
  const [privacy, setPrivacy] = useState(() => readLocalConvenience(PRIVACY_KEY) === "true");
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);
  const [categoryFilter, setCategoryFilter] = useState<CategoryKey | "all">("all");
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
        .catch((error) => {
          completedSaveVersion.current = Math.max(completedSaveVersion.current, version);
          if (version === saveVersion.current) setSyncStatus(`Save failed: ${(error as Error).message}`);
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
        setOwner(profile.ownerFilter || "all");
        setCategoryFilter((profile.categoryFilter || "all") as CategoryKey | "all");
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
            migrateLegacy: true,
            persistSelection: profile.activeHouseholdId !== householdId,
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
        ownerFilter: owner,
        categoryFilter,
        lastCheckInByHousehold,
      }).catch((error) => setSyncStatus(`Could not save cloud profile: ${(error as Error).message}`));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [auth, services, householdMeta?.id, privacy, theme, view, month, owner, categoryFilter, lastCheckInByHousehold]);

  useEffect(() => {
    if (!repository || bootstrapPhase !== "ready") return;
    startupMark("home-ready");
    startupMeasure("auth-to-home", "auth-ready", "home-ready");
    startupMeasure("total", "auth-start", "home-ready");
    reportStartupTiming();
  }, [repository, bootstrapPhase]);

  const today = new Date();
  const todayMonth = isoDateOf(today).slice(0, 7);
  const months = useMemo(() => monthsWithData(data, new Date()), [data]);
  const currentMonth = month || months[months.length - 1] || todayMonth;
  const summary = useMemo(
    () => computeMonthSummary(data, currentMonth, owner, new Date()),
    [data, currentMonth, owner],
  );
  const queue = useMemo(() => reviewQueue(data.transactions), [data]);
  const history = useMemo(() => computeHistory(data, months, new Date()), [data, months]);
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

  /**
   * Reclassify one transaction (category / kind / counterparty) and remember the
   * choice as a merchant rule, so every occurrence — past and future — follows.
   * The rule captures the transaction's full resulting classification.
   */
  function classifyTransaction(id: string, patch: Partial<Pick<Transaction, "category" | "kind" | "counterpartyId">>) {
    const current = data.transactions.find((item) => item.id === id);
    if (!current) return;
    rememberUndo(`Classification for ${current.description}`);
    setData((previous) => {
      const txn = previous.transactions.find((item) => item.id === id);
      if (!txn) return previous;
      const next: Transaction = { ...txn, ...patch };
      if (!next.counterpartyId) delete next.counterpartyId;
      const rule: MerchantRule = {
        category: next.category,
        kind: next.kind,
        ...(next.counterpartyId ? { counterpartyId: next.counterpartyId } : {}),
      };
      const merchantRules = withRule(previous.merchantRules, txn.description, rule);
      const transactions = applyRules(
        previous.transactions.map((item) => (item.id === id ? next : item)),
        merchantRules,
      );
      const sharedContributions = pruneSharedContributions(
        previous.sharedContributions.filter((item) => !contributionReferencesTransaction(item, id, previous.transactions)),
        transactions,
        previous.accounts,
        previous.settings.members,
      );
      return { ...previous, merchantRules, transactions, sharedContributions };
    });
    if (data.sharedContributions.some((item) => contributionReferencesTransaction(item, id, data.transactions))) {
      setNotice("Changing this loan may remove its contribution link if the three-row evidence is no longer valid.");
    }
  }

  function setTransactionCategory(id: string, category: CategoryKey) {
    classifyTransaction(id, { category });
  }

  function setTransactionKind(id: string, kind: MovementKind) {
    classifyTransaction(id, { kind });
  }

  function setTransactionCounterparty(id: string, counterpartyId: string | undefined) {
    classifyTransaction(id, { counterpartyId });
  }

  function setTransactionAccount(id: string, accountId: string) {
    const current = data.transactions.find((item) => item.id === id);
    const account = data.accounts.find((item) => item.id === accountId);
    if (!current || !account) return;
    rememberUndo(`Account for ${current.description}`);
    setData((previous) => {
      const transactions = previous.transactions.map((txn) => (txn.id === id ? assignAccount(txn, account) : txn));
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
      const transactions = applyAccounts(previous.transactions, accounts);
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
      const transactions = applyRules(previous.transactions, merchantRules);
      return {
        ...previous,
        merchantRules,
        transactions,
        sharedContributions: pruneSharedContributions(previous.sharedContributions, transactions, previous.accounts, previous.settings.members),
      };
    });
  }

  function addManual(entry: ManualEntry) {
    const account = resolveAccountLabel(entry.account, data.accounts);
    const txn: Transaction = { id: uid("txn"), source: "manual", direction: directionForKind(entry.kind), ...entry, account };
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
    const ruled = applyRules(applyAccounts(normalized, data.accounts), data.merchantRules);
    const fresh = filterNew(data.transactions, ruled);
    const needsReview = fresh.filter((txn) => txn.category === "uncategorized" && txn.direction !== "credit").length;
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
      needsReview ? `${needsReview} need a category — see the review queue under Transactions.` : "",
      ...extraNotes,
      ...failures,
    ].filter(Boolean);
    setNotice(parts.join(" "));
    if (needsReview) setView("transactions");
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
      const removedCategories = new Set<CategoryKey>(removed.map(personalCategory));
      const transactions = previous.transactions.map((txn) =>
        removedCategories.has(txn.category) ? { ...txn, category: "uncategorized" as CategoryKey } : txn,
      );
      const fixedCosts = previous.fixedCosts.map((cost) =>
        removedCategories.has(cost.category) ? { ...cost, category: "uncategorized" as CategoryKey } : cost,
      );
      const merchantRules = Object.fromEntries(
        Object.entries(previous.merchantRules).filter(([, rule]) => !removedCategories.has(rule.category)),
      );
      const accounts = previous.accounts.map((account) =>
        removed.includes(account.owner) ? { ...account, owner: "joint" } : account,
      );
      return {
        ...previous,
        transactions,
        fixedCosts,
        merchantRules,
        accounts,
        sharedContributions: pruneSharedContributions(previous.sharedContributions, transactions, accounts, members),
        incomeReceipts: pruneReceipts(previous.incomeReceipts, members),
        settings: { ...previous.settings, members },
      };
    });
  }

  function recordIncomeReceipt(receipt: IncomeReceipt) {
    setData((previous) => ({ ...previous, incomeReceipts: upsertReceipt(previous.incomeReceipts, receipt) }));
    setIncomeConfirm(null);
  }

  function removeIncomeConfirmation(monthValue: string, portionId: string) {
    setData((previous) => ({ ...previous, incomeReceipts: removeReceipt(previous.incomeReceipts, monthValue, portionId) }));
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
        if (matchingRuleKey(txn.description, previous.merchantRules) !== key) return txn;
        const next: Transaction = {
          ...txn,
          category: "uncategorized",
          kind: defaultKind(txn.direction),
        };
        delete next.counterpartyId;
        return next;
      });
      const transactions = applyRules(reset, merchantRules);
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
      const txn = previous.transactions.find((item) => item.id === id);
      if (!txn) return previous;
      const key = matchingRuleKey(txn.description, previous.merchantRules);
      const merchantRules = { ...previous.merchantRules };
      if (key) delete merchantRules[key];
      const reset = previous.transactions.map((item) => {
        if (key ? matchingRuleKey(item.description, previous.merchantRules) !== key : item.id !== id) return item;
        const next: Transaction = {
          ...item,
          category: "uncategorized",
          kind: defaultKind(item.direction),
        };
        delete next.counterpartyId;
        return next;
      });
      const transactions = applyRules(reset, merchantRules);
      return {
        ...previous,
        merchantRules,
        transactions,
        sharedContributions: pruneSharedContributions(previous.sharedContributions, transactions, previous.accounts, previous.settings.members),
      };
    });
    setNotice(`${current.description} returned to review${matchingRuleKey(current.description, data.merchantRules) ? ", including matching rows" : ""}.`);
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
          rule.counterpartyId && !ids.has(rule.counterpartyId) ? [key, { category: rule.category, kind: rule.kind }] : [key, rule],
        ),
      );
      return { ...previous, transactions, merchantRules, settings: { ...previous.settings, counterparties } };
    });
  }

  function updateCustomCategories(customCategories: CustomCategory[]) {
    setData((previous) => {
      const keep = new Set(customCategories.map((c) => `custom:${c.id}`));
      const reassign = (category: CategoryKey): CategoryKey =>
        category.startsWith("custom:") && !keep.has(category) ? "uncategorized" : category;
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
  }

  /** Confirm a suggested transfer pair: mark both legs internal_transfer (not spend). */
  function confirmTransfer(debitId: string, creditId: string) {
    const debit = data.transactions.find((txn) => txn.id === debitId);
    rememberUndo(`Transfer${debit ? ` for ${debit.description}` : ""}`);
    setData((previous) => ({
      ...previous,
      transactions: previous.transactions.map((txn) =>
        txn.id === debitId || txn.id === creditId
          ? { ...txn, kind: "internal_transfer", category: "uncategorized" as CategoryKey }
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
          ? { ...txn, kind: "internal_transfer" as const, category: "uncategorized" as CategoryKey }
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
    if (
      !window.confirm(
        "Import this backup? It will replace the active Firestore household data - transactions, rules, and your account registry. Export a backup first if in doubt.",
      )
    ) {
      return;
    }
    const activeRepository = repository;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const nextData = parseBackup(String(reader.result));
        await activeRepository.save(nextData);
        skipNextSave.current = true;
        setData(nextData);
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
    cancelPendingAutosave();
    setSyncStatus("Resetting household data");

    try {
      // Let any save that already entered the queue finish, then make the reset
      // the final write. The cancelled debounce above prevents a not-yet-queued
      // stale save from restoring the old household after this completes.
      await saveQueue.current.catch(() => undefined);
      const nextData = emptyData();
      await activeRepository.save(nextData);

      skipNextSave.current = true;
      const version = ++saveVersion.current;
      completedSaveVersion.current = version;
      saveQueue.current = Promise.resolve();
      setData(nextData);
      setUndoChange(null);
      setDismissedTransfers(new Set());
      setMonth("");
      setOwner("all");
      setCategoryFilter("all");
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
      try {
        const serverData = await activeRepository.load();
        skipNextSave.current = true;
        const version = ++saveVersion.current;
        completedSaveVersion.current = version;
        setData(serverData);
      } catch {
        // Keep the current local snapshot if Firestore is unavailable. A later
        // sync or retry will reconcile it without claiming reset success.
      }
      setSyncStatus(`Reset failed: ${message}`);
      throw new Error(`Could not reset ${activeHousehold.name}: ${message}`);
    }
  }

  async function activateHousehold(
    meta: HouseholdMeta,
    options: {
      migrateLegacy: boolean;
      persistSelection?: boolean;
      isCancelled?: () => boolean;
      rethrow?: boolean;
    },
    prepared?: { repo: FirestoreHouseholdRepository; cloudData: AppData },
  ) {
    if (auth.status !== "signed-in" || !services) return false;
    try {
      const repo = prepared?.repo ?? new FirestoreHouseholdRepository(services.db, meta.id, auth.user.uid);
      const cloudData = prepared?.cloudData ?? await repo.load();
      if (options.isCancelled?.()) return false;
      let nextData = cloudData;
      let migrated = false;

      if (options.migrateLegacy && legacyData && hasLocalFinancialData(legacyData)) {
        await repo.save(legacyData);
        if (options.isCancelled?.()) return false;
        nextData = legacyData;
        finishLegacyMigration();
        migrated = true;
      }

      skipNextSave.current = true;
      saveVersion.current += 1;
      completedSaveVersion.current = saveVersion.current;
      setData(nextData);
      setUndoChange(null);
      setRepository(repo);
      setHouseholdMeta(meta);
      writeLocalConvenience(ACTIVE_HOUSEHOLD_KEY, meta.id);
      setBootstrapError("");
      setBootstrapPhase("ready");
      setSyncStatus(`Synced with ${meta.name}`);
      setNotice(migrated ? `Migrated browser data to ${meta.name} and cleared local financial storage.` : `Using household: ${meta.name}.`);
      if (options.persistSelection !== false) {
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
    const initialData = legacyData && hasLocalFinancialData(legacyData) ? legacyData : data;
    const prompt = legacyData && hasLocalFinancialData(legacyData)
      ? "Create a Firestore household and migrate this browser's old Mizan data?"
      : "Create a Firestore household for Mizan data?";
    if (!window.confirm(prompt)) return;
    const name = window.prompt("Household name", initialData.settings.members.map((member) => member.name).join(" + ") || "Household");
    if (name === null) return;
    try {
      const meta = await createFirestoreHousehold(services.db, auth.user, name, initialData);
      await activateHousehold(meta, { migrateLegacy: Boolean(legacyData && hasLocalFinancialData(legacyData)) });
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
    try {
      const meta = await joinFirestoreHousehold(services.db, auth.user, inviteCode);
      await activateHousehold(meta, { migrateLegacy: true });
      void loadUserHouseholds(services.db, auth.user.uid).then(setAvailableHouseholds).catch(() => undefined);
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  async function switchHousehold(householdId: string) {
    if (auth.status !== "signed-in" || !services || !householdId) return;
    try {
      const meta = await loadHouseholdMeta(services.db, householdId);
      await activateHousehold(meta, { migrateLegacy: true });
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
  const hasResettableData = hasLocalFinancialData(data);
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

  const monthIndex = months.indexOf(currentMonth);
  const syncHasError = /failed|could not/i.test(syncStatus);
  const syncLabel = syncHasError
    ? "Sync issue"
    : syncStatus.startsWith("Synced")
      ? "Synced"
      : /saving|loading|listening/i.test(syncStatus)
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
                Legacy browser financial data was found. It will be uploaded to the selected household and then cleared
                from this browser.
              </div>
            )}
            {failedBootstrap && bootstrapError && <div className="notice">{bootstrapError}</div>}
            {notice && !failedBootstrap && <div className="notice">{notice}</div>}
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
              </div>
            )}
            {needsHousehold && availableHouseholds.length > 0 && (
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
            canResetHousehold={canResetHousehold}
            hasResettableData={hasResettableData}
            onResetHousehold={() => setModal("reset")}
            onClose={() => setModal(null)}
          />
        )}
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
              <button key={id} className={`nav-item ${view === id ? "active" : ""}`} onClick={() => setView(id)}>
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
          context={
            <div className="person-seg" role="tablist" aria-label="Filter by person">
              <button
                role="tab"
                aria-selected={owner === "all"}
                className={`ps-btn ${owner === "all" ? "active" : ""}`}
                onClick={() => setOwner("all")}
              >
                All household
              </button>
              {data.settings.members.map((member) => (
                <button
                  key={member.id}
                  role="tab"
                  aria-selected={owner === member.id}
                  className={`ps-btn ${owner === member.id ? "active" : ""}`}
                  style={owner === member.id ? ({ "--person": member.color } as React.CSSProperties) : undefined}
                  onClick={() => setOwner(member.id)}
                >
                  <span className="ps-dot" style={{ background: member.color }} />
                  {member.name}
                </button>
              ))}
            </div>
          }
          actions={
            <>
            <div className="month-nav">
              <IconButton
                label="Previous month"
                icon={ChevronLeft}
                disabled={monthIndex <= 0}
                onClick={() => monthIndex > 0 && setMonth(months[monthIndex - 1]!)}
              />
              <select aria-label="Month" value={currentMonth} onChange={(event) => setMonth(event.target.value)}>
                {months.map((item) => (
                  <option key={item} value={item}>{monthLabel(item)}</option>
                ))}
              </select>
              <IconButton
                label="Next month"
                icon={ChevronRight}
                disabled={monthIndex < 0 || monthIndex >= months.length - 1}
                onClick={() => monthIndex >= 0 && monthIndex < months.length - 1 && setMonth(months[monthIndex + 1]!)}
              />
            </div>
            <button className="secondary" onClick={() => setModal("manual")}>+ Manual</button>
            <button onClick={() => setModal("import")}>Import</button>
            </>
          }
        />

        {notice && <div className="notice">{notice}</div>}

        {view === "home" && (
          <HomeView
            summary={summary}
            money={money}
            lastCheckInAt={householdMeta ? (lastCheckInByHousehold[householdMeta.id] ?? "") : ""}
            onOpenSettings={() => setModal("settings")}
            onOpenImport={() => setModal("import")}
            onReviewQueue={() => setView("transactions")}
            onCompleteCheckIn={completeWeeklyCheckIn}
            incomeCandidates={incomeCandidateMap}
            onConfirmIncome={(item, candidate) => setIncomeConfirm({ item, ...(candidate ? { candidate } : {}) })}
            contributionCandidates={contributionCandidates.filter((candidate) => candidate.expenses.some((expense) => monthOf(expense.date) === currentMonth))}
            members={data.settings.members}
            onConfirmContribution={(candidate) => setContributionConfirm({ candidate })}
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
            categoryFilter={categoryFilter}
            onCategoryFilter={setCategoryFilter}
            money={money}
            transactionMoney={transactionMoney}
            onSetCategory={setTransactionCategory}
            onSetKind={setTransactionKind}
            onSetCounterparty={setTransactionCounterparty}
            onSetAccount={setTransactionAccount}
            onCategorizeMerchant={categorizeMerchant}
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
          accountOptions={data.accounts.map((account) => account.label)}
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
          canResetHousehold={canResetHousehold}
          hasResettableData={hasResettableData}
          onResetHousehold={() => setModal("reset")}
          onClose={() => setModal(null)}
        />
      )}
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
          transactionMoney={transactionMoney}
          onSave={recordIncomeReceipt}
          onRemove={() => removeIncomeConfirmation(incomeConfirm.item.month, incomeConfirm.item.portion.id)}
          onClose={() => setIncomeConfirm(null)}
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
