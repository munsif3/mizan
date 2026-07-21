import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { authErrorMessage, signInWithGoogle, signOutUser, useAuthState } from "../auth/authStore";
import { categoryOptions } from "../domain/categories";
import { clearTransactionHistory } from "../domain/dataCleanup";
import type { AppData, CategoryKey } from "../domain/types";
import { getFirebaseServices } from "../firebase/client";
import {
  FirestoreHouseholdRepository,
  createFirestoreHousehold,
  joinFirestoreHousehold,
  loadHouseholdMeta,
  loadUserHouseholds,
  loadUserProfile,
  rotateFirestoreInvite,
  saveUserProfile,
} from "../household/firestoreRepository";
import { hasLocalFinancialData } from "../household/households";
import { sync, type SyncState } from "./syncState";
import type { HouseholdMeta, ThemePreference, UserHouseholdLink } from "../household/types";
import { clearLegacyLocalData, hasLegacyLocalData, loadLegacyLocalData } from "../storage/legacyBrowserData";
import { saveAuthoritativeData, type DataRepository } from "../storage/repository";
import { emptyData } from "../storage/schema";
import { CLEAR_TRANSACTIONS_CONFIRMATION } from "../ui/ClearTransactionsModal";
import { RESET_CONFIRMATION } from "../ui/ResetHouseholdModal";
import type { BeneficiaryFilter, LedgerFilters, PayerFilter } from "../ui/TransactionsView";

export type View = "home" | "transactions" | "history";
export type BootstrapPhase = "idle" | "loading-profile" | "loading-household" | "needs-household" | "ready" | "error";

export type ConflictResolution = "keep-local" | "keep-remote";

/**
 * A save was rejected because the household changed on another device. Rather
 * than silently discarding the unsaved edit, both versions are held so the user
 * can choose which one wins.
 */
export interface HouseholdConflict {
  /** The local edit whose save was rejected. */
  local: AppData;
  /** The newer cloud state that caused the rejection. */
  remote: AppData;
}

export const EMPTY_LEDGER_FILTERS: LedgerFilters = {
  category: "all",
  beneficiary: "all",
  payer: "all",
};

const ACTIVE_HOUSEHOLD_KEY = "mizan.activeHouseholdId";
const PRIVACY_KEY = "mizan.privacy";
const THEME_KEY = "mizan.theme";
const STARTUP_MARKS = ["auth-start", "auth-ready", "profile-start", "profile-ready", "household-start", "meta-ready", "data-ready", "home-ready"] as const;

interface SessionCallbacks {
  clearUndo: () => void;
  resetTransientState: () => void;
}

function beneficiaryFilterValue(value: string | undefined): BeneficiaryFilter {
  return value === "household" || value === "unassigned" || value?.startsWith("member:")
    ? value as BeneficiaryFilter
    : "all";
}

function payerFilterValue(value: string | undefined): PayerFilter {
  return value === "joint" || value?.startsWith("member:") ? value as PayerFilter : "all";
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
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function startupMark(name: (typeof STARTUP_MARKS)[number]) {
  if (!import.meta.env.DEV || typeof performance === "undefined") return;
  performance.mark(`mizan:${name}`);
}

function resetStartupTiming() {
  if (!import.meta.env.DEV || typeof performance === "undefined") return;
  STARTUP_MARKS.forEach((name) => performance.clearMarks(`mizan:${name}`));
  ["auth", "profile", "household-meta", "household-data", "auth-to-home", "total"].forEach((name) =>
    performance.clearMeasures(`mizan:${name}`));
}

function startupMeasure(name: string, start: (typeof STARTUP_MARKS)[number], end: (typeof STARTUP_MARKS)[number]) {
  if (!import.meta.env.DEV || typeof performance === "undefined") return;
  try {
    performance.measure(`mizan:${name}`, `mizan:${start}`, `mizan:${end}`);
  } catch {
    // Direct signed-in test renders do not always include each earlier mark.
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

export function useHouseholdSession({ clearUndo, resetTransientState }: SessionCallbacks) {
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
  const [householdMeta, setHouseholdMeta] = useState<HouseholdMeta | null>(null);
  const [availableHouseholds, setAvailableHouseholds] = useState<UserHouseholdLink[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncState>(sync.idle("Sign in to use Firestore"));
  const [bootstrapPhase, setBootstrapPhase] = useState<BootstrapPhase>("idle");
  const [bootstrapError, setBootstrapError] = useState("");
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [conflict, setConflict] = useState<HouseholdConflict | null>(null);
  const conflictRef = useRef<HouseholdConflict | null>(null);
  const authUid = auth.status === "signed-in" ? auth.user.uid : "";

  useEffect(() => {
    repositoryRef.current = repository;
  }, [repository]);

  useEffect(() => {
    conflictRef.current = conflict;
  }, [conflict]);

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
    // An unresolved conflict owns the cloud state until the user chooses; do not
    // keep retrying the rejected edit underneath the recovery dialog.
    if (conflictRef.current) return undefined;
    const version = ++saveVersion.current;
    const timer = window.setTimeout(() => {
      saveTimer.current = null;
      setSyncStatus(sync.syncing("Saving to Firestore"));
      const queued = saveQueue.current.catch(() => undefined).then(() => repository.save(data));
      saveQueue.current = queued;
      queued
        .then(() => {
          completedSaveVersion.current = Math.max(completedSaveVersion.current, version);
          if (version === saveVersion.current) setSyncStatus(sync.synced("Synced to Firestore"));
        })
        .catch(async (error) => {
          completedSaveVersion.current = Math.max(completedSaveVersion.current, version);
          const message = (error as Error).message;
          if (message.includes("changed on another device") && repositoryRef.current === repository) {
            try {
              // Loading refreshes the repository's compare-and-swap revision to
              // the newer cloud state, so a later "keep mine" save can win.
              const remote = await repository.load();
              if (repositoryRef.current !== repository) return;
              const next = { local: data, remote };
              conflictRef.current = next;
              setConflict(next);
              setSyncStatus(sync.conflict("Your edit conflicts with a newer change"));
              return;
            } catch {
              // Keep the original conflict message if recovery also fails.
            }
          }
          if (version === saveVersion.current) setSyncStatus(sync.error(`Save failed: ${message}`));
        });
    }, 250);
    saveTimer.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (saveTimer.current === timer) saveTimer.current = null;
    };
  }, [clearUndo, data, repository]);

  useEffect(() => {
    if (!repository?.subscribe) return undefined;
    setSyncStatus(sync.synced("Listening for household changes"));
    return repository.subscribe(
      (nextData) => {
        if (completedSaveVersion.current < saveVersion.current) return;
        // A pending conflict already holds the newest cloud state for the user's
        // decision; do not overwrite their unsaved edit from underneath.
        if (conflictRef.current) return;
        skipNextSave.current = true;
        setData(nextData);
        clearUndo();
        setSyncStatus(sync.synced("Synced to Firestore"));
      },
      (message) => setSyncStatus(sync.error(`Sync failed: ${message}`)),
      { skipInitial: true },
    );
  }, [clearUndo, repository]);

  const resolveConflict = useCallback((choice: ConflictResolution) => {
    const current = conflictRef.current;
    if (!current) return;
    conflictRef.current = null;
    setConflict(null);
    if (choice === "keep-remote") {
      // Discard the unsaved local edit and adopt the newer cloud state.
      skipNextSave.current = true;
      clearUndo();
      setData(current.remote);
      setSyncStatus(sync.synced("Synced to Firestore"));
      return;
    }
    // Keep the local edit: overwrite the newer cloud state. The failed save
    // already reloaded the manifest, so this compare-and-swap now succeeds
    // (or, if another device wrote again, re-enters the conflict flow). Data is
    // unchanged, so saving explicitly here avoids relying on the autosave effect.
    const repo = repositoryRef.current;
    if (!repo) return;
    setSyncStatus(sync.syncing("Saving to Firestore"));
    const queued = saveQueue.current.catch(() => undefined).then(() => repo.save(current.local));
    saveQueue.current = queued;
    queued
      .then(() => {
        if (repositoryRef.current === repo) setSyncStatus(sync.synced("Synced to Firestore"));
      })
      .catch(async (error) => {
        if (repositoryRef.current !== repo) return;
        const message = (error as Error).message;
        // Another device wrote again while the dialog was open: reload and let
        // the user decide once more rather than dead-ending on a failed save.
        if (message.includes("changed on another device")) {
          try {
            const remote = await repo.load();
            if (repositoryRef.current !== repo) return;
            const next = { local: current.local, remote };
            conflictRef.current = next;
            setConflict(next);
            setSyncStatus(sync.conflict("Your edit conflicts with a newer change"));
            return;
          } catch {
            // Fall through to the generic failure message.
          }
        }
        setSyncStatus(sync.error(`Save failed: ${message}`));
      });
  }, [clearUndo]);

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
      .catch((error) => setSyncStatus(sync.error(`Could not load households: ${(error as Error).message}`)));
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
    conflictRef.current = null;
    setConflict(null);
    setRepository(null);
    setHouseholdMeta(null);
    setData(emptyData());
    setBootstrapPhase("loading-profile");
    setBootstrapError("");
    setSyncStatus(sync.syncing("Loading cloud profile"));
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
          setSyncStatus(sync.idle("Create or join a Firestore household"));
          return;
        }

        setBootstrapPhase("loading-household");
        setSyncStatus(sync.syncing("Loading household data"));
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
        setSyncStatus(sync.error(`Could not load household: ${message}`));
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
      }).catch((error) => setSyncStatus(sync.error(`Could not save cloud profile: ${(error as Error).message}`)));
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
    const validCategories = new Set(categoryOptions(data.settings.customCategories).map((option) => option.key));
    const validMembers = new Set(data.settings.members.map((member) => member.id));
    setLedgerFilters((current) => {
      const category = current.category !== "all" && !validCategories.has(current.category) ? "all" : current.category;
      const beneficiary = current.beneficiary.startsWith("member:")
        && !validMembers.has(current.beneficiary.slice("member:".length)) ? "all" : current.beneficiary;
      const payer = current.payer.startsWith("member:")
        && !validMembers.has(current.payer.slice("member:".length)) ? "all" : current.payer;
      return category === current.category && beneficiary === current.beneficiary && payer === current.payer
        ? current
        : { category, beneficiary, payer };
    });
  }, [bootstrapPhase, data.settings.members, data.settings.customCategories]);

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
    const operation = saveAuthoritativeData(activeRepository, saveQueue.current, nextData, (snapshot) => {
      if (repositoryRef.current === activeRepository) acceptAuthoritativeSnapshot(snapshot);
    });
    saveQueue.current = operation;
    await operation;
  }

  function finishLegacyMigration() {
    clearLegacyLocalData();
    setLegacyData(null);
    setLegacyPresent(false);
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
    if (!data.transactions.length) {
      resetTransientState();
      setNotice("There are no household transactions to clear.");
      return;
    }
    const transactionCount = data.transactions.length;
    setSyncStatus(sync.syncing("Clearing household transactions"));
    try {
      await saveAuthoritativeSnapshot(repository, clearTransactionHistory(data));
      clearUndo();
      resetTransientState();
      setLedgerFilters(EMPTY_LEDGER_FILTERS);
      setSyncStatus(sync.synced(`Transactions cleared from ${householdMeta.name}`));
      setNotice(`${transactionCount} transaction${transactionCount === 1 ? "" : "s"} cleared. Accounts and household members were kept.`);
    } catch (error) {
      const message = (error as Error).message;
      setSyncStatus(sync.error(`Transaction clear failed: ${message}`));
      throw new Error(`Could not clear transactions from ${householdMeta.name}: ${message}`);
    }
  }

  async function resetActiveHousehold(confirmation: string): Promise<void> {
    if (confirmation !== RESET_CONFIRMATION) throw new Error(`Type ${RESET_CONFIRMATION} exactly to continue.`);
    if (auth.status !== "signed-in" || !repository || !householdMeta) {
      throw new Error("An active Firestore household is required.");
    }
    if (householdMeta.ownerUid !== auth.user.uid) throw new Error("Only the household owner can reset its data.");
    setSyncStatus(sync.syncing("Resetting household data"));
    try {
      await saveAuthoritativeSnapshot(repository, emptyData());
      clearUndo();
      resetTransientState();
      setMonth("");
      setLedgerFilters(EMPTY_LEDGER_FILTERS);
      setView("home");
      setLastCheckInByHousehold((previous) => {
        const next = { ...previous };
        delete next[householdMeta.id];
        return next;
      });
      if (legacyPresent || hasLegacyLocalData()) finishLegacyMigration();
      setSyncStatus(sync.synced(`Household reset. Ready to set up ${householdMeta.name}`));
      setNotice(`${householdMeta.name} was reset. The household and invite are still active.`);
    } catch (error) {
      const message = (error as Error).message;
      setSyncStatus(sync.error(`Reset failed: ${message}`));
      throw new Error(`Could not reset ${householdMeta.name}: ${message}`);
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
      skipNextSave.current = true;
      saveVersion.current += 1;
      completedSaveVersion.current = saveVersion.current;
      setData(cloudData);
      clearUndo();
      resetTransientState();
      if (!options.preserveViewState) {
        setMonth("");
        setLedgerFilters(EMPTY_LEDGER_FILTERS);
      }
      setRepository(repo);
      setHouseholdMeta(meta);
      writeLocalConvenience(ACTIVE_HOUSEHOLD_KEY, meta.id);
      setBootstrapError("");
      setBootstrapPhase("ready");
      setSyncStatus(sync.synced(`Synced with ${meta.name}`));
      setNotice(`Using household: ${meta.name}.`);
      if (options.persistSelection === true) {
        void saveUserProfile(services.db, auth.user.uid, { activeHouseholdId: meta.id })
          .catch((error) => setSyncStatus(sync.error(`Could not save cloud profile: ${(error as Error).message}`)));
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
    setMonth("");
    setView("home");
    setLedgerFilters(EMPTY_LEDGER_FILTERS);
    clearUndo();
    resetTransientState();
    conflictRef.current = null;
    setConflict(null);
    profileLoaded.current = false;
    setBootstrapPhase("idle");
    setBootstrapError("");
    setSyncStatus(sync.idle("Signed out"));
  }

  return {
    auth,
    repository,
    data,
    setData,
    legacyPresent,
    finishLegacyMigration,
    view,
    setView,
    month,
    setMonth,
    privacy,
    setPrivacy,
    theme,
    setTheme,
    ledgerFilters,
    setLedgerFilters,
    lastCheckInByHousehold,
    setLastCheckInByHousehold,
    notice,
    setNotice,
    householdMeta,
    availableHouseholds,
    syncStatus,
    conflict,
    resolveConflict,
    bootstrapPhase,
    bootstrapError,
    retryBootstrap: () => setBootstrapAttempt((attempt) => attempt + 1),
    saveAuthoritativeSnapshot,
    clearActiveHouseholdTransactions,
    resetActiveHousehold,
    createHousehold,
    joinHousehold,
    switchHousehold,
    rotateInvite,
    handleSignIn,
    handleSignOut,
  };
}

export type HouseholdSession = ReturnType<typeof useHouseholdSession>;
