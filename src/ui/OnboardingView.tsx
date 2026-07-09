import { useState } from "react";
import { MEMBER_PALETTE, nextMemberColor } from "../domain/categories";
import { uid, type Member } from "../domain/types";

export interface OnboardingResult {
  members: Member[];
  currency: string;
  locale: string;
  targetSaveRate: number;
}

// A short, widely-used subset for the datalist; any ISO 4217 code can be typed.
const COMMON_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CNY", "INR", "AUD", "CAD", "CHF", "SGD", "AED", "LKR", "ZAR", "BRL", "MXN"];

export function OnboardingView({ onComplete }: { onComplete: (result: OnboardingResult) => void }) {
  const [members, setMembers] = useState<Member[]>([{ id: uid("mem"), name: "", color: MEMBER_PALETTE[0]!, income: 0 }]);
  const [currency, setCurrency] = useState("");
  const [locale, setLocale] = useState(typeof navigator !== "undefined" ? navigator.language : "en-US");
  const [targetSaveRate, setTargetSaveRate] = useState(25);

  const patch = (id: string, next: Partial<Member>) =>
    setMembers((list) => list.map((m) => (m.id === id ? { ...m, ...next } : m)));
  const addMember = () => setMembers((list) => [...list, { id: uid("mem"), name: "", color: nextMemberColor(list), income: 0 }]);
  const removeMember = (id: string) => setMembers((list) => (list.length > 1 ? list.filter((m) => m.id !== id) : list));

  const named = members.filter((m) => m.name.trim());
  const canFinish = named.length >= 1 && currency.trim().length >= 2;

  const finish = () => {
    if (!canFinish) return;
    onComplete({
      members: named.map((m) => ({ ...m, name: m.name.trim() })),
      currency: currency.toUpperCase().trim(),
      locale: locale.trim(),
      targetSaveRate,
    });
  };

  return (
    <main className="app onboarding">
      <section className="home-hero tight onboard-wide">
        <div className="onboard-intro">
          <div className="wordmark"><span className="dot" />MIZAN</div>
          <h2>Set up your household</h2>
          <p>
            Mizan runs entirely on this device — nothing is uploaded. Add the people who share the budget, pick your
            currency, and set a savings target. You can change all of this later in Settings.
          </p>
        </div>

        <div className="onboard-form">
          <div className="settings-section">
            <div className="section-title">
              <h3>Members</h3>
              <button className="secondary" onClick={addMember}>Add</button>
            </div>
            {members.map((member) => (
              <div className="member-row" key={member.id}>
                <input
                  autoFocus={members.length === 1}
                  placeholder="Name"
                  value={member.name}
                  onChange={(event) => patch(member.id, { name: event.target.value })}
                />
                <input type="color" value={member.color} onChange={(event) => patch(member.id, { color: event.target.value })} />
                <input
                  type="number"
                  placeholder="monthly income"
                  value={member.income || ""}
                  onChange={(event) => patch(member.id, { income: Number(event.target.value) || 0 })}
                />
                <button className="icon danger" disabled={members.length <= 1} onClick={() => removeMember(member.id)}>x</button>
              </div>
            ))}
          </div>

          <div className="settings-section">
            <h3>Currency & target</h3>
            <div className="form-grid">
              <label className="field">
                <span>Currency code</span>
                <input list="mizan-currencies" placeholder="e.g. USD" value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
                <datalist id="mizan-currencies">
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

          <div className="modal-actions">
            <button disabled={!canFinish} onClick={finish}>Get started</button>
          </div>
          {!canFinish && <p className="muted">Add at least one named member and a currency code to continue.</p>}
        </div>
      </section>
    </main>
  );
}
