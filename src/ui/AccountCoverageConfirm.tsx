import { useState } from "react";
import { isoDateOf } from "../domain/dates";
import { Button } from "./bits";

export interface AccountCoverageCandidate {
  accountId: string;
  label: string;
  suggestedThroughDate: string;
}

export interface AccountCoverageConfirmation {
  accountId: string;
  throughDate: string;
}

export function AccountCoverageConfirm({
  candidates,
  onConfirm,
}: {
  candidates: AccountCoverageCandidate[];
  onConfirm: (confirmations: AccountCoverageConfirmation[]) => void;
}) {
  const today = isoDateOf(new Date());
  const [dates, setDates] = useState<Record<string, string>>(() => Object.fromEntries(
    candidates.map((candidate) => [candidate.accountId, candidate.suggestedThroughDate]),
  ));
  const [saved, setSaved] = useState(false);
  if (!candidates.length) return null;

  const confirmations = candidates.flatMap((candidate): AccountCoverageConfirmation[] => {
    const throughDate = dates[candidate.accountId] ?? "";
    return throughDate ? [{ accountId: candidate.accountId, throughDate }] : [];
  });

  return (
    <div className="coverage-confirm">
      <div>
        <strong>Confirm account coverage</strong>
        <p className="muted">
          Dates are prefilled from the latest parsed transaction, not guessed as the statement end.
          Adjust each date to what you actually reviewed, or clear it to leave that account unconfirmed.
        </p>
      </div>
      <div className="coverage-confirm-list">
        {candidates.map((candidate) => (
          <label className="field" key={candidate.accountId}>
            <span>{candidate.label} updated through</span>
            <input
              type="date"
              max={today}
              value={dates[candidate.accountId] ?? ""}
              onChange={(event) => {
                setSaved(false);
                setDates((current) => ({ ...current, [candidate.accountId]: event.target.value }));
              }}
            />
          </label>
        ))}
      </div>
      <Button
        variant="secondary"
        disabled={!confirmations.length || saved}
        onClick={() => {
          onConfirm(confirmations);
          setSaved(true);
        }}
      >
        {saved ? "Coverage confirmed" : "Confirm coverage"}
      </Button>
    </div>
  );
}
