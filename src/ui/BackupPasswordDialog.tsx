import { useState } from "react";
import { validateBackupPassword } from "../storage/backup";
import { Button, Modal } from "./bits";

export type BackupPasswordMode = "export" | "import";

export function BackupPasswordDialog({
  mode,
  onSubmit,
  onClose,
}: {
  mode: BackupPasswordMode;
  onSubmit: (password: string) => Promise<void>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (busy) return;
    setError("");
    try {
      if (mode === "export") {
        validateBackupPassword(password);
        if (password !== confirmation) throw new Error("The backup passwords do not match.");
      }
      if (!password) throw new Error("Enter the backup password.");
      setBusy(true);
      await onSubmit(password);
    } catch (submitError) {
      setError((submitError as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal title={mode === "export" ? "Encrypt backup" : "Unlock backup"} onClose={busy ? () => undefined : onClose}>
      <form
        className="reset-household-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="muted">
          {mode === "export"
            ? "This password encrypts the household backup in your browser. Mizan cannot recover it if it is lost."
            : "Enter the password used when this encrypted backup was exported."}
        </p>
        <label className="field">
          <span>Backup password</span>
          <input
            type="password"
            autoComplete={mode === "export" ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            autoFocus
          />
          {mode === "export" && <small>Use at least 12 characters and store it separately from the backup file.</small>}
        </label>
        {mode === "export" && (
          <label className="field">
            <span>Confirm backup password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={busy}
            />
          </label>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy || !password || (mode === "export" && !confirmation)}>
            {busy ? (mode === "export" ? "Encrypting..." : "Unlocking...") : (mode === "export" ? "Encrypt and download" : "Unlock backup")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
