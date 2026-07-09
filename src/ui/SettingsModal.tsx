import { useRef } from "react";
import { categoryInfo, nextMemberColor, spendingCategoryOptions } from "../domain/categories";
import type { Account, AppData, CategoryKey, FixedCost, Member } from "../domain/types";
import { uid } from "../domain/types";
import { Modal } from "./bits";

export function SettingsModal({
  data,
  onUpdateMembers,
  onUpdateTarget,
  onUpdateCurrency,
  onUpdateFixedCosts,
  onUpdateAccounts,
  onDeleteRule,
  onExport,
  onImportBackup,
  onClearData,
  onClose,
}: {
  data: AppData;
  onUpdateMembers: (members: Member[]) => void;
  onUpdateTarget: (targetSaveRate: number) => void;
  onUpdateCurrency: (currency: string, locale: string) => void;
  onUpdateFixedCosts: (fixedCosts: FixedCost[]) => void;
  onUpdateAccounts: (accounts: Account[]) => void;
  onDeleteRule: (merchant: string) => void;
  onExport: () => void;
  onImportBackup: (file: File) => void;
  onClearData: () => void;
  onClose: () => void;
}) {
  const importRef = useRef<HTMLInputElement>(null);
  const { members, currency, locale } = data.settings;
  const fixedCosts = data.fixedCosts;
  const categoryChoices = spendingCategoryOptions(members);

  const patchMember = (id: string, patch: Partial<Member>) =>
    onUpdateMembers(members.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const removeMember = (member: Member) => {
    if (members.length <= 1) return;
    if (!window.confirm(`Remove ${member.name}? Their personal transactions become Uncategorized and their accounts become Joint.`)) return;
    onUpdateMembers(members.filter((item) => item.id !== member.id));
  };
  const patchFixed = (id: string, patch: Partial<FixedCost>) =>
    onUpdateFixedCosts(fixedCosts.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const patchAccount = (id: string, patch: Partial<Account>) =>
    onUpdateAccounts(data.accounts.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  return (
    <Modal title="Settings" onClose={onClose} wide>
      <div className="settings-section">
        <div className="section-title">
          <h3>Household members</h3>
          <button
            className="secondary"
            onClick={() => onUpdateMembers([...members, { id: uid("mem"), name: "New member", color: nextMemberColor(members), income: 0 }])}
          >
            Add
          </button>
        </div>
        <p className="muted">Name, colour, and monthly income for each person. Each member gets a personal spending category.</p>
        {members.map((member) => (
          <div className="member-row" key={member.id}>
            <input value={member.name} onChange={(event) => patchMember(member.id, { name: event.target.value })} />
            <input type="color" value={member.color} onChange={(event) => patchMember(member.id, { color: event.target.value })} />
            <input type="number" placeholder="income" value={member.income} onChange={(event) => patchMember(member.id, { income: Number(event.target.value) })} />
            <button className="icon danger" disabled={members.length <= 1} title="Remove member" onClick={() => removeMember(member)}>x</button>
          </div>
        ))}
      </div>

      <div className="settings-section">
        <h3>Currency & target</h3>
        <div className="form-grid">
          <label className="field">
            <span>Currency code</span>
            <input
              value={currency}
              placeholder="e.g. USD"
              onChange={(event) => onUpdateCurrency(event.target.value.toUpperCase().trim(), locale)}
            />
          </label>
          <label className="field">
            <span>Locale</span>
            <input value={locale} placeholder="e.g. en-US" onChange={(event) => onUpdateCurrency(currency, event.target.value.trim())} />
          </label>
        </div>
        <label className="field">
          <span>Target save rate (%)</span>
          <input
            type="number"
            min="0"
            max="90"
            value={data.settings.targetSaveRate}
            onChange={(event) => onUpdateTarget(Math.max(0, Math.min(90, Number(event.target.value) || 0)))}
          />
        </label>
      </div>

      <div className="settings-section">
        <div className="section-title">
          <h3>Fixed costs</h3>
          <button
            className="secondary"
            onClick={() => onUpdateFixedCosts([...fixedCosts, { id: uid("fixed"), label: "New cost", amount: 0, category: "housing" }])}
          >
            Add
          </button>
        </div>
        {fixedCosts.map((fixed) => (
          <div className="fixed-row" key={fixed.id}>
            <input value={fixed.label} onChange={(event) => patchFixed(fixed.id, { label: event.target.value })} />
            <input type="number" value={fixed.amount} onChange={(event) => patchFixed(fixed.id, { amount: Number(event.target.value) })} />
            <select value={fixed.category} onChange={(event) => patchFixed(fixed.id, { category: event.target.value as CategoryKey })}>
              {categoryChoices.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
            <input
              value={fixed.until ?? ""}
              placeholder="until YYYY-MM"
              onChange={(event) => patchFixed(fixed.id, { until: event.target.value || undefined })}
            />
            <button className="icon danger" onClick={() => onUpdateFixedCosts(fixedCosts.filter((item) => item.id !== fixed.id))}>x</button>
          </div>
        ))}
      </div>

      <div className="settings-section">
        <div className="section-title">
          <h3>Accounts</h3>
          <button
            className="secondary"
            onClick={() => onUpdateAccounts([...data.accounts, { id: uid("acc"), label: "New account", owner: "joint", match: [] }])}
          >
            Add
          </button>
        </div>
        <p className="muted">
          Label, whose spending it is, and match text (comma-separated card-number fragments or bank names) so
          imported statements land on the right account automatically.
        </p>
        {data.accounts.map((account) => (
          <div className="account-row" key={account.id}>
            <input value={account.label} onChange={(event) => patchAccount(account.id, { label: event.target.value })} />
            <select value={account.owner} onChange={(event) => patchAccount(account.id, { owner: event.target.value })}>
              {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              <option value="joint">Joint</option>
            </select>
            <input
              value={account.match.join(", ")}
              placeholder="match: 37xx 1234, amex"
              onChange={(event) =>
                patchAccount(account.id, { match: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })
              }
            />
            <button className="icon danger" onClick={() => onUpdateAccounts(data.accounts.filter((item) => item.id !== account.id))}>x</button>
          </div>
        ))}
        {!data.accounts.length && <p className="muted">No accounts yet — they also appear automatically when you import data.</p>}
      </div>

      <div className="settings-section">
        <h3>Merchant rules</h3>
        <div className="rules-list">
          {Object.entries(data.merchantRules).map(([merchant, category]) => (
            <div key={merchant}>
              <span>{merchant}</span>
              <strong>{categoryInfo(category, members).label}</strong>
              <button className="icon danger" onClick={() => onDeleteRule(merchant)}>x</button>
            </div>
          ))}
          {!Object.keys(data.merchantRules).length && (
            <p className="muted">Rules appear when you categorize merchants in the review queue or the transactions table.</p>
          )}
        </div>
      </div>

      <div className="modal-actions">
        <button className="secondary" onClick={onExport}>Export JSON</button>
        <button className="secondary" onClick={() => importRef.current?.click()}>Import JSON</button>
        <button className="secondary danger" onClick={onClearData}>Clear local data</button>
        <input
          ref={importRef}
          hidden
          type="file"
          accept=".json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImportBackup(file);
          }}
        />
      </div>
    </Modal>
  );
}
