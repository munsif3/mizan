import { useState } from "react";
import type { AppData } from "../domain/types";
import { Modal } from "./bits";

export const CLEAR_TRANSACTIONS_CONFIRMATION = "CLEAR";

export function isClearTransactionsConfirmation(value: string): boolean {
  return value === CLEAR_TRANSACTIONS_CONFIRMATION;
}

export function ClearTransactionsModal({
  householdName,
  data,
  onExport,
  onClear,
  onClose,
}: {
  householdName: string;
  data: AppData;
  onExport: () => void;
  onClear: (confirmation: string) => Promise<void>;
  onClose: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const linkedIncomeCount = data.incomeReceipts.filter((receipt) => Boolean(receipt.transactionId)).length;

  async function submit() {
    if (!isClearTransactionsConfirmation(confirmation) || busy) return;
    setBusy(true);
    setError("");
    try {
      await onClear(confirmation);
    } catch (clearError) {
      setError((clearError as Error).message || "The transaction history could not be cleared.");
      setBusy(false);
    }
  }

  return (
    <Modal title="Clear transaction history" onClose={busy ? () => undefined : onClose}>
      <form
        className="reset-household-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="reset-warning" role="alert">
          <strong>This permanently removes every ledger row from {householdName}.</strong>
          <p>
            Accounts, card and bank matching, budget members, rules, fixed costs, income confirmations, household
            access, and the invite stay in place.
          </p>
        </div>

        <div className="reset-summary" aria-label="Transaction data to be removed or unlinked">
          <div><span>Transactions removed</span><strong>{data.transactions.length}</strong></div>
          <div><span>Contribution links removed</span><strong>{data.sharedContributions.length}</strong></div>
          <div><span>Income links detached</span><strong>{linkedIncomeCount}</strong></div>
        </div>

        <p className="muted">
          Income confirmations remain authoritative; only links to deleted statement credits are detached.
        </p>

        <button type="button" className="secondary" disabled={busy} onClick={onExport}>
          Export JSON first
        </button>

        <label className="field">
          <span>Type {CLEAR_TRANSACTIONS_CONFIRMATION} to confirm</span>
          <input
            autoComplete="off"
            spellCheck={false}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={busy}
            aria-describedby="clear-transactions-confirmation-help"
          />
          <small id="clear-transactions-confirmation-help">This is case-sensitive.</small>
        </label>

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="danger" disabled={!isClearTransactionsConfirmation(confirmation) || busy}>
            {busy ? "Clearing transactions..." : "Clear transactions"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
