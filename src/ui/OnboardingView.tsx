import { useId, useState } from "react";
import { MEMBER_PALETTE } from "../domain/categories";
import { defaultIncomePortion } from "../domain/income";
import { uid, type Member } from "../domain/types";
import type { SyncSettingsState } from "./SettingsModal";
import { Button } from "./bits";
import { COMMON_CURRENCIES } from "./currencies";

export interface OnboardingResult {
  members: Member[];
  currency: string;
  locale: string;
  targetSaveRate: number;
}

export function OnboardingView({
  sync,
  onSignIn,
  onOpenSettings,
  onComplete,
}: {
  sync: SyncSettingsState;
  onSignIn: () => void;
  onOpenSettings: () => void;
  onComplete: (result: OnboardingResult) => void;
}) {
  const currenciesId = useId();
  const [memberId] = useState(() => uid("mem"));
  const [name, setName] = useState("");
  const [income, setIncome] = useState(0);
  const [currency, setCurrency] = useState("");
  const [targetSaveRate, setTargetSaveRate] = useState(25);
  const locale = typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US";

  const canFinish = Boolean(name.trim()) && currency.trim().length >= 2;
  const requirement = canFinish ? "Ready to start. You can adjust everything later." : "Add your name and a currency code.";

  const finish = () => {
    if (!canFinish) return;
    const normalizedCurrency = currency.toUpperCase().trim();
    onComplete({
      members: [{
        id: memberId,
        name: name.trim(),
        color: MEMBER_PALETTE[0]!,
        portions: income > 0 ? [defaultIncomePortion(memberId, income, normalizedCurrency)] : [],
      }],
      currency: normalizedCurrency,
      locale,
      targetSaveRate,
    });
  };

  return (
    <main className="app onboarding">
      <section className="onboard-shell">
        <div className="onboard-intro">
          <div className="wordmark"><span className="wordmark-mark">M</span><span>Mizan</span></div>
          <span className="soft-label">Household setup</span>
          <h1>Set up your household</h1>
          <p>
            Start with the essentials. You can add other household members and optional tools later.
          </p>
          <div className="sync-note">
            <strong>{sync.auth.status === "signed-in" ? "Cloud storage connected" : "Google sign-in required"}</strong>
            <span>{sync.status.message}</span>
            {sync.auth.status === "signed-in" ? (
              <Button variant="secondary" onClick={onOpenSettings}>Open cloud storage</Button>
            ) : sync.auth.status !== "unconfigured" ? (
              <Button variant="secondary" onClick={onSignIn}>Sign in</Button>
            ) : null}
          </div>
        </div>

        <div className="onboard-form">
          <div className="settings-section">
            <div className="section-title">
              <div>
                <h3>Your details</h3>
                <p className="muted">Add other people later if you share household spending.</p>
              </div>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>Name</span>
                <input
                  autoFocus
                  autoComplete="name"
                  placeholder="Your name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Monthly take-home</span>
                <input
                  type="number"
                  min="0"
                  inputMode="decimal"
                  placeholder="0"
                  value={income || ""}
                  onChange={(event) => setIncome(Math.max(0, Number(event.target.value) || 0))}
                />
              </label>
            </div>
          </div>

          <div className="settings-section">
            <h3>Currency and savings</h3>
            <div className="form-grid">
              <label className="field">
                <span>Currency</span>
                <input list={currenciesId} placeholder="e.g. USD" value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
                <datalist id={currenciesId}>
                  {COMMON_CURRENCIES.map((code) => <option key={code} value={code} />)}
                </datalist>
              </label>
              <label className="field">
                <span>Savings target (%)</span>
                <input
                  type="number"
                  min="0"
                  max="90"
                  value={targetSaveRate}
                  onChange={(event) => setTargetSaveRate(Math.max(0, Math.min(90, Number(event.target.value) || 0)))}
                />
              </label>
            </div>
          </div>

          <div className="onboard-submit">
            <p className={canFinish ? "good-text" : "muted"}>{requirement}</p>
            <Button variant="primary" disabled={!canFinish} onClick={finish}>Get started</Button>
          </div>
        </div>
      </section>
    </main>
  );
}
