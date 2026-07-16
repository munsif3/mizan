import { useId, useRef, useState, type CSSProperties } from "react";
import { Trash2 } from "lucide-react";
import type { AuthState } from "../auth/authStore";
import { categoryInfo, categoryOptions, nextMemberColor } from "../domain/categories";
import { isoDateOf } from "../domain/dates";
import { isSpendKind, movementInfo } from "../domain/movements";
import type { Account, AppData, CategoryKey, Counterparty, CustomCategory, FixedCost, FixedCostKind, IncomePortion, Member, MerchantRule, SpendBeneficiary } from "../domain/types";
import type { HouseholdMeta, UserHouseholdLink } from "../household/types";
import type { RepositoryMode } from "../storage/repository";
import { uid } from "../domain/types";
import { IconButton, Modal } from "./bits";
import { COMMON_CURRENCIES } from "./currencies";

export interface SyncSettingsState {
  auth: AuthState;
  mode: RepositoryMode;
  status: string;
  household: HouseholdMeta | null;
  households: UserHouseholdLink[];
}

type SettingsTab = "household" | "budget" | "categories" | "accounts" | "sync";

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "household", label: "Household" },
  { id: "budget", label: "Budget" },
  { id: "categories", label: "Categories & people" },
  { id: "accounts", label: "Accounts & rules" },
  { id: "sync", label: "Sync & backup" },
];

function beneficiaryValue(beneficiary: SpendBeneficiary): string {
  return beneficiary.type === "member" ? `member:${beneficiary.memberId}` : beneficiary.type;
}

function beneficiaryFromValue(value: string): SpendBeneficiary {
  if (value.startsWith("member:")) return { type: "member", memberId: value.slice("member:".length) };
  return value === "household" ? { type: "household" } : { type: "unassigned" };
}

function beneficiaryLabel(beneficiary: MerchantRule["beneficiary"], members: Member[]): string {
  if (beneficiary.type === "account_default") return "Account default";
  if (beneficiary.type === "household") return "Household";
  if (beneficiary.type === "unassigned") return "Unassigned";
  return members.find((member) => member.id === beneficiary.memberId)?.name ?? "Former member";
}

function looksLikeLoanCommitment(label: string): boolean {
  return /\b(?:loan|mortgage|debt)\b/i.test(label);
}

export function HouseholdResetAction({
  canResetHousehold,
  hasResettableData,
  onResetHousehold,
}: {
  canResetHousehold: boolean;
  hasResettableData: boolean;
  onResetHousehold: () => void;
}) {
  if (!canResetHousehold || !hasResettableData) return null;
  return <button className="danger" onClick={onResetHousehold}>Reset household data</button>;
}

export function HouseholdTransactionClearAction({
  canClearTransactions,
  hasTransactions,
  onClearTransactions,
}: {
  canClearTransactions: boolean;
  hasTransactions: boolean;
  onClearTransactions: () => void;
}) {
  if (!canClearTransactions || !hasTransactions) return null;
  return <button className="secondary danger" onClick={onClearTransactions}>Clear transactions</button>;
}

export function SettingsModal({
  data,
  onUpdateMembers,
  onUpdateTarget,
  onUpdateCurrency,
  onUpdateFxRates,
  onUpdateFixedCosts,
  onUpdateAccounts,
  onDeleteRule,
  onUpdateCounterparties,
  onUpdateCustomCategories,
  sync,
  onSignIn,
  onSignOut,
  onCreateHousehold,
  onJoinHousehold,
  onSwitchHousehold,
  onRotateInvite,
  onExport,
  onImportBackup,
  hasLegacyBrowserData,
  onClearData,
  canClearTransactions,
  hasTransactions,
  onClearTransactions,
  canResetHousehold,
  hasResettableData,
  onResetHousehold,
  onClose,
}: {
  data: AppData;
  onUpdateMembers: (members: Member[]) => void;
  onUpdateTarget: (targetSaveRate: number) => void;
  onUpdateCurrency: (currency: string, locale: string) => void;
  onUpdateFxRates: (fxRates: Record<string, number>) => void;
  onUpdateFixedCosts: (fixedCosts: FixedCost[]) => void;
  onUpdateAccounts: (accounts: Account[]) => void;
  onDeleteRule: (merchant: string) => void;
  onUpdateCounterparties: (counterparties: Counterparty[]) => void;
  onUpdateCustomCategories: (customCategories: CustomCategory[]) => void;
  sync: SyncSettingsState;
  onSignIn: () => void;
  onSignOut: () => void;
  onCreateHousehold: () => void;
  onJoinHousehold: () => void;
  onSwitchHousehold: (householdId: string) => void;
  onRotateInvite: () => void;
  onExport: () => void;
  onImportBackup: (file: File) => void;
  hasLegacyBrowserData: boolean;
  onClearData: () => void;
  canClearTransactions: boolean;
  hasTransactions: boolean;
  onClearTransactions: () => void;
  canResetHousehold: boolean;
  hasResettableData: boolean;
  onResetHousehold: () => void;
  onClose: () => void;
}) {
  const currenciesId = useId();
  const importRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("household");
  const { members, currency, locale, fxRates, counterparties, customCategories } = data.settings;
  const fixedCosts = data.fixedCosts;
  const categoryChoices = categoryOptions(members, customCategories);

  const patchCounterparty = (id: string, name: string) =>
    onUpdateCounterparties(counterparties.map((item) => (item.id === id ? { ...item, name } : item)));
  const patchCustom = (id: string, patch: Partial<CustomCategory>) =>
    onUpdateCustomCategories(customCategories.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const patchMember = (id: string, patch: Partial<Member>) =>
    onUpdateMembers(members.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const patchPortion = (memberId: string, portionId: string, patch: Partial<IncomePortion>) =>
    onUpdateMembers(members.map((member) => member.id === memberId
      ? { ...member, portions: member.portions.map((portion) => portion.id === portionId ? { ...portion, ...patch } : portion) }
      : member));
  const removePortion = (memberId: string, portionId: string) => {
    const confirmationCount = data.incomeReceipts.filter((receipt) => receipt.memberId === memberId && receipt.portionId === portionId).length;
    if (confirmationCount && typeof window !== "undefined" && !window.confirm(
      `Delete this income source and ${confirmationCount} historical confirmation${confirmationCount === 1 ? "" : "s"}? This cannot be undone.`,
    )) return;
    onUpdateMembers(members.map((member) => member.id === memberId
      ? { ...member, portions: member.portions.filter((portion) => portion.id !== portionId) }
      : member));
  };
  const addPortion = (memberId: string, frequency: "monthly" | "one_off" = "monthly") =>
    onUpdateMembers(members.map((member) => member.id === memberId
      ? { ...member, portions: [...member.portions, {
          id: uid("por"), label: frequency === "one_off" ? "Annual bonus" : "Income portion", amount: 0, currency, taxRate: 0, taxWithheld: true,
          window: null,
          schedule: frequency === "one_off" ? { frequency: "one_off", month: isoDateOf(new Date()).slice(0, 7) } : { frequency: "monthly" },
          budgetTreatment: frequency === "one_off" ? "protected" : "ordinary",
        }] }
      : member));
  const foreignCurrencies = [...new Set(members.flatMap((member) => member.portions.map((portion) => portion.currency.trim().toUpperCase())))]
    .filter((code) => code && code !== currency.trim().toUpperCase())
    .sort();
  const removeMember = (member: Member) => {
    if (members.length <= 1) return;
    if (!window.confirm(`Delete ${member.name}? Spending assigned to them becomes Unassigned and their accounts become Joint.`)) return;
    onUpdateMembers(members.filter((item) => item.id !== member.id));
  };
  const patchFixed = (id: string, patch: Partial<FixedCost>) =>
    onUpdateFixedCosts(fixedCosts.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const patchAccount = (id: string, patch: Partial<Account>) =>
    onUpdateAccounts(data.accounts.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  return (
    <Modal title="Settings" onClose={onClose} wide>
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        {SETTINGS_TABS.map((tab, index) => (
          <button
            key={tab.id}
            id={`settings-tab-${tab.id}`}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`settings-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={activeTab === tab.id ? "active" : ""}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
              event.preventDefault();
              const nextIndex = event.key === "Home"
                ? 0
                : event.key === "End"
                  ? SETTINGS_TABS.length - 1
                  : (index + (event.key === "ArrowRight" ? 1 : -1) + SETTINGS_TABS.length) % SETTINGS_TABS.length;
              const next = SETTINGS_TABS[nextIndex]!;
              setActiveTab(next.id);
              requestAnimationFrame(() => document.getElementById(`settings-tab-${next.id}`)?.focus());
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "household" && (
        <div className="settings-section" id="settings-panel-household" role="tabpanel" aria-labelledby="settings-tab-household">
          <div className="section-title">
            <div>
              <h3>Household members</h3>
              <p className="muted">Each person can have several deposits with their own currency, tax treatment, and arrival window.</p>
            </div>
            <button
              className="secondary"
              onClick={() => onUpdateMembers([...members, { id: uid("mem"), name: "New member", color: nextMemberColor(members), portions: [] }])}
            >
              Add member
            </button>
          </div>
          <div className="settings-list">
            {members.map((member, memberIndex) => (
              <div className="income-member" key={member.id} style={{ "--member-color": member.color } as CSSProperties}>
                <div className="income-member-header">
                  <div className="income-member-title">
                    <span className="income-member-avatar" aria-hidden="true">{member.name.trim().charAt(0).toUpperCase() || memberIndex + 1}</span>
                    <div>
                      <span className="income-profile-kicker">Income profile {memberIndex + 1}</span>
                      <label className="member-name-field">
                      <span>Member name</span>
                      <input aria-label={`${member.name || "Member"} name`} value={member.name} onChange={(event) => patchMember(member.id, { name: event.target.value })} />
                      </label>
                      <small>
                        {member.portions.filter((portion) => portion.schedule.frequency === "monthly").length} monthly · {member.portions.filter((portion) => portion.schedule.frequency === "one_off").length} one-off
                      </small>
                    </div>
                  </div>
                  <div className="income-member-actions">
                    <label className="member-color-control" title={`Colour for ${member.name || "member"}`}>
                      <span>Colour</span>
                      <input aria-label={`${member.name || "Member"} colour`} type="color" value={member.color} onChange={(event) => patchMember(member.id, { color: event.target.value })} />
                    </label>
                    <button onClick={() => addPortion(member.id)}>Add monthly deposit</button>
                    <button className="secondary" onClick={() => addPortion(member.id, "one_off")}>Add one-off income</button>
                    <IconButton label={`Delete ${member.name || "member"}`} title="Delete member" icon={Trash2} danger disabled={members.length <= 1} onClick={() => removeMember(member)} />
                  </div>
                </div>
                <div className="income-deposit-list">
                  {member.portions.map((portion, portionIndex) => (
                    <section className="income-deposit-card" key={portion.id}>
                      <div className="income-deposit-header">
                        <div>
                          <span className="income-deposit-number">{portion.schedule.frequency === "one_off" ? "One-off income" : `Deposit ${portionIndex + 1}`}</span>
                          <strong>{portion.label.trim() || "Untitled income"}</strong>
                        </div>
                        <IconButton label={`Delete ${portion.label}`} icon={Trash2} danger onClick={() => removePortion(member.id, portion.id)} title="Delete deposit" />
                      </div>

                      <label className="deposit-name-field">
                        <span>What should we call this deposit?</span>
                        <input aria-label={`${member.name} portion label`} value={portion.label} placeholder="e.g. Base salary or Variable allowance" onChange={(event) => patchPortion(member.id, portion.id, { label: event.target.value })} />
                      </label>

                      <div className="income-schedule-choices" role="group" aria-label={`${portion.label} schedule`}>
                        <button
                          type="button"
                          className={portion.schedule.frequency === "monthly" ? "active" : ""}
                          aria-pressed={portion.schedule.frequency === "monthly"}
                          disabled={data.incomeReceipts.some((receipt) => receipt.memberId === member.id && receipt.portionId === portion.id)}
                          onClick={() => patchPortion(member.id, portion.id, { schedule: { frequency: "monthly" }, budgetTreatment: "ordinary" })}
                        >
                          <strong>Monthly</strong><small>Expected every month.</small>
                        </button>
                        <button
                          type="button"
                          className={portion.schedule.frequency === "one_off" ? "active" : ""}
                          aria-pressed={portion.schedule.frequency === "one_off"}
                          disabled={data.incomeReceipts.some((receipt) => receipt.memberId === member.id && receipt.portionId === portion.id)}
                          onClick={() => patchPortion(member.id, portion.id, {
                            schedule: { frequency: "one_off", month: isoDateOf(new Date()).slice(0, 7) },
                            budgetTreatment: "protected",
                          })}
                        >
                          <strong>One-off</strong><small>Expected in one specific month.</small>
                        </button>
                      </div>
                      {data.incomeReceipts.some((receipt) => receipt.memberId === member.id && receipt.portionId === portion.id) && (
                        <small className="income-schedule-lock">Schedule locked after confirmation so historical income cannot move between months.</small>
                      )}
                      {portion.schedule.frequency === "one_off" && (
                        <div className="one-off-settings-row">
                          <label className="field">
                            <span>Expected month</span>
                            <input
                              type="month"
                              value={portion.schedule.month}
                              disabled={data.incomeReceipts.some((receipt) => receipt.memberId === member.id && receipt.portionId === portion.id)}
                              onChange={(event) => event.target.value && patchPortion(member.id, portion.id, {
                                schedule: { frequency: "one_off", month: event.target.value },
                              })}
                            />
                          </label>
                          <label className="check-row">
                            <input
                              type="checkbox"
                              checked={portion.budgetTreatment === "protected"}
                              onChange={(event) => patchPortion(member.id, portion.id, { budgetTreatment: event.target.checked ? "protected" : "ordinary" })}
                            />
                            <span><strong>Protect from spending plan</strong><small>Does not increase the normal monthly allowance.</small></span>
                          </label>
                        </div>
                      )}

                      <div className="income-deposit-sections">
                        <div className="deposit-section">
                          <div className="deposit-section-heading">
                            <span>1</span>
                            <div><strong>What reaches the account?</strong><small>Enter the deposit amount, not the gross salary.</small></div>
                          </div>
                          <div className="deposit-money-fields">
                            <label><span>Amount</span><input aria-label={`${portion.label} amount`} type="number" min="0" value={portion.amount || ""} placeholder="0" onChange={(event) => patchPortion(member.id, portion.id, { amount: Math.max(0, Number(event.target.value) || 0) })} /></label>
                            <label><span>Currency</span><input aria-label={`${portion.label} currency`} list={currenciesId} value={portion.currency} placeholder={currency || "Currency"} onChange={(event) => patchPortion(member.id, portion.id, { currency: event.target.value.toUpperCase().trim() })} /></label>
                          </div>
                        </div>

                        <div className="deposit-section">
                          <div className="deposit-section-heading">
                            <span>2</span>
                            <div><strong>How is tax handled?</strong><small>This decides how much counts toward your save rate.</small></div>
                          </div>
                          <div className="tax-treatment-choices" role="group" aria-label={`${portion.label} tax treatment`}>
                            <button type="button" className={portion.taxWithheld ? "active" : ""} aria-pressed={portion.taxWithheld} onClick={() => patchPortion(member.id, portion.id, { taxWithheld: true })}>
                              <strong>Already deducted</strong><small>The deposit is ready to use.</small>
                            </button>
                            <button type="button" className={!portion.taxWithheld ? "active" : ""} aria-pressed={!portion.taxWithheld} onClick={() => patchPortion(member.id, portion.id, { taxWithheld: false })}>
                              <strong>I pay it later</strong><small>Mizan reserves tax first.</small>
                            </button>
                          </div>
                          <label className="deposit-tax-rate"><span>Tax rate</span><div><input aria-label={`${portion.label} tax rate`} type="number" min="0" max="99.99" value={portion.taxRate || ""} placeholder="0" onChange={(event) => patchPortion(member.id, portion.id, { taxRate: Math.max(0, Math.min(99.99, Number(event.target.value) || 0)) })} /><b>%</b></div></label>
                        </div>

                        <div className="deposit-section deposit-timing-section">
                          <div className="deposit-section-heading">
                            <span>3</span>
                            <div><strong>When does it arrive?</strong><small>Leave blank if the timing is unknown.</small></div>
                          </div>
                          <div className="arrival-inputs">
                            <label><span>From day</span><input aria-label={`${portion.label} arrival start day`} type="number" min="1" max="31" placeholder="e.g. 10" value={portion.window?.startDay ?? ""} onChange={(event) => { const raw = Number(event.target.value); const startDay = raw ? Math.max(1, Math.min(31, raw)) : 0; patchPortion(member.id, portion.id, { window: startDay ? { startDay, endDay: portion.window?.endDay ?? startDay } : null }); }} /></label>
                            <span>to</span>
                            <label><span>To day</span><input aria-label={`${portion.label} arrival end day`} type="number" min="1" max="31" placeholder="e.g. 15" value={portion.window?.endDay ?? ""} onChange={(event) => { const raw = Number(event.target.value); const endDay = raw ? Math.max(1, Math.min(31, raw)) : 0; patchPortion(member.id, portion.id, { window: endDay ? { startDay: portion.window?.startDay ?? endDay, endDay } : null }); }} /></label>
                          </div>
                        </div>
                      </div>
                    </section>
                  ))}
                  {!member.portions.length && <div className="income-deposit-empty"><strong>No deposits yet</strong><p>Add regular salary or planned one-off income.</p><button onClick={() => addPortion(member.id)}>Add first deposit</button></div>}
                </div>
              </div>
            ))}
            <datalist id={currenciesId}>{COMMON_CURRENCIES.map((code) => <option key={code} value={code} />)}</datalist>
          </div>
        </div>
      )}

      {activeTab === "budget" && (
        <>
          <div className="settings-section" id="settings-panel-budget" role="tabpanel" aria-labelledby="settings-tab-budget">
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

          {foreignCurrencies.length > 0 && <div className="settings-section">
            <h3>Exchange rates</h3>
            <p className="muted">Used to project expected foreign-currency deposits. Confirmed actuals are always stored in {currency}.</p>
            <div className="fx-rate-list">
              {foreignCurrencies.map((code) => {
                const missing = !(Number(fxRates[code]) > 0);
                return <label className={`field ${missing ? "missing-rate" : ""}`} key={code}>
                  <span>1 {code} =</span>
                  <input aria-label={`${code} exchange rate`} type="number" min="0" step="any" placeholder="Rate required" value={fxRates[code] || ""} onChange={(event) => {
                    const rate = Number(event.target.value);
                    const next = { ...fxRates };
                    if (rate > 0) next[code] = rate; else delete next[code];
                    onUpdateFxRates(next);
                  }} />
                  <b>{currency}</b>
                </label>;
              })}
            </div>
          </div>}

          <div className="settings-section">
            <div className="section-title">
              <div>
                <h3>Recurring commitments</h3>
                <p className="muted">
                  Planning-only amounts Mizan adds each active month. Payment type says how money moves; purpose
                  says what it paid for. Do not add a commitment already counted by imported transactions.
                </p>
              </div>
              <button
                className="secondary"
                onClick={() => onUpdateFixedCosts([...fixedCosts, {
                  id: uid("fixed"),
                  label: "New cost",
                  amount: 0,
                  kind: "expense",
                  category: "housing",
                  beneficiary: { type: "household" },
                }])}
              >
                Add commitment
              </button>
            </div>
            {fixedCosts.length === 0 && <p className="muted empty-commitments">No recurring commitments yet.</p>}
            <div className="commitment-list">
              {fixedCosts.map((fixed) => (
                <article className="fixed-cost-card" key={fixed.id}>
                  <header className="fixed-cost-card-header">
                    <div>
                      <span className="soft-label">{movementInfo(fixed.kind).label}</span>
                      <strong>{fixed.label.trim() || "Untitled commitment"}</strong>
                    </div>
                    <IconButton label={`Delete ${fixed.label || "commitment"}`} icon={Trash2} danger onClick={() => onUpdateFixedCosts(fixedCosts.filter((item) => item.id !== fixed.id))} />
                  </header>
                  <div className="fixed-cost-grid">
                    <label className="field">
                      <span>Commitment name</span>
                      <input aria-label="Commitment name" value={fixed.label} onChange={(event) => patchFixed(fixed.id, { label: event.target.value })} />
                    </label>
                    <label className="field">
                      <span>Monthly amount</span>
                      <input aria-label={`Amount for ${fixed.label}`} type="number" min="0" value={fixed.amount} onChange={(event) => patchFixed(fixed.id, { amount: Math.max(0, Number(event.target.value) || 0) })} />
                    </label>
                    <label className="field">
                      <span>Payment type</span>
                      <select aria-label={`Payment type for ${fixed.label}`} value={fixed.kind} onChange={(event) => patchFixed(fixed.id, { kind: event.target.value as FixedCostKind })}>
                        <option value="expense">Bill / regular expense</option>
                        <option value="loan_payment">Loan / debt payment</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Purpose</span>
                      <select aria-label={`Purpose for ${fixed.label}`} value={fixed.category} onChange={(event) => patchFixed(fixed.id, { category: event.target.value as CategoryKey })}>
                        {categoryChoices.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="field">
                      <span>For whom</span>
                      <select
                        aria-label={`Beneficiary for ${fixed.label}`}
                        value={beneficiaryValue(fixed.beneficiary)}
                        onChange={(event) => patchFixed(fixed.id, { beneficiary: beneficiaryFromValue(event.target.value) })}
                      >
                        <option value="household">Household</option>
                        {members.map((member) => <option key={member.id} value={`member:${member.id}`}>{member.name}</option>)}
                        <option value="unassigned">Unassigned</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Final month (optional)</span>
                      <input
                        aria-label={`Last month for ${fixed.label}`}
                        type="month"
                        value={fixed.until ?? ""}
                        onChange={(event) => patchFixed(fixed.id, { until: event.target.value || undefined })}
                      />
                    </label>
                  </div>
                  {fixed.kind === "loan_payment" && (
                    <div className="fixed-purpose-guidance" role="note">
                      <div>
                        <strong>Purpose stays separate from the loan.</strong>
                        <span>For a car loan, Transport is valid. Use a custom purpose such as Vehicle loan only when you want a separate reporting bucket.</span>
                      </div>
                      <button className="link-button" onClick={() => setActiveTab("categories")}>Manage custom purposes</button>
                    </div>
                  )}
                  {fixed.kind === "expense" && looksLikeLoanCommitment(fixed.label) && (
                    <div className="fixed-purpose-guidance" role="note">
                      <div>
                        <strong>This name looks like a loan.</strong>
                        <span>Confirm the payment type so the commitment is described correctly. Its purpose can still be Transport, Housing, or another reporting bucket.</span>
                      </div>
                      <button className="link-button" onClick={() => patchFixed(fixed.id, { kind: "loan_payment" })}>Mark as loan / debt</button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>
        </>
      )}

      {activeTab === "categories" && (
        <>
          <div className="settings-section" id="settings-panel-categories" role="tabpanel" aria-labelledby="settings-tab-categories">
            <div className="section-title">
              <div>
                <h3>Custom categories</h3>
                <p className="muted">Your own spending buckets, on top of the built-in ones. Deleting one makes its transactions Uncategorized.</p>
              </div>
              <button
                className="secondary"
                onClick={() => onUpdateCustomCategories([...customCategories, { id: uid("cat"), label: "New category", color: "#7b8194" }])}
              >
                Add category
              </button>
            </div>
            <div className="settings-list">
              {customCategories.map((cat) => (
                <div className="member-row" key={cat.id}>
                  <input aria-label={`${cat.label || "Category"} name`} value={cat.label} onChange={(event) => patchCustom(cat.id, { label: event.target.value })} />
                  <input aria-label={`${cat.label || "Category"} colour`} type="color" value={cat.color} onChange={(event) => patchCustom(cat.id, { color: event.target.value })} />
                  <IconButton label={`Delete ${cat.label || "category"}`} icon={Trash2} danger onClick={() => onUpdateCustomCategories(customCategories.filter((item) => item.id !== cat.id))} />
                </div>
              ))}
              {!customCategories.length && <p className="muted">No custom categories yet.</p>}
            </div>
          </div>

          <div className="settings-section">
            <div className="section-title">
              <div>
                <h3>People</h3>
                <p className="muted">Friends or others you lend to, get repaid by, or give handouts to. Used to tag those movements.</p>
              </div>
              <button
                className="secondary"
                onClick={() => onUpdateCounterparties([...counterparties, { id: uid("cp"), name: "New person" }])}
              >
                Add person
              </button>
            </div>
            <div className="settings-list">
              {counterparties.map((cp) => (
                <div className="member-row" key={cp.id}>
                  <input aria-label={`${cp.name || "Person"} name`} value={cp.name} onChange={(event) => patchCounterparty(cp.id, event.target.value)} />
                  <IconButton label={`Delete ${cp.name || "person"}`} icon={Trash2} danger onClick={() => onUpdateCounterparties(counterparties.filter((item) => item.id !== cp.id))} />
                </div>
              ))}
              {!counterparties.length && <p className="muted">No people yet.</p>}
            </div>
          </div>
        </>
      )}

      {activeTab === "accounts" && (
        <>
          <div className="settings-section" id="settings-panel-accounts" role="tabpanel" aria-labelledby="settings-tab-accounts">
            <div className="section-title">
              <div>
                <h3>Accounts</h3>
                <p className="muted">
                  Keep who funded the account separate from who its spending is usually for. For a household card funded by one member,
                  choose that member under Paid/funded by and Household under Usually for; use Joint only when funding is genuinely joint.
                </p>
              </div>
              <button
                className="secondary"
                onClick={() => onUpdateAccounts([...data.accounts, {
                  id: uid("acc"), label: "", currency, owner: "joint", beneficiaryDefault: "review", match: [],
                }])}
              >
                Add account
              </button>
            </div>
            {data.accounts.length > 0 && (
              <div className="account-row account-row-headings" aria-hidden="true">
                <span>Account</span>
                <span>Paid/funded by</span>
                <span>Usually for</span>
                <span>Currency</span>
                <span>Statement match</span>
                <span />
              </div>
            )}
            {data.accounts.map((account) => (
              <div className="account-row" key={account.id}>
                <input value={account.label} placeholder="Account label" onChange={(event) => patchAccount(account.id, { label: event.target.value })} />
                <select
                  aria-label={`${account.label || "Account"} paid or funded by`}
                  value={account.owner}
                  onChange={(event) => patchAccount(account.id, { owner: event.target.value })}
                >
                  {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                  <option value="joint">Joint / unknown</option>
                </select>
                <select
                  aria-label={`${account.label || "Account"} usually for`}
                  value={account.beneficiaryDefault}
                  onChange={(event) => patchAccount(account.id, { beneficiaryDefault: event.target.value as Account["beneficiaryDefault"] })}
                >
                  <option value="owner" disabled={account.owner === "joint"}>Account owner</option>
                  <option value="household">Household</option>
                  <option value="review">Always review</option>
                </select>
                <input
                  aria-label={`${account.label || "Account"} currency`}
                  list="account-currencies"
                  value={account.currency || currency}
                  placeholder={currency || "Currency"}
                  onChange={(event) => patchAccount(account.id, { currency: event.target.value.toUpperCase().trim() })}
                />
                <input
                  value={account.match.join(", ")}
                  placeholder="match: 37xx 1234, amex"
                  onChange={(event) =>
                    patchAccount(account.id, { match: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })
                  }
                />
                <IconButton label={`Delete ${account.label}`} icon={Trash2} danger onClick={() => onUpdateAccounts(data.accounts.filter((item) => item.id !== account.id))} />
              </div>
            ))}
            <datalist id="account-currencies">{COMMON_CURRENCIES.map((code) => <option key={code} value={code} />)}</datalist>
            {!data.accounts.length && <p className="muted">No accounts yet. They also appear automatically when you import data.</p>}
          </div>

          <div className="settings-section">
            <h3>Merchant rules</h3>
            <p className="muted">Deleting a rule returns the transactions it controlled to the review queue (or to the next matching fallback rule).</p>
            <div className="rules-list">
              {Object.entries(data.merchantRules).map(([merchant, rule]) => {
                const person = rule.counterpartyId ? counterparties.find((cp) => cp.id === rule.counterpartyId)?.name : "";
                const label = isSpendKind(rule.kind)
                  ? `${rule.kind === "expense" ? "" : `${movementInfo(rule.kind).label} · `}${categoryInfo(rule.category, members, customCategories).label} · ${beneficiaryLabel(rule.beneficiary, members)}`
                  : `${movementInfo(rule.kind).label}${person ? ` · ${person}` : ""}`;
                return (
                  <div key={merchant}>
                    <span>{merchant}</span>
                    <strong>{label}</strong>
                    <IconButton label={`Delete merchant rule for ${merchant}`} icon={Trash2} danger onClick={() => onDeleteRule(merchant)} />
                  </div>
                );
              })}
              {!Object.keys(data.merchantRules).length && (
                <p className="muted">Rules appear when you categorize merchants in the review queue or the transactions table.</p>
              )}
            </div>
          </div>
        </>
      )}

      {activeTab === "sync" && (
        <>
          <div className="settings-section sync-section" id="settings-panel-sync" role="tabpanel" aria-labelledby="settings-tab-sync">
            <h3>Google sign-in & Firestore</h3>
            <p className="muted">
              Google sign-in identifies who is using Mizan. Financial data is stored in the active Firestore household.
              Bank files and passwords are never uploaded.
            </p>
            <div className="sync-card">
              <div>
                <span className="soft-label">Account</span>
                <strong>
                  {sync.auth.status === "signed-in"
                    ? sync.auth.user.displayName
                    : sync.auth.status === "unconfigured"
                      ? "Firebase not configured"
                      : "Signed out"}
                </strong>
                <small>{sync.auth.status === "signed-in" ? sync.auth.user.email : sync.auth.error || sync.status}</small>
              </div>
              <div className="sync-actions">
                {sync.auth.status === "signed-in" ? (
                  <button className="secondary" onClick={onSignOut}>Sign out</button>
                ) : (
                  <button disabled={sync.auth.status === "unconfigured"} onClick={onSignIn}>Sign in with Google</button>
                )}
              </div>
            </div>

            <div className="sync-card">
              <div>
                <span className="soft-label">Storage</span>
                <strong>{sync.mode === "cloud" ? sync.household?.name ?? "Household" : "No household selected"}</strong>
                <small>{sync.status}</small>
              </div>
            </div>

            {sync.auth.status === "signed-in" && (
              <>
                <div className="sync-actions sync-main-actions">
                  <button onClick={onCreateHousehold}>Create household</button>
                  <button className="secondary" onClick={onJoinHousehold}>Join with invite</button>
                </div>
                {sync.household && (
                  <div className="invite-box">
                    <span className="soft-label">Invite code</span>
                    <code>{sync.household.inviteCode}</code>
                    <button className="secondary" onClick={onRotateInvite}>Rotate invite code</button>
                  </div>
                )}
                {sync.households.length > 0 && (
                  <label className="field">
                    <span>Switch household</span>
                    <select value={sync.household?.id ?? ""} onChange={(event) => onSwitchHousehold(event.target.value)}>
                      <option value="" disabled>Choose household</option>
                      {sync.households.map((household) => (
                        <option key={household.householdId} value={household.householdId}>
                          {household.name} ({household.role})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
          </div>

          <div className="settings-section danger-zone">
            <div>
              <h3>Backup & danger area</h3>
              <p className="muted">Export before destructive changes. Import replaces the active Firestore household data.</p>
            </div>
            <div className="modal-actions">
              <button className="secondary" onClick={onExport}>Export JSON</button>
              <button className="secondary" onClick={() => importRef.current?.click()}>Import JSON</button>
              {hasLegacyBrowserData && (
                <button className="secondary danger" onClick={onClearData}>Remove old browser copy</button>
              )}
              <HouseholdTransactionClearAction
                canClearTransactions={canClearTransactions}
                hasTransactions={hasTransactions}
                onClearTransactions={onClearTransactions}
              />
              <HouseholdResetAction
                canResetHousehold={canResetHousehold}
                hasResettableData={hasResettableData}
                onResetHousehold={onResetHousehold}
              />
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
          </div>
        </>
      )}
    </Modal>
  );
}
