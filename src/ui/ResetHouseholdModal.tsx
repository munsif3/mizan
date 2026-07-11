import { useState } from "react";
import type { AppData } from "../domain/types";
import { Modal } from "./bits";

export const RESET_CONFIRMATION = "RESET";

export function isResetConfirmation(value: string): boolean {
  return value === RESET_CONFIRMATION;
}

export function ResetHouseholdModal({
  householdName,
  data,
  onExport,
  onReset,
  onClose,
}: {
  householdName: string;
  data: AppData;
  onExport: () => void;
  onReset: (confirmation: string) => Promise<void>;
  onClose: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ruleCount = Object.keys(data.merchantRules).length;

  async function submit() {
    if (!isResetConfirmation(confirmation) || busy) return;
    setBusy(true);
    setError("");
    try {
      await onReset(confirmation);
    } catch (resetError) {
      setError((resetError as Error).message || "The household could not be reset.");
      setBusy(false);
    }
  }

  return (
    <Modal title="Reset household data" onClose={busy ? () => undefined : onClose}>
      <form
        className="reset-household-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="reset-warning" role="alert">
          <strong>This permanently clears {householdName}.</strong>
          <p>
            The household, invite, and Google access stay in place. Transactions, setup, accounts, rules, and budget
            members are removed, and Mizan returns to onboarding.
          </p>
        </div>

        <div className="reset-summary" aria-label="Data to be removed">
          <div><span>Transactions</span><strong>{data.transactions.length}</strong></div>
          <div><span>Accounts</span><strong>{data.accounts.length}</strong></div>
          <div><span>Rules</span><strong>{ruleCount}</strong></div>
          <div><span>Budget members</span><strong>{data.settings.members.length}</strong></div>
        </div>

        <button type="button" className="secondary" disabled={busy} onClick={onExport}>
          Export JSON first
        </button>

        <label className="field">
          <span>Type {RESET_CONFIRMATION} to confirm</span>
          <input
            autoComplete="off"
            spellCheck={false}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={busy}
            aria-describedby="reset-confirmation-help"
          />
          <small id="reset-confirmation-help">This is case-sensitive.</small>
        </label>

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="danger" disabled={!isResetConfirmation(confirmation) || busy}>
            {busy ? "Resetting household..." : "Reset household data"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
