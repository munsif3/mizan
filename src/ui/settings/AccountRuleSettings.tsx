import { useEffect, useMemo, useState } from "react";
import type { SettingsTarget } from "../../app/settingsTarget";
import { transitionAccounts } from "../../domain/appDataTransitions";
import { categoryOptions } from "../../domain/categories";
import { isoDateOf } from "../../domain/dates";
import { movementInfo } from "../../domain/movements";
import {
  uid,
  type Account,
  type AppData,
  type CategoryKey,
  type MerchantRule,
  type MovementKind,
} from "../../domain/types";
import { Button } from "../bits";
import { COMMON_CURRENCIES } from "../currencies";
import {
  RuleFields,
  ruleBeneficiaryValue,
  ruleFromControls,
  type RuleBeneficiaryValue,
} from "../ruleFields";
import { changedTransactions, type RequestConfirmation } from "./shared";

export interface AccountRuleSettingsProps {
  active: boolean;
  data: AppData;
  target: SettingsTarget;
  currentUserUid?: string;
  onUpdateAccounts: (accounts: Account[]) => void;
  onUpsertRule: (merchant: string, rule: MerchantRule) => void;
  onDeleteRules: (merchants: string[]) => void;
  requestConfirmation: RequestConfirmation;
}

export function AccountRuleSettings({
  active,
  data,
  target,
  currentUserUid,
  onUpdateAccounts,
  onUpsertRule,
  onDeleteRules,
  requestConfirmation,
}: AccountRuleSettingsProps) {
  const {
    members,
    currency,
    counterparties,
    customCategories,
  } = data.settings;
  const assetHoldings = data.assetHoldings;
  const categoryChoices = categoryOptions(customCategories);
  const solo = members.length === 1;
  const [accountDraft, setAccountDraft] = useState<Account | null>(null);
  const [ruleDraft, setRuleDraft] = useState<{ merchant: string; rule: MerchantRule } | null>(null);
  const [selectedRules, setSelectedRules] = useState<string[]>([]);
  const ruleEntries = Object.entries(data.merchantRules);
  const originalAccount = accountDraft
    ? data.accounts.find((account) => account.id === accountDraft.id)
    : undefined;
  const pendingAccounts = useMemo(() => {
    if (!accountDraft) return data.accounts;
    return originalAccount
      ? data.accounts.map((account) => account.id === accountDraft.id ? accountDraft : account)
      : [...data.accounts, accountDraft];
  }, [accountDraft, data.accounts, originalAccount]);
  const affectedAccountRows = useMemo(
    () => accountDraft
      ? changedTransactions(
          data.transactions,
          transitionAccounts(data, pendingAccounts).transactions,
        )
      : [],
    [accountDraft, data, pendingAccounts],
  );

  useEffect(() => {
    if (target.tab !== "accounts" || !target.itemId) return;
    const focused = data.accounts.find((account) => account.id === target.itemId);
    if (focused) setAccountDraft({ ...focused, match: [...focused.match] });
  }, [data.accounts, target.itemId, target.tab]);

  const saveAccount = () => {
    if (!accountDraft) return;
    const apply = () => {
      onUpdateAccounts(pendingAccounts);
      setAccountDraft(null);
    };
    const matcherChanged = JSON.stringify(originalAccount?.match ?? [])
      !== JSON.stringify(accountDraft.match);
    if (!matcherChanged) {
      apply();
      return;
    }
    const examples = affectedAccountRows
      .slice(0, 3)
      .map((transaction) => transaction.description)
      .join(", ");
    requestConfirmation(
      "Apply account match?",
      affectedAccountRows.length
        ? `${affectedAccountRows.length} existing transaction${affectedAccountRows.length === 1 ? "" : "s"} will change: ${examples}${affectedAccountRows.length > 3 ? ", and more" : ""}.`
        : "No existing transactions match this text. Future imports may be assigned to this account.",
      "Apply match",
      apply,
    );
  };
  const selected = ruleEntries
    .filter(([merchant]) => selectedRules.includes(merchant))
    .map(([merchant]) => merchant);
  const patchRuleDraft = (patch: Partial<{
    kind: MovementKind;
    category: CategoryKey;
    beneficiary: RuleBeneficiaryValue;
    counterpartyId: string;
    holdingId: string;
  }>) => setRuleDraft((current) => current
    ? {
        ...current,
        rule: ruleFromControls(
          patch.kind ?? current.rule.kind,
          patch.category ?? current.rule.category,
          patch.beneficiary ?? ruleBeneficiaryValue(current.rule.beneficiary),
          patch.counterpartyId ?? current.rule.counterpartyId ?? "",
          solo,
          "holdingId" in patch ? patch.holdingId : current.rule.holdingId,
        ),
      }
    : current);
  const toggleRule = (merchant: string, checked: boolean) =>
    setSelectedRules((previous) => checked
      ? [...previous, merchant]
      : previous.filter((item) => item !== merchant));
  const deleteSelected = () => requestConfirmation(
    selected.length === 1 ? "Delete merchant rule?" : `Delete ${selected.length} merchant rules?`,
    `${selected.length === 1 ? `${selected[0]} transactions` : "Transactions controlled by these rules"} will return to the review queue or the next matching fallback rule.`,
    selected.length === 1 ? "Delete rule" : `Delete ${selected.length} rules`,
    () => {
      onDeleteRules(selected);
      setSelectedRules([]);
    },
  );

  if (!active) return null;
  return (
    <>
      <div className="settings-section" id="settings-panel-accounts" role="tabpanel" aria-labelledby="settings-tab-accounts">
        <div id="settings-section-accounts">
          <div className="section-title">
            <div>
              <h3>Accounts</h3>
              <p className="muted">
                Open one account to change its name, defaults, freshness, or imported statement match.
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => setAccountDraft({
                id: uid("acc"),
                label: "",
                currency,
                owner: solo ? members[0]!.id : "unassigned",
                beneficiaryDefault: solo ? "owner" : "review",
                match: [],
              })}
            >
              Add account
            </Button>
          </div>
          {data.accounts.length > 0 && (
            <div className="commitment-list" role="list" aria-label="Accounts">
              {data.accounts.map((account) => (
                <article className="fixed-cost-card" id={`settings-item-${account.id}`} key={account.id}>
                  <header className="fixed-cost-card-header">
                    <div>
                      <span className="soft-label">{account.currency || currency}</span>
                      <strong>{account.label || "Untitled account"}</strong>
                      <small>
                        {account.coverage?.throughDate
                          ? `Updated through ${account.coverage.throughDate}`
                          : "Freshness not confirmed"}
                        {account.match.length
                          ? ` · ${account.match.length} statement match${account.match.length === 1 ? "" : "es"}`
                          : ""}
                      </small>
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => setAccountDraft({ ...account, match: [...account.match] })}
                    >
                      {accountDraft?.id === account.id ? "Editing" : "Edit"}
                    </Button>
                  </header>
                </article>
              ))}
            </div>
          )}
          {accountDraft && (
            <article className="fixed-cost-card" id={`settings-item-${accountDraft.id}`}>
              <header className="fixed-cost-card-header">
                <div>
                  <span className="soft-label">{originalAccount ? "Edit account" : "New account"}</span>
                  <strong>{accountDraft.label || "Untitled account"}</strong>
                </div>
              </header>
              <div className="fixed-cost-grid">
                <label className="field">
                  <span>Account name</span>
                  <input
                    autoFocus
                    aria-label={`${accountDraft.label || "Account"} label`}
                    value={accountDraft.label}
                    placeholder="Account name"
                    onChange={(event) => setAccountDraft({
                      ...accountDraft,
                      label: event.target.value,
                    })}
                  />
                </label>
                {!solo && (
                  <label className="field">
                    <span>Paid from</span>
                    <select
                      aria-label={`${accountDraft.label || "Account"} paid from`}
                      value={accountDraft.owner}
                      onChange={(event) => setAccountDraft({
                        ...accountDraft,
                        owner: event.target.value,
                      })}
                    >
                      {members.map((member) => (
                        <option key={member.id} value={member.id}>{member.name}</option>
                      ))}
                      <option value="joint">Joint</option>
                      <option value="unassigned">Needs review</option>
                    </select>
                  </label>
                )}
                {!solo && (
                  <label className="field">
                    <span>Who it is usually for</span>
                    <select
                      aria-label={`${accountDraft.label || "Account"} usually for`}
                      value={accountDraft.beneficiaryDefault}
                      onChange={(event) => setAccountDraft({
                        ...accountDraft,
                        beneficiaryDefault: event.target.value as Account["beneficiaryDefault"],
                      })}
                    >
                      <option
                        value="owner"
                        disabled={accountDraft.owner === "joint" || accountDraft.owner === "unassigned"}
                      >
                        Account owner
                      </option>
                      <option value="household">Household</option>
                      <option value="review">Always review</option>
                    </select>
                  </label>
                )}
                <label className="field">
                  <span>Currency</span>
                  <input
                    aria-label={`${accountDraft.label || "Account"} currency`}
                    list="account-currencies"
                    value={accountDraft.currency || currency}
                    placeholder={currency || "Currency"}
                    onChange={(event) => setAccountDraft({
                      ...accountDraft,
                      currency: event.target.value.toUpperCase().trim(),
                    })}
                  />
                </label>
                <label className="field">
                  <span>Updated through</span>
                  <input
                    aria-label={`${accountDraft.label || "Account"} updated through`}
                    type="date"
                    max={isoDateOf(new Date())}
                    value={accountDraft.coverage?.throughDate ?? ""}
                    onChange={(event) => setAccountDraft({
                      ...accountDraft,
                      coverage: event.target.value && currentUserUid
                        ? {
                            throughDate: event.target.value,
                            confirmedAt: new Date().toISOString(),
                            confirmedByUid: currentUserUid,
                            source: "manual",
                          }
                        : undefined,
                    })}
                  />
                </label>
              </div>
              <details open={Boolean(accountDraft.match.length)}>
                <summary>Match imported payments</summary>
                <label className="field">
                  <span>Statement account text</span>
                  <input
                    aria-label={`${accountDraft.label || "Account"} statement match text`}
                    value={accountDraft.match.join(", ")}
                    placeholder="e.g. 37xx 1234, amex"
                    onChange={(event) => setAccountDraft({
                      ...accountDraft,
                      match: event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    })}
                  />
                </label>
              </details>
              <div className="fixed-purpose-guidance" role="status">
                <div>
                  <strong>
                    {affectedAccountRows.length} ledger row{affectedAccountRows.length === 1 ? "" : "s"} will change
                  </strong>
                  <span>
                    {affectedAccountRows.length
                      ? affectedAccountRows.slice(0, 3).map((transaction) => transaction.description).join(", ")
                      : "No current transactions are affected by this draft."}
                  </span>
                </div>
              </div>
              <div className="modal-actions">
                {originalAccount && (
                  <Button
                    variant="danger"
                    onClick={() => requestConfirmation(
                      "Delete account?",
                      `${originalAccount.label || "This account"} will be removed from matching. Linked rows return to their imported account text.`,
                      "Delete account",
                      () => {
                        onUpdateAccounts(
                          data.accounts.filter((item) => item.id !== originalAccount.id),
                        );
                        setAccountDraft(null);
                      },
                    )}
                  >
                    Delete
                  </Button>
                )}
                <Button variant="secondary" onClick={() => setAccountDraft(null)}>Cancel</Button>
                <Button
                  variant="primary"
                  disabled={!accountDraft.label.trim()}
                  onClick={saveAccount}
                >
                  Save account
                </Button>
              </div>
            </article>
          )}
          <datalist id="account-currencies">
            {COMMON_CURRENCIES.map((code) => <option key={code} value={code} />)}
          </datalist>
          {!data.accounts.length && (
            <p className="muted">
              No accounts yet. They also appear automatically when you import data.
            </p>
          )}
        </div>
      </div>

      <div className="settings-section" id="settings-section-rules">
        <h3>Merchant rules</h3>
        <p className="muted">
          Edit how a merchant is classified and it re-applies to every unlocked transaction.
          Deleting a rule returns the transactions it controlled to the review queue (or to the
          next matching fallback rule).
        </p>
        {ruleEntries.length > 0 && (
          <div className="rules-bulk">
            <label className="checkbox-row">
              <input
                type="checkbox"
                aria-label="Select all merchant rules"
                checked={selected.length === ruleEntries.length}
                ref={(node) => {
                  if (node) {
                    node.indeterminate = selected.length > 0
                      && selected.length < ruleEntries.length;
                  }
                }}
                onChange={(event) => setSelectedRules(
                  event.target.checked
                    ? ruleEntries.map(([merchant]) => merchant)
                    : [],
                )}
              />
              <span>{selected.length ? `${selected.length} selected` : "Select all"}</span>
            </label>
            <Button variant="danger" disabled={!selected.length} onClick={deleteSelected}>
              Delete selected
            </Button>
          </div>
        )}
        <div className="rules-list">
          {ruleEntries.map(([merchant, rule]) => (
            <div className="rule-row" id={`settings-item-${merchant}`} key={merchant}>
              <input
                type="checkbox"
                aria-label={`Select merchant rule for ${merchant}`}
                checked={selected.includes(merchant)}
                onChange={(event) => toggleRule(merchant, event.target.checked)}
              />
              <span className="rule-merchant" title={merchant}>{merchant}</span>
              <span>
                {movementInfo(rule.kind).label} ·{" "}
                {categoryChoices.find((option) => option.key === rule.category)?.label
                  ?? "Uncategorized"}
              </span>
              <Button
                variant="secondary"
                onClick={() => setRuleDraft({ merchant, rule: { ...rule } })}
              >
                {ruleDraft?.merchant === merchant ? "Editing" : "Edit"}
              </Button>
            </div>
          ))}
          {!ruleEntries.length && (
            <p className="muted">
              Rules appear when you categorize merchants in the review queue or the transactions table.
            </p>
          )}
        </div>
        {ruleDraft && (
          <article className="fixed-cost-card">
            <header className="fixed-cost-card-header">
              <div>
                <span className="soft-label">Merchant rule</span>
                <strong>{ruleDraft.merchant}</strong>
              </div>
            </header>
            <RuleFields
              context={ruleDraft.merchant}
              kind={ruleDraft.rule.kind}
              category={ruleDraft.rule.category}
              beneficiary={ruleBeneficiaryValue(ruleDraft.rule.beneficiary)}
              counterpartyId={ruleDraft.rule.counterpartyId ?? ""}
              members={members}
              counterparties={counterparties}
              assetHoldings={assetHoldings}
              customCategories={customCategories}
              solo={solo}
              categoryLabel="Purpose"
              beneficiaryLabel="Who it was for"
              onKind={(kind) => patchRuleDraft({ kind })}
              onCategory={(category) => patchRuleDraft({ category })}
              onBeneficiary={(beneficiary) => patchRuleDraft({ beneficiary })}
              onCounterparty={(counterpartyId) => patchRuleDraft({ counterpartyId })}
              holdingId={ruleDraft.rule.holdingId ?? ""}
              onHolding={(holdingId) => patchRuleDraft({ holdingId })}
            />
            <div className="modal-actions">
              <Button
                variant="danger"
                onClick={() => requestConfirmation(
                  "Delete merchant rule?",
                  `${ruleDraft.merchant} transactions will return to the review queue or the next matching fallback rule.`,
                  "Delete rule",
                  () => {
                    onDeleteRules([ruleDraft.merchant]);
                    setRuleDraft(null);
                  },
                )}
              >
                Delete
              </Button>
              <Button variant="secondary" onClick={() => setRuleDraft(null)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => {
                  onUpsertRule(ruleDraft.merchant, ruleDraft.rule);
                  setRuleDraft(null);
                }}
              >
                Save rule
              </Button>
            </div>
          </article>
        )}
      </div>
    </>
  );
}
