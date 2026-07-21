import type { ConflictResolution, HouseholdConflict } from "../app/useHouseholdSession";
import { Button, Modal } from "./bits";

/**
 * Shown when a save was rejected because the household changed on another
 * device. The user explicitly chooses which version wins, so a conflicted edit
 * is never discarded silently.
 */
export function ConflictRecoveryDialog({
  conflict,
  onResolve,
}: {
  conflict: HouseholdConflict;
  onResolve: (choice: ConflictResolution) => void;
}) {
  const localCount = conflict.local.transactions.length;
  const remoteCount = conflict.remote.transactions.length;

  return (
    // Escape / backdrop keep the latest saved version — the safe, non-destructive
    // default that leaves cloud data untouched.
    <Modal title="This household changed on another device" onClose={() => onResolve("keep-remote")}>
      <div className="reset-warning" role="alert">
        <strong>Your latest edit was not saved because a newer change arrived from another device.</strong>
        <p>Choose which version to keep. The one you do not keep will be discarded.</p>
      </div>

      <div className="reset-summary" aria-label="Versions in conflict">
        <div><span>Latest saved version</span><strong>{remoteCount} transactions</strong></div>
        <div><span>Your unsaved version</span><strong>{localCount} transactions</strong></div>
      </div>

      <p className="muted">
        Keeping your changes overwrites the newer saved version. Using the latest version discards your
        unsaved edit.
      </p>

      <div className="modal-actions">
        <Button type="button" variant="secondary" onClick={() => onResolve("keep-remote")}>
          Use the latest version
        </Button>
        <Button type="button" variant="danger" onClick={() => onResolve("keep-local")}>
          Keep my changes
        </Button>
      </div>
    </Modal>
  );
}
