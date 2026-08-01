import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { AppData, Settlement, WeeklyClose } from "../domain/types";
import { saveAuthoritativeData, type DataRepository } from "../storage/repository";
import { sync, type SyncState } from "./syncState";

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

interface CloudSyncOptions {
  repository: DataRepository | null;
  data: AppData;
  setData: Dispatch<SetStateAction<AppData>>;
  clearUndo: () => void;
  setSyncStatus: (state: SyncState) => void;
  /** Tear down the active household when the subscription reports lost access. */
  onAccessRemoved: () => void;
}

/**
 * Owns everything that reconciles the in-memory {@link AppData} with the cloud:
 * the debounced autosave, the compare-and-swap conflict flow, the live
 * subscription, and the authoritative-snapshot path used by destructive
 * commands. Household-lifecycle concerns stay in the caller via `onAccessRemoved`.
 */
export function useCloudSync({
  repository,
  data,
  setData,
  clearUndo,
  setSyncStatus,
  onAccessRemoved,
}: CloudSyncOptions) {
  const skipNextSave = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const settlementQueue = useRef<Promise<void>>(Promise.resolve());
  const weeklyCloseQueue = useRef<Promise<void>>(Promise.resolve());
  const saveVersion = useRef(0);
  const completedSaveVersion = useRef(0);
  const repositoryRef = useRef<DataRepository | null>(null);
  const [conflict, setConflict] = useState<HouseholdConflict | null>(null);
  const conflictRef = useRef<HouseholdConflict | null>(null);

  useEffect(() => {
    repositoryRef.current = repository;
  }, [repository]);

  useEffect(() => {
    conflictRef.current = conflict;
  }, [conflict]);

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
          onAccessRemoved();
          setSyncStatus(sync.error("Household access removed"));
          return;
        }
        setSyncStatus(sync.error(`Sync failed: ${message}`));
      },
      { skipInitial: true },
    );
  }, [clearUndo, onAccessRemoved, repository, setData, setSyncStatus]);

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
  }, [clearUndo, setData, setSyncStatus]);

  const resetConflict = useCallback(() => {
    conflictRef.current = null;
    setConflict(null);
  }, []);

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

  /**
   * Adopt cloud data loaded during activation without triggering a save. Unlike
   * {@link acceptAuthoritativeSnapshot}, it leaves the save queue untouched.
   */
  function adoptLoadedData(nextData: AppData) {
    skipNextSave.current = true;
    saveVersion.current += 1;
    completedSaveVersion.current = saveVersion.current;
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

  const saveWeeklyClose = useCallback(async (record: WeeklyClose): Promise<void> => {
    const activeRepository = repositoryRef.current;
    if (!activeRepository?.saveWeeklyClose) throw new Error("The active household cannot save weekly close records.");
    setSyncStatus(sync.syncing("Saving weekly close"));
    const queued = weeklyCloseQueue.current
      .catch(() => undefined)
      .then(() => activeRepository.saveWeeklyClose!(record));
    weeklyCloseQueue.current = queued;
    try {
      await queued;
      if (repositoryRef.current === activeRepository) setSyncStatus(sync.synced("Weekly close saved"));
    } catch (error) {
      if (repositoryRef.current === activeRepository) setSyncStatus(sync.error(`Weekly close save failed: ${(error as Error).message}`));
      throw error;
    }
  }, [setSyncStatus]);

  const saveSettlement = useCallback(async (record: Settlement): Promise<void> => {
    const activeRepository = repositoryRef.current;
    if (!activeRepository?.appendSettlement) throw new Error("The active household cannot save settlement records.");
    cancelPendingAutosave();
    const pendingSave = saveQueue.current;
    setSyncStatus(sync.syncing("Saving settlement"));
    const queued = settlementQueue.current
      .catch(() => undefined)
      .then(async () => {
        await pendingSave;
        await activeRepository.appendSettlement!(record);
        if (repositoryRef.current !== activeRepository) return;
        skipNextSave.current = true;
        const version = ++saveVersion.current;
        completedSaveVersion.current = version;
        setData((previous) => previous.settlements.some((item) => item.id === record.id)
          ? previous
          : { ...previous, settlements: [...previous.settlements, record] });
      });
    settlementQueue.current = queued;
    try {
      await queued;
      if (repositoryRef.current === activeRepository) setSyncStatus(sync.synced("Settlement saved"));
    } catch (error) {
      if (repositoryRef.current === activeRepository) setSyncStatus(sync.error(`Settlement save failed: ${(error as Error).message}`));
      throw error;
    }
  }, [setData, setSyncStatus]);

  return {
    conflict,
    resolveConflict,
    resetConflict,
    adoptLoadedData,
    flushPendingAutosave,
    cancelPendingAutosave,
    saveAuthoritativeSnapshot,
    saveWeeklyClose,
    saveSettlement,
  };
}
