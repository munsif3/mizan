import {
  useEffect,
  useId,
  useState,
  type CSSProperties,
} from "react";
import { Trash2 } from "lucide-react";
import type { SettingsTarget } from "../../app/settingsTarget";
import { nextMemberColor } from "../../domain/categories";
import { isoDateOf } from "../../domain/dates";
import { memberLifecycleLabel, memberStatusOn } from "../../domain/memberLifecycle";
import {
  uid,
  type Account,
  type AppData,
  type IncomePortion,
  type Member,
  type MerchantRule,
  type SpendBeneficiary,
} from "../../domain/types";
import { Button, IconButton, Modal } from "../bits";
import { COMMON_CURRENCIES } from "../currencies";
import type { RequestConfirmation } from "./shared";

export interface HouseholdSettingsProps {
  active: boolean;
  data: AppData;
  target: SettingsTarget;
  onUpdateMembers: (members: Member[]) => void;
  onUpdateAccounts: (accounts: Account[]) => void;
  requestConfirmation: RequestConfirmation;
}

type LifecycleAction = "away" | "resume" | "left" | "deceased" | "restore";

function memberHasReferences(data: AppData, memberId: string): boolean {
  const benefitsMember = (beneficiary: SpendBeneficiary | MerchantRule["beneficiary"]) =>
    beneficiary.type === "member" && beneficiary.memberId === memberId;
  return data.transactions.some((transaction) => benefitsMember(transaction.beneficiary))
    || data.accounts.some((account) => account.owner === memberId)
    || data.fixedCosts.some((fixed) => benefitsMember(fixed.beneficiary))
    || data.assetHoldings.some((holding) => holding.owner === memberId)
    || Object.values(data.merchantRules).some((rule) => benefitsMember(rule.beneficiary))
    || data.incomeReceipts.some((receipt) => receipt.memberId === memberId)
    || data.sharedContributions.some(
      (contribution) => contribution.contributorMemberId === memberId,
    )
    || data.efficiencyPlans.some((plan) => benefitsMember(plan.subject.beneficiary));
}

function cloneMember(member: Member): Member {
  return {
    ...member,
    portions: member.portions.map((portion) => ({
      ...portion,
      schedule: { ...portion.schedule },
      window: portion.window ? { ...portion.window } : null,
    })),
  };
}

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
    status === "away"
      ? "resume"
      : status === "left" || status === "deceased"
        ? "restore"
        : "away",
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
          awayPeriods: [
            ...lifecycle.awayPeriods,
            {
              id: uid("away"),
              from: effectiveOn,
              ...(resumeOn && resumeOn > effectiveOn ? { resumeOn } : {}),
            },
          ],
        },
      });
    } else if (action === "resume") {
      onSave({
        ...member,
        lifecycle: {
          ...lifecycle,
          awayPeriods: lifecycle.awayPeriods.map((period) =>
            !period.resumeOn ? { ...period, resumeOn: effectiveOn } : period),
        },
      });
    } else if (action === "left" || action === "deceased") {
      onSave({
        ...member,
        lifecycle: {
          ...lifecycle,
          inactiveFrom: effectiveOn,
          inactiveReason: action,
          awayPeriods: lifecycle.awayPeriods.map((period) =>
            !period.resumeOn ? { ...period, resumeOn: effectiveOn } : period),
        },
      }, effectiveOn);
    } else {
      const inactiveFrom = lifecycle.inactiveFrom;
      const awayPeriods = inactiveFrom && effectiveOn > inactiveFrom
        ? [
            ...lifecycle.awayPeriods,
            { id: uid("away"), from: inactiveFrom, resumeOn: effectiveOn },
          ]
        : lifecycle.awayPeriods;
      const {
        inactiveFrom: _inactiveFrom,
        inactiveReason: _inactiveReason,
        ...rest
      } = lifecycle;
      onSave(
        { ...member, lifecycle: { ...rest, awayPeriods } },
        undefined,
        inactiveFrom,
      );
    }
    onClose();
  };
  return (
    <Modal title={`Change ${member.name}'s participation`} onClose={onClose}>
      <div className="reset-household-form">
        <p className="muted">
          Effective dates change future allocations without rewriting transactions, receipts,
          or account ownership history.
        </p>
        <label className="field">
          <span>Change</span>
          <select
            value={action}
            onChange={(event) => setAction(event.target.value as LifecycleAction)}
          >
            {(status === "active" || status === "not_started") && (
              <option value="away">Temporarily away</option>
            )}
            {status === "away" && <option value="resume">Resume participation</option>}
            {(status === "left" || status === "deceased") && (
              <option value="restore">Restore participation</option>
            )}
            {status !== "left" && status !== "deceased" && (
              <option value="left">Left household</option>
            )}
            {status !== "left" && status !== "deceased" && (
              <option value="deceased">Deceased</option>
            )}
          </select>
        </label>
        <label className="field">
          <span>
            {action === "resume" || action === "restore"
              ? "Participates again from"
              : "Effective from"}
          </span>
          <input
            type="date"
            value={effectiveOn}
            onChange={(event) => setEffectiveOn(event.target.value)}
          />
        </label>
        {action === "away" && (
          <label className="field">
            <span>Expected return date (optional)</span>
            <input
              type="date"
              min={effectiveOn}
              value={resumeOn}
              onChange={(event) => setResumeOn(event.target.value)}
            />
          </label>
        )}
        {invalidDate && (
          <p className="notice" role="alert">The return date must be after the absence starts.</p>
        )}
        {(action === "left" || action === "deceased") && (
          <div className="reset-warning">
            Owned accounts will be archived from this date. Future personal fixed commitments
            will be flagged for reassignment. Historical financial evidence remains intact.
          </div>
        )}
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant={action === "deceased" ? "danger" : "primary"}
            disabled={!effectiveOn || invalidDate}
            onClick={submit}
          >
            Save participation
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function depositSummary(portion: IncomePortion): string {
  const timing = portion.schedule.frequency === "one_off"
    ? `One-off · ${portion.schedule.month}`
    : "Monthly";
  return `${timing} · ${portion.amount.toLocaleString()} ${portion.currency}`;
}

export function HouseholdSettings({
  active,
  data,
  target,
  onUpdateMembers,
  onUpdateAccounts,
  requestConfirmation,
}: HouseholdSettingsProps) {
  const currenciesId = useId();
  const members = data.settings.members;
  const currency = data.settings.currency;
  const [draftMember, setDraftMember] = useState<Member | null>(null);
  const [editingPortionId, setEditingPortionId] = useState("");
  const [lifecycleMemberId, setLifecycleMemberId] = useState("");
  const originalMember = draftMember
    ? members.find((member) => member.id === draftMember.id)
    : undefined;

  useEffect(() => {
    if (target.tab !== "household" || !target.itemId) return;
    const focused = members.find((member) =>
      member.id === target.itemId
      || member.portions.some((portion) => portion.id === target.itemId));
    if (focused) {
      setDraftMember(cloneMember(focused));
      setEditingPortionId(
        focused.portions.some((portion) => portion.id === target.itemId)
          ? target.itemId
          : "",
      );
    }
  }, [members, target.itemId, target.tab]);

  const patchDraft = (patch: Partial<Member>) =>
    setDraftMember((current) => current ? { ...current, ...patch } : current);
  const patchPortion = (portionId: string, patch: Partial<IncomePortion>) =>
    setDraftMember((current) => current
      ? {
          ...current,
          portions: current.portions.map((portion) =>
            portion.id === portionId ? { ...portion, ...patch } : portion),
        }
      : current);
  const addPortion = (frequency: "monthly" | "one_off" = "monthly") => {
    const portion: IncomePortion = {
      id: uid("por"),
      label: frequency === "one_off" ? "Annual bonus" : "Income portion",
      amount: 0,
      currency,
      taxRate: 0,
      taxWithheld: true,
      window: null,
      schedule: frequency === "one_off"
        ? { frequency: "one_off", month: isoDateOf(new Date()).slice(0, 7) }
        : { frequency: "monthly" },
      budgetTreatment: frequency === "one_off" ? "protected" : "ordinary",
    };
    setDraftMember((current) => current
      ? { ...current, portions: [...current.portions, portion] }
      : current);
    setEditingPortionId(portion.id);
  };
  const removePortion = (portion: IncomePortion) => {
    if (!draftMember) return;
    const confirmationCount = data.incomeReceipts.filter(
      (receipt) =>
        receipt.memberId === draftMember.id
        && receipt.portionId === portion.id,
    ).length;
    requestConfirmation(
      "Delete income source?",
      confirmationCount
        ? `${portion.label || "This income source"} has ${confirmationCount} historical confirmation${confirmationCount === 1 ? "" : "s"}. It will be removed when you save this member.`
        : `${portion.label || "This income source"} will be removed when you save this member.`,
      "Delete income source",
      () => {
        setDraftMember((current) => current
          ? {
              ...current,
              portions: current.portions.filter((item) => item.id !== portion.id),
            }
          : current);
        if (editingPortionId === portion.id) setEditingPortionId("");
      },
    );
  };
  const openMember = (member: Member) => {
    setDraftMember(cloneMember(member));
    setEditingPortionId("");
  };
  const closeMember = () => {
    setDraftMember(null);
    setEditingPortionId("");
  };
  const beginNewMember = () => {
    setDraftMember({
      id: uid("mem"),
      name: "New member",
      color: nextMemberColor(members),
      portions: [],
    });
    setEditingPortionId("");
  };
  const saveMember = () => {
    if (!draftMember?.name.trim()) return;
    onUpdateMembers(originalMember
      ? members.map((member) => member.id === draftMember.id ? draftMember : member)
      : [...members, draftMember]);
    closeMember();
  };
  const removeMember = (member: Member) => {
    if (members.length <= 1 || memberHasReferences(data, member.id)) return;
    requestConfirmation(
      `Delete ${member.name || "member"}?`,
      "This unused profile has no financial references and will be removed.",
      "Delete unused profile",
      () => onUpdateMembers(members.filter((item) => item.id !== member.id)),
    );
  };
  const openLifecycle = (memberId: string) => {
    closeMember();
    setLifecycleMemberId(memberId);
  };

  if (!active) return null;
  return (
    <div
      className="settings-section"
      id="settings-panel-household"
      role="tabpanel"
      aria-labelledby="settings-tab-household"
    >
      <div className="section-title" id="settings-section-members">
        <div>
          <h3>Household members</h3>
          <p className="muted">
            Members and income stay compact until you open one profile to make changes.
          </p>
        </div>
        <Button variant="secondary" onClick={beginNewMember}>Add member</Button>
      </div>

      <div className="commitment-list" id="settings-section-income">
        {members.map((member, memberIndex) => {
          if (draftMember?.id === member.id) return null;
          return (
            <article
              className="fixed-cost-card"
              id={`settings-item-${member.id}`}
              key={member.id}
              style={{ "--member-color": member.color } as CSSProperties}
            >
              <header className="fixed-cost-card-header">
                <div className="income-member-title">
                  <span className="income-member-avatar" aria-hidden="true">
                    {member.name.trim().charAt(0).toUpperCase() || memberIndex + 1}
                  </span>
                  <div>
                    <span className="soft-label">
                      {memberLifecycleLabel(member, isoDateOf(new Date()))}
                    </span>
                    <strong>{member.name || "Unnamed member"}</strong>
                    <small>
                      {member.portions.length} income source
                      {member.portions.length === 1 ? "" : "s"}
                    </small>
                  </div>
                </div>
                <div className="income-member-actions">
                  <Button
                    variant="secondary"
                    onClick={() => openMember(member)}
                  >
                    Edit
                  </Button>
                  <Button variant="secondary" onClick={() => openLifecycle(member.id)}>
                    Change participation
                  </Button>
                  {members.length > 1 && !memberHasReferences(data, member.id) && (
                    <IconButton
                      label={`Delete ${member.name || "member"}`}
                      title="Delete unused profile"
                      icon={Trash2}
                      danger
                      onClick={() => removeMember(member)}
                    />
                  )}
                </div>
              </header>
              {member.portions.length > 0 && (
                <div className="rules-list" aria-label={`${member.name} income sources`}>
                  {member.portions.map((portion) => (
                    <div className="rule-row" key={portion.id}>
                      <span className="rule-merchant">{portion.label || "Untitled income"}</span>
                      <span>{depositSummary(portion)}</span>
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}

        {draftMember && (
          <article
            className="income-member"
            id={`settings-item-${draftMember.id}`}
            style={{ "--member-color": draftMember.color } as CSSProperties}
          >
            <div className="income-member-header">
              <div className="income-member-title">
                <span className="income-member-avatar" aria-hidden="true">
                  {draftMember.name.trim().charAt(0).toUpperCase() || members.length + 1}
                </span>
                <div>
                  <span className="income-profile-kicker">
                    {originalMember ? "Edit member and income" : "New member"}
                  </span>
                  <strong>{draftMember.name || "Unnamed member"}</strong>
                  <small>Changes are local until you save.</small>
                </div>
              </div>
              <div className="income-member-actions">
                <Button variant="primary" onClick={() => addPortion()}>
                  Add monthly deposit
                </Button>
                <Button variant="secondary" onClick={() => addPortion("one_off")}>
                  Add one-off income
                </Button>
              </div>
            </div>

            <div className="form-grid">
              <label className="field">
                <span>Member name</span>
                <input
                  autoFocus
                  aria-label={`${draftMember.name || "Member"} name`}
                  value={draftMember.name}
                  onChange={(event) => patchDraft({ name: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Colour</span>
                <input
                  aria-label={`${draftMember.name || "Member"} colour`}
                  type="color"
                  value={draftMember.color}
                  onChange={(event) => patchDraft({ color: event.target.value })}
                />
              </label>
            </div>

            <div className="income-deposit-list">
              {draftMember.portions.map((portion, portionIndex) => {
                if (editingPortionId !== portion.id) {
                  return (
                    <article
                      className="fixed-cost-card"
                      id={`settings-item-${portion.id}`}
                      key={portion.id}
                    >
                      <header className="fixed-cost-card-header">
                        <div>
                          <span className="soft-label">
                            {portion.schedule.frequency === "one_off"
                              ? "One-off income"
                              : `Deposit ${portionIndex + 1}`}
                          </span>
                          <strong>{portion.label.trim() || "Untitled income"}</strong>
                          <small>{depositSummary(portion)}</small>
                        </div>
                        <div className="income-member-actions">
                          <Button
                            variant="secondary"
                            onClick={() => setEditingPortionId(portion.id)}
                          >
                            Edit
                          </Button>
                          <IconButton
                            label={`Delete ${portion.label}`}
                            icon={Trash2}
                            danger
                            onClick={() => removePortion(portion)}
                            title="Delete deposit"
                          />
                        </div>
                      </header>
                    </article>
                  );
                }
                return (
                <section
                  className="income-deposit-card"
                  id={`settings-item-${portion.id}`}
                  key={portion.id}
                >
                  <div className="income-deposit-header">
                    <div>
                      <span className="income-deposit-number">
                        {portion.schedule.frequency === "one_off"
                          ? "One-off income"
                          : `Deposit ${portionIndex + 1}`}
                      </span>
                      <strong>{portion.label.trim() || "Untitled income"}</strong>
                    </div>
                    <IconButton
                      label={`Delete ${portion.label}`}
                      icon={Trash2}
                      danger
                      onClick={() => removePortion(portion)}
                      title="Delete deposit"
                    />
                  </div>

                  <label className="deposit-name-field">
                    <span>What should we call this deposit?</span>
                    <input
                      aria-label={`${draftMember.name} portion label`}
                      value={portion.label}
                      placeholder="e.g. Base salary or Variable allowance"
                      onChange={(event) => patchPortion(portion.id, {
                        label: event.target.value,
                      })}
                    />
                  </label>

                  <div
                    className="income-schedule-choices"
                    role="group"
                    aria-label={`${portion.label} schedule`}
                  >
                    <button
                      type="button"
                      className={portion.schedule.frequency === "monthly" ? "active" : ""}
                      aria-pressed={portion.schedule.frequency === "monthly"}
                      disabled={data.incomeReceipts.some(
                        (receipt) =>
                          receipt.memberId === draftMember.id
                          && receipt.portionId === portion.id,
                      )}
                      onClick={() => patchPortion(portion.id, {
                        schedule: { frequency: "monthly" },
                        budgetTreatment: "ordinary",
                      })}
                    >
                      <strong>Monthly</strong>
                      <small>Expected every month.</small>
                    </button>
                    <button
                      type="button"
                      className={portion.schedule.frequency === "one_off" ? "active" : ""}
                      aria-pressed={portion.schedule.frequency === "one_off"}
                      disabled={data.incomeReceipts.some(
                        (receipt) =>
                          receipt.memberId === draftMember.id
                          && receipt.portionId === portion.id,
                      )}
                      onClick={() => patchPortion(portion.id, {
                        schedule: {
                          frequency: "one_off",
                          month: isoDateOf(new Date()).slice(0, 7),
                        },
                        budgetTreatment: "protected",
                      })}
                    >
                      <strong>One-off</strong>
                      <small>Expected in one specific month.</small>
                    </button>
                  </div>
                  {data.incomeReceipts.some(
                    (receipt) =>
                      receipt.memberId === draftMember.id
                      && receipt.portionId === portion.id,
                  ) && (
                    <small className="income-schedule-lock">
                      Schedule locked after confirmation so historical income cannot move between months.
                    </small>
                  )}
                  {portion.schedule.frequency === "one_off" && (
                    <div className="one-off-settings-row">
                      <label className="field">
                        <span>Expected month</span>
                        <input
                          type="month"
                          value={portion.schedule.month}
                          disabled={data.incomeReceipts.some(
                            (receipt) =>
                              receipt.memberId === draftMember.id
                              && receipt.portionId === portion.id,
                          )}
                          onChange={(event) => event.target.value && patchPortion(
                            portion.id,
                            { schedule: { frequency: "one_off", month: event.target.value } },
                          )}
                        />
                      </label>
                      <label className="check-row">
                        <input
                          type="checkbox"
                          checked={portion.budgetTreatment === "protected"}
                          onChange={(event) => patchPortion(portion.id, {
                            budgetTreatment: event.target.checked ? "protected" : "ordinary",
                          })}
                        />
                        <span>
                          <strong>Protect from spending plan</strong>
                          <small>Does not increase the normal monthly allowance.</small>
                        </span>
                      </label>
                    </div>
                  )}

                  <div className="income-deposit-sections">
                    <div className="deposit-section">
                      <div className="deposit-section-heading">
                        <span>1</span>
                        <div>
                          <strong>What reaches the account?</strong>
                          <small>Enter the deposit amount, not the gross salary.</small>
                        </div>
                      </div>
                      <div className="deposit-money-fields">
                        <label>
                          <span>Amount</span>
                          <input
                            aria-label={`${portion.label} amount`}
                            type="number"
                            min="0"
                            value={portion.amount || ""}
                            placeholder="0"
                            onChange={(event) => patchPortion(portion.id, {
                              amount: Math.max(0, Number(event.target.value) || 0),
                            })}
                          />
                        </label>
                        <label>
                          <span>Currency</span>
                          <input
                            aria-label={`${portion.label} currency`}
                            list={currenciesId}
                            value={portion.currency}
                            placeholder={currency || "Currency"}
                            onChange={(event) => patchPortion(portion.id, {
                              currency: event.target.value.toUpperCase().trim(),
                            })}
                          />
                        </label>
                      </div>
                    </div>

                    <div className="deposit-section">
                      <div className="deposit-section-heading">
                        <span>2</span>
                        <div>
                          <strong>How is tax handled?</strong>
                          <small>This decides how much counts toward your save rate.</small>
                        </div>
                      </div>
                      <div
                        className="tax-treatment-choices"
                        role="group"
                        aria-label={`${portion.label} tax treatment`}
                      >
                        <button
                          type="button"
                          className={portion.taxWithheld ? "active" : ""}
                          aria-pressed={portion.taxWithheld}
                          onClick={() => patchPortion(portion.id, { taxWithheld: true })}
                        >
                          <strong>Already deducted</strong>
                          <small>The deposit is ready to use.</small>
                        </button>
                        <button
                          type="button"
                          className={!portion.taxWithheld ? "active" : ""}
                          aria-pressed={!portion.taxWithheld}
                          onClick={() => patchPortion(portion.id, { taxWithheld: false })}
                        >
                          <strong>I pay it later</strong>
                          <small>Mizan reserves tax first.</small>
                        </button>
                      </div>
                      <label className="deposit-tax-rate">
                        <span>Tax rate</span>
                        <div>
                          <input
                            aria-label={`${portion.label} tax rate`}
                            type="number"
                            min="0"
                            max="99.99"
                            value={portion.taxRate || ""}
                            placeholder="0"
                            onChange={(event) => patchPortion(portion.id, {
                              taxRate: Math.max(
                                0,
                                Math.min(99.99, Number(event.target.value) || 0),
                              ),
                            })}
                          />
                          <b>%</b>
                        </div>
                      </label>
                    </div>

                    <div className="deposit-section deposit-timing-section">
                      <div className="deposit-section-heading">
                        <span>3</span>
                        <div>
                          <strong>When does it arrive?</strong>
                          <small>Leave blank if the timing is unknown.</small>
                        </div>
                      </div>
                      <div className="arrival-inputs">
                        <label>
                          <span>From day</span>
                          <input
                            aria-label={`${portion.label} arrival start day`}
                            type="number"
                            min="1"
                            max="31"
                            placeholder="e.g. 10"
                            value={portion.window?.startDay ?? ""}
                            onChange={(event) => {
                              const raw = Number(event.target.value);
                              const startDay = raw ? Math.max(1, Math.min(31, raw)) : 0;
                              patchPortion(portion.id, {
                                window: startDay
                                  ? {
                                      startDay,
                                      endDay: portion.window?.endDay ?? startDay,
                                    }
                                  : null,
                              });
                            }}
                          />
                        </label>
                        <span>to</span>
                        <label>
                          <span>To day</span>
                          <input
                            aria-label={`${portion.label} arrival end day`}
                            type="number"
                            min="1"
                            max="31"
                            placeholder="e.g. 15"
                            value={portion.window?.endDay ?? ""}
                            onChange={(event) => {
                              const raw = Number(event.target.value);
                              const endDay = raw ? Math.max(1, Math.min(31, raw)) : 0;
                              patchPortion(portion.id, {
                                window: endDay
                                  ? {
                                      startDay: portion.window?.startDay ?? endDay,
                                      endDay,
                                    }
                                  : null,
                              });
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                </section>
                );
              })}
              {!draftMember.portions.length && (
                <div className="income-deposit-empty">
                  <strong>No deposits yet</strong>
                  <p>Add regular salary or planned one-off income.</p>
                  <Button variant="primary" onClick={() => addPortion()}>
                    Add first deposit
                  </Button>
                </div>
              )}
            </div>

            <datalist id={currenciesId}>
              {COMMON_CURRENCIES.map((code) => <option key={code} value={code} />)}
            </datalist>
            <div className="modal-actions">
              {originalMember && (
                <Button variant="secondary" onClick={() => openLifecycle(originalMember.id)}>
                  Change participation
                </Button>
              )}
              <Button variant="secondary" onClick={closeMember}>Cancel</Button>
              <Button
                variant="primary"
                disabled={!draftMember.name.trim()}
                onClick={saveMember}
              >
                Save member
              </Button>
            </div>
          </article>
        )}
      </div>

      {lifecycleMemberId && members.find((member) => member.id === lifecycleMemberId) && (
        <MemberLifecycleDialog
          member={members.find((member) => member.id === lifecycleMemberId)!}
          onClose={() => setLifecycleMemberId("")}
          onSave={(nextMember, accountArchiveOn, accountRestoreFrom) => {
            onUpdateMembers(
              members.map((member) => member.id === nextMember.id ? nextMember : member),
            );
            if (accountArchiveOn) {
              onUpdateAccounts(data.accounts.map((account) =>
                account.owner === nextMember.id
                && (!account.inactiveFrom || account.inactiveFrom > accountArchiveOn)
                  ? { ...account, inactiveFrom: accountArchiveOn }
                  : account));
            } else if (accountRestoreFrom) {
              onUpdateAccounts(data.accounts.map((account) =>
                account.owner === nextMember.id
                && account.inactiveFrom === accountRestoreFrom
                  ? { ...account, inactiveFrom: undefined }
                  : account));
            }
          }}
        />
      )}
    </div>
  );
}
