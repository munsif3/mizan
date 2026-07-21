import { useId, useRef, useState, type CSSProperties } from "react";
import { Trash2 } from "lucide-react";
import { syncBadgeLabel, syncBadgeTone, type SyncState } from "../app/syncState";
import type { AuthState } from "../auth/authStore";
import { categoryOptions, nextMemberColor } from "../domain/categories";
import { isoDateOf } from "../domain/dates";
import { movementInfo } from "../domain/movements";
import { memberLifecycleLabel, memberStatusOn } from "../domain/memberLifecycle";
import type { Account, AppData, CategoryKey, Counterparty, CustomCategory, FixedCost, FixedCostKind, IncomePortion, Member, MerchantRule, MovementKind, SpendBeneficiary } from "../domain/types";
import type { HouseholdMeta, UserHouseholdLink } from "../household/types";
import type { RepositoryMode } from "../storage/repository";
import { uid } from "../domain/types";
import { Button, ConfirmDialog, IconButton, Modal, StatusBadge, Tabs } from "./bits";
import { COMMON_CURRENCIES } from "./currencies";
import { RuleFields, ruleBeneficiaryValue, ruleFromControls, type RuleBeneficiaryValue } from "./ruleFields";

export interface SyncSettingsState {
  auth: AuthState;
  mode: RepositoryMode;
  status: SyncState;
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

type SettingsModalProps = {
  data: AppData;
  onUpdateMembers: (members: Member[]) => void;
  onUpdateTarget: (targetSaveRate: number) => void;
  onUpdateCurrency: (currency: string, locale: string) => void;
  onUpdateFxRates: (fxRates: Record<string, number>) => void;
  onUpdateFixedCosts: (fixedCosts: FixedCost[]) => void;
  onUpdateAccounts: (accounts: Account[]) => void;
  onUpsertRule: (merchant: string, rule: MerchantRule) => void;
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
  onLinkAccessMember?: (uid: string, memberId: string) => Promise<void>;
  onPromoteOwner?: (uid: string, makePrimary?: boolean) => Promise<void>;
  onRevokeAccess?: (uid: string) => Promise<void>;
  onLeaveHousehold?: () => Promise<void>;
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
};

function beneficiaryValue(beneficiary: SpendBeneficiary): string {
  return beneficiary.type === "member" ? `member:${beneficiary.memberId}` : beneficiary.type;
}

function beneficiaryFromValue(value: string): SpendBeneficiary {
  if (value.startsWith("member:")) return { type: "member", memberId: value.slice("member:".length) };
  return value === "household" ? { type: "household" } : { type: "unassigned" };
}

function memberHasReferences(data: AppData, memberId: string): boolean {
  const benefitsMember = (beneficiary: SpendBeneficiary | MerchantRule["beneficiary"]) =>
    beneficiary.type === "member" && beneficiary.memberId === memberId;
  return data.transactions.some((transaction) => benefitsMember(transaction.beneficiary))
    || data.accounts.some((account) => account.owner === memberId)
    || data.fixedCosts.some((fixed) => benefitsMember(fixed.beneficiary))
    || Object.values(data.merchantRules).some((rule) => benefitsMember(rule.beneficiary))
    || data.incomeReceipts.some((receipt) => receipt.memberId === memberId)
    || data.sharedContributions.some((contribution) => contribution.contributorMemberId === memberId)
    || data.efficiencyPlans.some((plan) => benefitsMember(plan.subject.beneficiary));
}

type LifecycleAction = "away" | "resume" | "left" | "deceased" | "restore";

function MemberLifecycleDialog({
  member,
  onSave,
  onClose,
}: {
  member: Member;
  onSave: (member: Member, accountArchiveOn?: string, accountRestoreFrom?: string) => void;
  onClose: () => void;
}) {
  const today = isoDateOf(new Date());
  const status = memberStatusOn(member, today);
  const [action, setAction] = useState<LifecycleAction>(
    status === "away" ? "resume" : status === "left" || status === "deceased" ? "restore" : "away",
  );
  const [effectiveOn, setEffectiveOn] = useState(today);
  const [resumeOn, setResumeOn] = useState("");
  const openAwayFrom = member.lifecycle?.awayPeriods.find((period) => !period.resumeOn)?.from ?? "";
  const invalidDate = (action === "away" && Boolean(resumeOn) && resumeOn <= effectiveOn)
    || (action === "resume" && Boolean(openAwayFrom) && effectiveOn <= openAwayFrom);
  const submit = () => {
    if (!effectiveOn || invalidDate) return;
    const lifecycle = member.lifecycle ?? { awayPeriods: [] };
    if (action === "away") {
      onSave({
        ...member,
        lifecycle: {
          ...lifecycle,
          awayPeriods: [...lifecycle.awayPeriods, {
            id: uid("away"),
            from: effectiveOn,
            ...(resumeOn && resumeOn > effectiveOn ? { resumeOn } : {}),
          }],
        },
      });
    } else if (action === "resume") {
      onSave({
        ...member,
        lifecycle: {
          ...lifecycle,
          awayPeriods: lifecycle.awayPeriods.map((period) => !period.resumeOn
            ? { ...period, resumeOn: effectiveOn }
            : period),
        },
      });
    } else if (action === "left" || action === "deceased") {
      onSave({
        ...member,
        lifecycle: {
          ...lifecycle,
          inactiveFrom: effectiveOn,
          inactiveReason: action,
          awayPeriods: lifecycle.awayPeriods.map((period) => !period.resumeOn
            ? { ...period, resumeOn: effectiveOn }
            : period),
        },
      }, effectiveOn);
    } else {
      const inactiveFrom = lifecycle.inactiveFrom;
      const awayPeriods = inactiveFrom && effectiveOn > inactiveFrom
        ? [...lifecycle.awayPeriods, { id: uid("away"), from: inactiveFrom, resumeOn: effectiveOn }]
        : lifecycle.awayPeriods;
      const { inactiveFrom: _inactiveFrom, inactiveReason: _inactiveReason, ...rest } = lifecycle;
      onSave({ ...member, lifecycle: { ...rest, awayPeriods } }, undefined, inactiveFrom);
    }
    onClose();
  };
  return (
    <Modal title={`Change ${member.name}'s participation`} onClose={onClose}>
      <div className="reset-household-form">
        <p className="muted">Effective dates change future allocations without rewriting transactions, receipts, or account ownership history.</p>
        <label className="field">
          <span>Change</span>
          <select value={action} onChange={(event) => setAction(event.target.value as LifecycleAction)}>
            {(status === "active" || status === "not_started") && <option value="away">Temporarily away</option>}
            {status === "away" && <option value="resume">Resume participation</option>}
            {(status === "left" || status === "deceased") && <option value="restore">Restore participation</option>}
            {status !== "left" && status !== "deceased" && <option value="left">Left household</option>}
            {status !== "left" && status !== "deceased" && <option value="deceased">Deceased</option>}
          </select>
        </label>
        <label className="field">
          <span>{action === "resume" || action === "restore" ? "Participates again from" : "Effective from"}</span>
          <input type="date" value={effectiveOn} onChange={(event) => setEffectiveOn(event.target.value)} />
        </label>
        {action === "away" && <label className="field">
          <span>Expected return date (optional)</span>
          <input type="date" min={effectiveOn} value={resumeOn} onChange={(event) => setResumeOn(event.target.value)} />
        </label>}
        {invalidDate && <p className="notice" role="alert">The return date must be after the absence starts.</p>}
        {(action === "left" || action === "deceased") && <div className="reset-warning">
          Owned accounts will be archived from this date. Future personal fixed commitments will be flagged
          for reassignment. Historical financial evidence remains intact.
        </div>}
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant={action === "deceased" ? "danger" : "primary"} disabled={!effectiveOn || invalidDate} onClick={submit}>Save participation</Button>
        </div>
      </div>
    </Modal>
  );
}

function looksLikeLoanCommitment(label: string): boolean {
  return /\b(?:loan|mortgage|debt)\b/i.test(label);
}

function useSettingsModel({
  data,
  onUpdateMembers,
  onUpdateTarget,
  onUpdateCurrency,
  onUpdateFxRates,
  onUpdateFixedCosts,
  onUpdateAccounts,
  onUpsertRule,
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
  onLinkAccessMember = async () => undefined,
  onPromoteOwner = async () => undefined,
  onRevokeAccess = async () => undefined,
  onLeaveHousehold = async () => undefined,
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
}: SettingsModalProps) {
  const currenciesId = useId();
  const importRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("household");
  const [pendingDelete, setPendingDelete] = useState<null | {
    title: string;
    body: string;
    confirmLabel: string;
    action: () => void;
  }>(null);
  const [lifecycleMemberId, setLifecycleMemberId] = useState("");
  const { members, currency, locale, fxRates, counterparties, customCategories } = data.settings;
  const fixedCosts = data.fixedCosts;
  const categoryChoices = categoryOptions(customCategories);

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
    const portion = members.find((member) => member.id === memberId)?.portions.find((item) => item.id === portionId);
    setPendingDelete({
      title: "Delete income source?",
      body: confirmationCount
        ? `${portion?.label || "This income source"} has ${confirmationCount} historical confirmation${confirmationCount === 1 ? "" : "s"}. Deleting it cannot be undone.`
        : `${portion?.label || "This income source"} will be removed from the household income plan.`,
      confirmLabel: "Delete income source",
      action: () => onUpdateMembers(members.map((member) => member.id === memberId
        ? { ...member, portions: member.portions.filter((item) => item.id !== portionId) }
        : member)),
    });
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
    if (members.length <= 1 || memberHasReferences(data, member.id)) return;
    setPendingDelete({
      title: `Delete ${member.name || "member"}?`,
      body: "This unused profile has no financial references and will be removed.",
      confirmLabel: "Delete unused profile",
      action: () => onUpdateMembers(members.filter((item) => item.id !== member.id)),
    });
  };
  const requestDelete = (title: string, body: string, confirmLabel: string, action: () => void) =>
    setPendingDelete({ title, body, confirmLabel, action });
  const patchFixed = (id: string, patch: Partial<FixedCost>) =>
    onUpdateFixedCosts(fixedCosts.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const patchAccount = (id: string, patch: Partial<Account>) =>
    onUpdateAccounts(data.accounts.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  return {
    data, onUpdateMembers, onUpdateTarget, onUpdateCurrency, onUpdateFxRates,
    onUpdateFixedCosts, onUpdateAccounts, onUpsertRule, onDeleteRule, onUpdateCounterparties,
    onUpdateCustomCategories, sync, onSignIn, onSignOut, onCreateHousehold,
    onJoinHousehold, onSwitchHousehold, onRotateInvite, onLinkAccessMember, onPromoteOwner,
    onRevokeAccess, onLeaveHousehold, onExport, onImportBackup,
    hasLegacyBrowserData, onClearData, canClearTransactions, hasTransactions,
    onClearTransactions, canResetHousehold, hasResettableData, onResetHousehold, onClose,
    currenciesId, importRef, activeTab, setActiveTab, pendingDelete, setPendingDelete,
    lifecycleMemberId, setLifecycleMemberId,
    members, currency, locale, fxRates, counterparties, customCategories, fixedCosts,
    categoryChoices, patchCounterparty, patchCustom, patchMember, patchPortion,
    removePortion, addPortion, foreignCurrencies, removeMember, requestDelete,
    patchFixed, patchAccount,
  };
}

type SettingsModel = ReturnType<typeof useSettingsModel>;

function HouseholdSettings({ model }: { model: SettingsModel }) {
  const {
    activeTab, data, onUpdateMembers, members, patchMember, addPortion, removeMember,
    removePortion, patchPortion, currenciesId, currency, lifecycleMemberId, setLifecycleMemberId,
    onUpdateAccounts,
  } = model;
  return (
    <>
      {activeTab === "household" && (
        <div className="settings-section" id="settings-panel-household" role="tabpanel" aria-labelledby="settings-tab-household">
          <div className="section-title">
            <div>
              <h3>Household members</h3>
              <p className="muted">Each person can have several deposits with their own currency, tax treatment, and arrival window.</p>
            </div>
            <Button
              variant="secondary"
              onClick={() => onUpdateMembers([...members, { id: uid("mem"), name: "New member", color: nextMemberColor(members), portions: [] }])}
            >
              Add member
            </Button>
          </div>
          <div className="settings-list">
            {members.map((member, memberIndex) => (
              <div className="income-member" key={member.id} style={{ "--member-color": member.color } as CSSProperties}>
                <div className="income-member-header">
                  <div className="income-member-title">
                    <span className="income-member-avatar" aria-hidden="true">{member.name.trim().charAt(0).toUpperCase() || memberIndex + 1}</span>
                    <div>
                      <span className="income-profile-kicker">
                        Income profile {memberIndex + 1} · {memberLifecycleLabel(member, isoDateOf(new Date()))}
                      </span>
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
                    <Button variant="primary" onClick={() => addPortion(member.id)}>Add monthly deposit</Button>
                    <Button variant="secondary" onClick={() => addPortion(member.id, "one_off")}>Add one-off income</Button>
                    <Button variant="secondary" onClick={() => setLifecycleMemberId(member.id)}>Change participation</Button>
                    {members.length > 1 && !memberHasReferences(data, member.id) && (
                      <IconButton label={`Delete ${member.name || "member"}`} title="Delete unused profile" icon={Trash2} danger onClick={() => removeMember(member)} />
                    )}
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
                  {!member.portions.length && <div className="income-deposit-empty"><strong>No deposits yet</strong><p>Add regular salary or planned one-off income.</p><Button variant="primary" onClick={() => addPortion(member.id)}>Add first deposit</Button></div>}
                </div>
              </div>
            ))}
            <datalist id={currenciesId}>{COMMON_CURRENCIES.map((code) => <option key={code} value={code} />)}</datalist>
          </div>
          {lifecycleMemberId && members.find((member) => member.id === lifecycleMemberId) && (
            <MemberLifecycleDialog
              member={members.find((member) => member.id === lifecycleMemberId)!}
              onClose={() => setLifecycleMemberId("")}
              onSave={(nextMember, accountArchiveOn, accountRestoreFrom) => {
                onUpdateMembers(members.map((member) => member.id === nextMember.id ? nextMember : member));
                if (accountArchiveOn) {
                  onUpdateAccounts(data.accounts.map((account) => account.owner === nextMember.id
                    && (!account.inactiveFrom || account.inactiveFrom > accountArchiveOn)
                    ? { ...account, inactiveFrom: accountArchiveOn }
                    : account));
                } else if (accountRestoreFrom) {
                  onUpdateAccounts(data.accounts.map((account) => account.owner === nextMember.id
                    && account.inactiveFrom === accountRestoreFrom
                    ? { ...account, inactiveFrom: undefined }
                    : account));
                }
              }}
            />
          )}
        </div>
      )}

    </>
  );
}

function BudgetSettings({ model }: { model: SettingsModel }) {
  const {
    activeTab, currency, locale, onUpdateCurrency, data, onUpdateTarget, foreignCurrencies,
    fxRates, onUpdateFxRates, fixedCosts, onUpdateFixedCosts, patchFixed, categoryChoices,
    members, requestDelete, setActiveTab,
  } = model;
  return (
    <>
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
              <Button
                variant="secondary"
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
              </Button>
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
                    <IconButton
                      label={`Delete ${fixed.label || "commitment"}`}
                      icon={Trash2}
                      danger
                      onClick={() => requestDelete(
                        "Delete commitment?",
                        `${fixed.label || "This commitment"} will be removed from future monthly planning.`,
                        "Delete commitment",
                        () => onUpdateFixedCosts(fixedCosts.filter((item) => item.id !== fixed.id)),
                      )}
                    />
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

    </>
  );
}

function CategoryPeopleSettings({ model }: { model: SettingsModel }) {
  const {
    activeTab, counterparties, patchCounterparty, onUpdateCounterparties, customCategories,
    patchCustom, onUpdateCustomCategories, requestDelete,
  } = model;
  return (
    <>
      {activeTab === "categories" && (
        <>
          <div className="settings-section" id="settings-panel-categories" role="tabpanel" aria-labelledby="settings-tab-categories">
            <div className="section-title">
              <div>
                <h3>Custom categories</h3>
                <p className="muted">Your own spending buckets, on top of the built-in ones. Deleting one makes its transactions Uncategorized.</p>
              </div>
              <Button
                variant="secondary"
                onClick={() => onUpdateCustomCategories([...customCategories, { id: uid("cat"), label: "New category", color: "#7b8194" }])}
              >
                Add category
              </Button>
            </div>
            <div className="settings-list">
              {customCategories.map((cat) => (
                <div className="member-row" key={cat.id}>
                  <input aria-label={`${cat.label || "Category"} name`} value={cat.label} onChange={(event) => patchCustom(cat.id, { label: event.target.value })} />
                  <input aria-label={`${cat.label || "Category"} colour`} type="color" value={cat.color} onChange={(event) => patchCustom(cat.id, { color: event.target.value })} />
                  <IconButton
                    label={`Delete ${cat.label || "category"}`}
                    icon={Trash2}
                    danger
                    onClick={() => requestDelete(
                      "Delete category?",
                      `Transactions using ${cat.label || "this category"} will become Uncategorized.`,
                      "Delete category",
                      () => onUpdateCustomCategories(customCategories.filter((item) => item.id !== cat.id)),
                    )}
                  />
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
              <Button
                variant="secondary"
                onClick={() => onUpdateCounterparties([...counterparties, { id: uid("cp"), name: "New person" }])}
              >
                Add person
              </Button>
            </div>
            <div className="settings-list">
              {counterparties.map((cp) => (
                <div className="member-row" key={cp.id}>
                  <input aria-label={`${cp.name || "Person"} name`} value={cp.name} onChange={(event) => patchCounterparty(cp.id, event.target.value)} />
                  <IconButton
                    label={`Delete ${cp.name || "person"}`}
                    icon={Trash2}
                    danger
                    onClick={() => requestDelete(
                      "Delete person?",
                      `${cp.name || "This person"} will no longer be available for lending, repayment, or gift classifications.`,
                      "Delete person",
                      () => onUpdateCounterparties(counterparties.filter((item) => item.id !== cp.id)),
                    )}
                  />
                </div>
              ))}
              {!counterparties.length && <p className="muted">No people yet.</p>}
            </div>
          </div>
        </>
      )}

    </>
  );
}

function AccountRuleSettings({ model }: { model: SettingsModel }) {
  const {
    activeTab, data, patchAccount, onUpdateAccounts, members, requestDelete,
    onUpsertRule, onDeleteRule, currency, counterparties, customCategories,
  } = model;
  const solo = members.length === 1;
  return (
    <>
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
              <Button
                variant="secondary"
                onClick={() => onUpdateAccounts([...data.accounts, {
                  id: uid("acc"), label: "", currency, owner: "joint", beneficiaryDefault: "review", match: [],
                }])}
              >
                Add account
              </Button>
            </div>
            {data.accounts.length > 0 && (
              <div className="account-row account-row-headings" aria-hidden="true">
                <span>Account</span>
                <span>Paid/funded by</span>
                <span>Usually for</span>
                <span>Currency</span>
                <span>Statement match</span>
                <span>Updated through</span>
                <span />
              </div>
            )}
            {data.accounts.map((account) => (
              <div className="account-row" key={account.id}>
                <input aria-label={`${account.label || "Account"} label`} value={account.label} placeholder="Account label" onChange={(event) => patchAccount(account.id, { label: event.target.value })} />
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
                  aria-label={`${account.label || "Account"} statement match text`}
                  value={account.match.join(", ")}
                  placeholder="match: 37xx 1234, amex"
                  onChange={(event) =>
                    patchAccount(account.id, { match: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })
                  }
                />
                <input
                  aria-label={`${account.label || "Account"} updated through`}
                  type="date"
                  max={isoDateOf(new Date())}
                  value={account.coverage?.throughDate ?? ""}
                  onChange={(event) => patchAccount(account.id, {
                    coverage: event.target.value && model.sync.auth.status === "signed-in"
                      ? {
                          throughDate: event.target.value,
                          confirmedAt: new Date().toISOString(),
                          confirmedByUid: model.sync.auth.user.uid,
                          source: "manual",
                        }
                      : undefined,
                  })}
                />
                <IconButton
                  label={`Delete ${account.label}`}
                  icon={Trash2}
                  danger
                  onClick={() => requestDelete(
                    "Delete account?",
                    `${account.label || "This account"} will be removed from account matching and future classification. Existing transactions remain in the ledger.`,
                    "Delete account",
                    () => onUpdateAccounts(data.accounts.filter((item) => item.id !== account.id)),
                  )}
                />
              </div>
            ))}
            <datalist id="account-currencies">{COMMON_CURRENCIES.map((code) => <option key={code} value={code} />)}</datalist>
            {!data.accounts.length && <p className="muted">No accounts yet. They also appear automatically when you import data.</p>}
          </div>

          <div className="settings-section">
            <h3>Merchant rules</h3>
            <p className="muted">Edit how a merchant is classified and it re-applies to every unlocked transaction. Deleting a rule returns the transactions it controlled to the review queue (or to the next matching fallback rule).</p>
            <div className="rules-list">
              {Object.entries(data.merchantRules).map(([merchant, rule]) => {
                const emit = (patch: Partial<{ kind: MovementKind; category: CategoryKey; beneficiary: RuleBeneficiaryValue; counterpartyId: string }>) =>
                  onUpsertRule(merchant, ruleFromControls(
                    patch.kind ?? rule.kind,
                    patch.category ?? rule.category,
                    patch.beneficiary ?? ruleBeneficiaryValue(rule.beneficiary),
                    patch.counterpartyId ?? rule.counterpartyId ?? "",
                    solo,
                  ));
                return (
                  <div className="rule-row" key={merchant}>
                    <span className="rule-merchant" title={merchant}>{merchant}</span>
                    <RuleFields
                      context={merchant}
                      kind={rule.kind}
                      category={rule.category}
                      beneficiary={ruleBeneficiaryValue(rule.beneficiary)}
                      counterpartyId={rule.counterpartyId ?? ""}
                      members={members}
                      counterparties={counterparties}
                      customCategories={customCategories}
                      solo={solo}
                      categoryLabel="Purpose"
                      beneficiaryLabel="For whom"
                      onKind={(kind) => emit({ kind })}
                      onCategory={(category) => emit({ category })}
                      onBeneficiary={(beneficiary) => emit({ beneficiary })}
                      onCounterparty={(counterpartyId) => emit({ counterpartyId })}
                    />
                    <IconButton
                      label={`Delete merchant rule for ${merchant}`}
                      icon={Trash2}
                      danger
                      onClick={() => requestDelete(
                        "Delete merchant rule?",
                        `${merchant} transactions will return to the review queue or the next matching fallback rule.`,
                        "Delete rule",
                        () => onDeleteRule(merchant),
                      )}
                    />
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

    </>
  );
}

function SyncBackupSettings({ model }: { model: SettingsModel }) {
  const {
    activeTab, sync, onSignOut, onSignIn, onCreateHousehold, onJoinHousehold,
    onRotateInvite, onSwitchHousehold, onExport, importRef, hasLegacyBrowserData,
    requestDelete, onClearData, canClearTransactions, hasTransactions, onClearTransactions,
    canResetHousehold, hasResettableData, onResetHousehold, onImportBackup,
    onLinkAccessMember, onPromoteOwner, onRevokeAccess, onLeaveHousehold, data,
  } = model;
  const currentUid = sync.auth.status === "signed-in" ? sync.auth.user.uid : "";
  const currentAccess = sync.household?.membersByUid[currentUid];
  const canManageAccess = currentAccess?.role === "owner";
  return (
    <>
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
                <small>{sync.auth.status === "signed-in" ? sync.auth.user.email : sync.auth.error || sync.status.message}</small>
              </div>
              <div className="sync-actions">
                {sync.auth.status === "signed-in" ? (
                  <Button variant="secondary" onClick={onSignOut}>Sign out</Button>
                ) : (
                  <Button variant="primary" disabled={sync.auth.status === "unconfigured"} onClick={onSignIn}>Sign in with Google</Button>
                )}
              </div>
            </div>

            <div className="sync-card">
              <div>
                <span className="soft-label">Storage</span>
                <strong>{sync.mode === "cloud" ? sync.household?.name ?? "Household" : "No household selected"}</strong>
                <small>{sync.status.message}</small>
              </div>
            </div>

            {sync.auth.status === "signed-in" && (
              <>
                <div className="sync-actions sync-main-actions">
                  <Button variant="primary" onClick={onCreateHousehold}>Create household</Button>
                  <Button variant="secondary" onClick={onJoinHousehold}>Join with invite</Button>
                </div>
                {sync.household && (
                  <div className="invite-box">
                    <span className="soft-label">Invite code</span>
                    <code>{sync.household.inviteCode}</code>
                    {canManageAccess && <Button variant="secondary" onClick={onRotateInvite}>Rotate invite code</Button>}
                  </div>
                )}
                {sync.household && (
                  <div className="access-list" aria-label="Household app access">
                    <div>
                      <h4>App access and recovery owners</h4>
                      <p className="muted">Access is separate from financial participation. Keep a second owner so the household is not stranded.</p>
                    </div>
                    {Object.entries(sync.household.membersByUid).map(([uidValue, access]) => (
                      <div className="access-row" key={uidValue}>
                        <div>
                          <strong>{access.displayName || access.email}</strong>
                          <small>{access.email} · {access.role}{uidValue === sync.household?.ownerUid ? " · primary" : ""}</small>
                        </div>
                        <select
                          aria-label={`Budget member for ${access.displayName || access.email}`}
                          value={access.memberId ?? ""}
                          disabled={!canManageAccess}
                          onChange={(event) => void onLinkAccessMember(uidValue, event.target.value)}
                        >
                          <option value="">Not linked</option>
                          {data.settings.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                        </select>
                        {canManageAccess && access.role !== "owner" && (
                          <Button variant="secondary" onClick={() => void onPromoteOwner(uidValue)}>Make recovery owner</Button>
                        )}
                        {canManageAccess && access.role === "owner" && uidValue !== sync.household?.ownerUid && (
                          <Button variant="secondary" onClick={() => void onPromoteOwner(uidValue, true)}>Make primary</Button>
                        )}
                        {canManageAccess && uidValue !== sync.household?.ownerUid && uidValue !== currentUid && (
                          <Button variant="danger" onClick={() => requestDelete(
                            "Revoke household access?",
                            `${access.displayName || access.email} will immediately lose Firestore access. Financial history is preserved and the invite code will rotate.`,
                            "Revoke access",
                            () => { void onRevokeAccess(uidValue); },
                          )}>Revoke</Button>
                        )}
                      </div>
                    ))}
                    {Object.values(sync.household.membersByUid).filter((access) => access.role === "owner").length < 2 && (
                      <div className="reset-warning">Add a recovery owner. A sole owner who becomes unavailable cannot be replaced safely from the client.</div>
                    )}
                    {currentUid !== sync.household.ownerUid ? (
                      <Button variant="danger" onClick={() => requestDelete(
                        "Leave household access?",
                        "You will lose access, but budget members and financial history will not be changed.",
                        "Leave household",
                        () => { void onLeaveHousehold(); },
                      )}>Leave household</Button>
                    ) : (
                      <small className="muted">Transfer primary ownership before leaving this household.</small>
                    )}
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
              <Button variant="secondary" onClick={onExport}>Export JSON</Button>
              <Button variant="secondary" onClick={() => importRef.current?.click()}>Import JSON</Button>
              {hasLegacyBrowserData && (
                <Button
                  variant="danger"
                  onClick={() => requestDelete(
                    "Remove old browser copy?",
                    "Only legacy financial data stored in this browser will be removed. The active Firestore household will not be changed.",
                    "Remove browser copy",
                    onClearData,
                  )}
                >
                  Remove old browser copy
                </Button>
              )}
              {canClearTransactions && hasTransactions && (
                <Button variant="danger" onClick={onClearTransactions}>Clear transactions</Button>
              )}
              {canResetHousehold && hasResettableData && (
                <Button variant="danger" onClick={onResetHousehold}>Reset household data</Button>
              )}
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
    </>
  );
}

function SettingsBody({ model }: { model: SettingsModel }) {
  const {
    sync, onClose, activeTab, setActiveTab, pendingDelete, setPendingDelete,
  } = model;
  return (
    <Modal
      title="Settings"
      onClose={onClose}
      wide
      meta={
        <span className="settings-save-status">
          <StatusBadge tone={syncBadgeTone(sync.status)}>
            {syncBadgeLabel(sync.status)}
          </StatusBadge>
          <span>Changes save automatically</span>
        </span>
      }
    >
      <div className="settings-layout">
      <aside className="settings-navigation">
      <label className="settings-mobile-select">
        <span>Settings section</span>
        <select value={activeTab} onChange={(event) => setActiveTab(event.target.value as SettingsTab)}>
          {SETTINGS_TABS.map((tab) => <option value={tab.id} key={tab.id}>{tab.label}</option>)}
        </select>
      </label>
      <Tabs
        idPrefix="settings"
        label="Settings sections"
        orientation="vertical"
        className="settings-tabs"
        value={activeTab}
        items={SETTINGS_TABS.map((tab) => ({
          id: tab.id,
          label: tab.label,
          panelId: `settings-panel-${tab.id}`,
        }))}
        onChange={setActiveTab}
      />
      </aside>
      <div className="settings-content">

      <HouseholdSettings model={model} />

      <BudgetSettings model={model} />

      <CategoryPeopleSettings model={model} />

      <AccountRuleSettings model={model} />

      <SyncBackupSettings model={model} />

      </div>
      </div>
      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.title}
          confirmLabel={pendingDelete.confirmLabel}
          onClose={() => setPendingDelete(null)}
          onConfirm={() => {
            pendingDelete.action();
            setPendingDelete(null);
          }}
        >
          <p>{pendingDelete.body}</p>
        </ConfirmDialog>
      )}
    </Modal>
  );
}

export function SettingsModal(props: SettingsModalProps) {
  return <SettingsBody model={useSettingsModel(props)} />;
}
