import { useId, useState } from "react";
import { Trash2 } from "lucide-react";
import { MEMBER_PALETTE, nextMemberColor } from "../domain/categories";
import { defaultIncomePortion } from "../domain/income";
import { uid, type Member } from "../domain/types";
import type { SyncSettingsState } from "./SettingsModal";
import { IconButton } from "./bits";
import { COMMON_CURRENCIES } from "./currencies";

export interface OnboardingResult {
  members: Member[];
  currency: string;
  locale: string;
  targetSaveRate: number;
}

type OnboardingMember = Omit<Member, "portions"> & { income: number };

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
  const [members, setMembers] = useState<OnboardingMember[]>([{ id: uid("mem"), name: "", color: MEMBER_PALETTE[0]!, income: 0 }]);
  const [currency, setCurrency] = useState("");
  const [locale, setLocale] = useState(typeof navigator !== "undefined" ? navigator.language : "en-US");
  const [targetSaveRate, setTargetSaveRate] = useState(25);

  const patch = (id: string, next: Partial<OnboardingMember>) =>
    setMembers((list) => list.map((m) => (m.id === id ? { ...m, ...next } : m)));
  const addMember = () => setMembers((list) => [...list, { id: uid("mem"), name: "", color: nextMemberColor(list.map((member) => ({ ...member, portions: [] }))), income: 0 }]);
  const removeMember = (id: string) => setMembers((list) => (list.length > 1 ? list.filter((m) => m.id !== id) : list));

  const named = members.filter((m) => m.name.trim());
  const canFinish = named.length >= 1 && currency.trim().length >= 2;
  const requirement = canFinish ? "Ready to start. You can adjust everything later." : "Add at least one named member and a currency code.";

  const finish = () => {
    if (!canFinish) return;
    onComplete({
      members: named.map(({ income, ...member }) => ({
        ...member,
        name: member.name.trim(),
        portions: income > 0 ? [defaultIncomePortion(member.id, income, currency.toUpperCase().trim())] : [],
      })),
      currency: currency.toUpperCase().trim(),
      locale: locale.trim(),
      targetSaveRate,
    });
  };

  return (
    <main className="app onboarding">
      <section className="onboard-shell">
        <div className="onboard-intro">
          <div className="wordmark"><span className="wordmark-mark">M</span><span>Mizan</span></div>
          <span className="soft-label">Household setup</span>
          <h2>Set up your household</h2>
          <p>
            Add the people who share the budget, their monthly income, your currency, and the save-rate target.
            Mizan uses this to judge every month.
          </p>
          <div className="sync-note">
            <strong>{sync.auth.status === "signed-in" ? "Google connected" : "Google sign-in required"}</strong>
            <span>{sync.status}</span>
            {sync.auth.status === "signed-in" ? (
              <button className="secondary" onClick={onOpenSettings}>Open sync settings</button>
            ) : sync.auth.status !== "unconfigured" ? (
              <button className="secondary" onClick={onSignIn}>Sign in</button>
            ) : null}
          </div>
        </div>

        <div className="onboard-form">
          <div className="settings-section">
            <div className="section-title">
              <div>
                <h3>Members and income</h3>
                <p className="muted">Start with one person. Add more if spending is shared.</p>
              </div>
              <button className="secondary" onClick={addMember}>Add member</button>
            </div>
            <div className="member-stack">
              {members.map((member, index) => (
                <div className="onboard-member" key={member.id}>
                  <label className="field">
                    <span>Name</span>
                    <input
                      autoFocus={index === 0}
                      placeholder="Name"
                      value={member.name}
                      onChange={(event) => patch(member.id, { name: event.target.value })}
                    />
                  </label>
                  <label className="field color-field">
                    <span>Colour</span>
                    <input type="color" value={member.color} onChange={(event) => patch(member.id, { color: event.target.value })} />
                  </label>
                  <label className="field">
                    <span>Monthly income</span>
                    <input
                      type="number"
                      placeholder="0"
                      value={member.income || ""}
                      onChange={(event) => patch(member.id, { income: Number(event.target.value) || 0 })}
                    />
                  </label>
                  <IconButton label="Remove member" icon={Trash2} danger disabled={members.length <= 1} onClick={() => removeMember(member.id)} />
                </div>
              ))}
            </div>
          </div>

          <div className="settings-section">
            <h3>Currency & target</h3>
            <div className="form-grid">
              <label className="field">
                <span>Currency code</span>
                <input list={currenciesId} placeholder="e.g. USD" value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
                <datalist id={currenciesId}>
                  {COMMON_CURRENCIES.map((code) => <option key={code} value={code} />)}
                </datalist>
              </label>
              <label className="field">
                <span>Locale</span>
                <input placeholder="e.g. en-US" value={locale} onChange={(event) => setLocale(event.target.value)} />
              </label>
            </div>
            <label className="field">
              <span>Target save rate (%)</span>
              <input
                type="number"
                min="0"
                max="90"
                value={targetSaveRate}
                onChange={(event) => setTargetSaveRate(Math.max(0, Math.min(90, Number(event.target.value) || 0)))}
              />
            </label>
          </div>

          <div className="onboard-submit">
            <p className={canFinish ? "good-text" : "muted"}>{requirement}</p>
            <button disabled={!canFinish} onClick={finish}>Get started</button>
          </div>
        </div>
      </section>
    </main>
  );
}
