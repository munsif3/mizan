import { useState } from "react";
import { Button, Modal } from "./bits";

/** Create a Firestore household, replacing the old confirm/prompt pair. */
export function CreateHouseholdDialog({
  suggestion,
  willMigrateLegacyData,
  onCreate,
  onClose,
}: {
  suggestion: string;
  willMigrateLegacyData: boolean;
  onCreate: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(suggestion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const trimmed = name.trim();

  async function submit() {
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    try {
      await onCreate(trimmed);
      onClose();
    } catch (createError) {
      setError((createError as Error).message || "The household could not be created.");
      setBusy(false);
    }
  }

  return (
    <Modal title="Create a household" onClose={busy ? () => undefined : onClose}>
      <form
        className="reset-household-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="muted">
          A household stores your Mizan data in Firestore and can be shared with the people you invite.
        </p>

        {willMigrateLegacyData && (
          <p className="muted">
            <strong>This browser has older Mizan data.</strong> Creating the household migrates that data
            into the cloud.
          </p>
        )}

        <label className="field">
          <span>Household name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
            maxLength={80}
          />
        </label>

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="modal-actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!trimmed || busy}>
            {busy ? "Creating..." : "Create household"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Join an existing household by invite code, replacing the old prompt. */
export function JoinHouseholdDialog({
  onJoin,
  onClose,
}: {
  onJoin: (inviteCode: string) => Promise<void>;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const trimmed = code.trim();

  async function submit() {
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    try {
      await onJoin(trimmed);
      onClose();
    } catch (joinError) {
      setError((joinError as Error).message || "The household could not be joined.");
      setBusy(false);
    }
  }

  return (
    <Modal title="Join a household" onClose={busy ? () => undefined : onClose}>
      <form
        className="reset-household-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="muted">Paste the invite code shared by a household member.</p>

        <label className="field">
          <span>Invite code</span>
          <input
            autoComplete="off"
            spellCheck={false}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            disabled={busy}
          />
        </label>

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="modal-actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!trimmed || busy}>
            {busy ? "Joining..." : "Join household"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
