/**
 * Typed cloud-sync feedback. The session emits a {@link SyncState} carrying an
 * explicit `kind` plus a human message, so the UI can pick severity and labels
 * by switching on the kind instead of pattern-matching display strings.
 */

export type SyncKind = "idle" | "syncing" | "synced" | "conflict" | "error";

export interface SyncState {
  kind: SyncKind;
  /** Human-readable detail for tooltips and the settings panel. */
  message: string;
}

export const sync = {
  idle: (message: string): SyncState => ({ kind: "idle", message }),
  syncing: (message: string): SyncState => ({ kind: "syncing", message }),
  synced: (message: string): SyncState => ({ kind: "synced", message }),
  conflict: (message: string): SyncState => ({ kind: "conflict", message }),
  error: (message: string): SyncState => ({ kind: "error", message }),
};

/** A conflict or failure the user should notice. */
export function isSyncProblem(state: SyncState): boolean {
  return state.kind === "error" || state.kind === "conflict";
}

/** Compact label for the top-bar sync chip. */
export function syncChipLabel(state: SyncState): string {
  switch (state.kind) {
    case "error":
      return "Sync issue";
    case "conflict":
      return "Conflict";
    case "synced":
      return "Synced";
    case "syncing":
      return "Syncing";
    case "idle":
      return "Firestore";
  }
}

export type SyncTone = "danger" | "warning" | "success";

/** Badge tone for the settings sync summary. */
export function syncBadgeTone(state: SyncState): SyncTone {
  switch (state.kind) {
    case "error":
    case "conflict":
      return "danger";
    case "syncing":
      return "warning";
    case "synced":
    case "idle":
      return "success";
  }
}

/** Badge label for the settings sync summary. */
export function syncBadgeLabel(state: SyncState): string {
  switch (state.kind) {
    case "error":
      return "Sync issue";
    case "conflict":
      return "Conflict";
    case "syncing":
      return "Saving";
    case "synced":
    case "idle":
      return "Saved";
  }
}
