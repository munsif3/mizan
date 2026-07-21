import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authErrorMessage, signInWithGoogle, signOutUser, useAuthState } from "../auth/authStore";
import { clearTransactionHistory } from "../domain/dataCleanup";
import type { AppData, CategoryKey } from "../domain/types";
import { getFirebaseServices } from "../firebase/client";
import {
  FirestoreHouseholdRepository,
  createFirestoreHousehold,
  joinFirestoreHousehold,
  leaveFirestoreHousehold,
  linkFirestoreAccessMember,
  loadHouseholdMeta,
  loadUserHouseholds,
  loadUserProfile,
  promoteFirestoreHouseholdOwner,
  revokeFirestoreHouseholdAccess,
  rotateFirestoreInvite,
  saveUserProfile,
} from "../household/firestoreRepository";
import { hasLocalFinancialData } from "../household/households";
import { sync, type SyncState } from "./syncState";
import { readLocalConvenience, writeLocalConvenience } from "./localConvenience";
import { EMPTY_LEDGER_FILTERS, useBrowserPreferences } from "./useBrowserPreferences";
import type { HouseholdMeta, UserHouseholdLink } from "../household/types";
import { clearLegacyLocalData, hasLegacyLocalData, loadLegacyLocalData } from "../storage/legacyBrowserData";
import { saveAuthoritativeData, type DataRepository } from "../storage/repository";
import { emptyData } from "../storage/schema";
import { CLEAR_TRANSACTIONS_CONFIRMATION } from "../ui/ClearTransactionsModal";
import { RESET_CONFIRMATION } from "../ui/ResetHouseholdModal";
import type { BeneficiaryFilter, PayerFilter } from "../ui/TransactionsView";

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

export { EMPTY_LEDGER_FILTERS };

const ACTIVE_HOUSEHOLD_KEY = "mizan.activeHouseholdId";
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
  const [householdDialog, setHouseholdDialog] = useState<"create" | "join" | null>(null);
  const authUid = auth.status === "signed-in" ? auth.user.uid : "";
  const { privacy, setPrivacy, theme, setTheme, ledgerFilters, setLedgerFilters } = useBrowserPreferences(data, bootstrapPhase);

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
      (message) => {
        if (/permission|insufficient|access/i.test(message)) {
          const removedId = householdMeta?.id ?? "";
          setRepository(null);
          setHouseholdMeta(null);
          setData(emptyData());
          writeLocalConvenience(ACTIVE_HOUSEHOLD_KEY, "");
          setAvailableHouseholds((current) => current.filter((item) => item.householdId !== removedId));
          setBootstrapPhase("needs-household");
          setNotice("Your access to this household was removed.");
          setSyncStatus(sync.error("Household access removed"));
          return;
        }
        setSyncStatus(sync.error(`Sync failed: ${message}`));
      },
      { skipInitial: true },
    );
  }, [clearUndo, householdMeta?.id, repository]);

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
    setHouseholdDialog(null);
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
    if (householdMeta.membersByUid[auth.user.uid]?.role !== "owner") {
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
    if (householdMeta.membersByUid[auth.user.uid]?.role !== "owner") throw new Error("Only a household owner can reset its data.");
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

  // Whether creating a household will migrate this browser's legacy Mizan data,
  // and a suggested name — both surfaced in the create dialog so the user makes
  // an informed choice instead of confirming a native prompt.
  const willMigrateLegacyData = Boolean(legacyData && hasLocalFinancialData(legacyData));
  const householdNameSuggestion =
    (willMigrateLegacyData ? legacyData!.settings.members.map((member) => member.name).join(" + ") : "") || "Household";

  // Errors propagate so the dialog can show them inline and stay open; the
  // caller closes the dialog only on success.
  async function createHousehold(name: string) {
    if (auth.status !== "signed-in" || !services) {
      throw new Error("Sign in with Google before creating a household.");
    }
    const initialData = willMigrateLegacyData ? legacyData! : emptyData();
    const activation = ++activationVersion.current;
    await flushPendingAutosave();
    const meta = await createFirestoreHousehold(services.db, auth.user, name, initialData);
    const repo = new FirestoreHouseholdRepository(services.db, meta.id, auth.user.uid);
    if (activation !== activationVersion.current) return;
    const activated = await activateHousehold(meta, { activation }, { repo, cloudData: initialData });
    if (activated && willMigrateLegacyData) finishLegacyMigration();
    void loadUserHouseholds(services.db, auth.user.uid).then(setAvailableHouseholds).catch(() => undefined);
    setNotice(`Household created. Invite code: ${meta.inviteCode}`);
  }

  async function joinHousehold(inviteCode: string) {
    if (auth.status !== "signed-in" || !services) {
      throw new Error("Sign in with Google before joining a household.");
    }
    const activation = ++activationVersion.current;
    await flushPendingAutosave();
    const meta = await joinFirestoreHousehold(services.db, auth.user, inviteCode);
    if (activation !== activationVersion.current) return;
    await activateHousehold(meta, { activation });
    void loadUserHouseholds(services.db, auth.user.uid).then(setAvailableHouseholds).catch(() => undefined);
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

  async function linkAccessMember(uid: string, memberId: string) {
    if (!householdMeta || !services) return;
    try {
      const next = await linkFirestoreAccessMember(services.db, householdMeta.id, uid, memberId);
      setHouseholdMeta(next);
      setNotice(memberId ? "Access user linked to a budget member." : "Budget-member link removed.");
    } catch (error) {
      setNotice(`Could not update the access link: ${(error as Error).message}`);
    }
  }

  async function promoteOwner(uid: string, makePrimary = false) {
    if (!householdMeta || !services) return;
    try {
      const next = await promoteFirestoreHouseholdOwner(services.db, householdMeta.id, uid, makePrimary);
      setHouseholdMeta(next);
      void loadUserHouseholds(services.db, authUid).then(setAvailableHouseholds).catch(() => undefined);
      setNotice(makePrimary ? "Primary ownership transferred." : "Recovery owner added.");
    } catch (error) {
      setNotice(`Could not change household ownership: ${(error as Error).message}`);
    }
  }

  async function revokeAccess(uid: string) {
    if (!householdMeta || !services) return;
    try {
      const next = await revokeFirestoreHouseholdAccess(services.db, householdMeta.id, uid);
      setHouseholdMeta(next);
      setNotice("Household access revoked. The invite code was rotated.");
    } catch (error) {
      setNotice(`Could not revoke household access: ${(error as Error).message}`);
    }
  }

  async function leaveHousehold() {
    if (auth.status !== "signed-in" || !householdMeta || !services) return;
    try {
      await flushPendingAutosave();
      const leavingId = householdMeta.id;
      await leaveFirestoreHousehold(services.db, leavingId, auth.user.uid);
      activationVersion.current += 1;
      setRepository(null);
      setHouseholdMeta(null);
      setData(emptyData());
      writeLocalConvenience(ACTIVE_HOUSEHOLD_KEY, "");
      setAvailableHouseholds((current) => current.filter((item) => item.householdId !== leavingId));
      setBootstrapPhase("needs-household");
      setSyncStatus(sync.idle("Choose or join a Firestore household"));
      await saveUserProfile(services.db, auth.user.uid, { activeHouseholdId: "" }).catch(() => undefined);
      setNotice("You left the household. Its financial history was not changed.");
    } catch (error) {
      setNotice(`Could not leave the household: ${(error as Error).message}`);
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
    setHouseholdDialog(null);
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
    householdDialog,
    setHouseholdDialog,
    willMigrateLegacyData,
    householdNameSuggestion,
    switchHousehold,
    rotateInvite,
    linkAccessMember,
    promoteOwner,
    revokeAccess,
    leaveHousehold,
    handleSignIn,
    handleSignOut,
  };
}

export type HouseholdSession = ReturnType<typeof useHouseholdSession>;
