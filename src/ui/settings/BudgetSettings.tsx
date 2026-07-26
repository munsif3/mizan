import { useEffect, useMemo, useState } from "react";
import type { SettingsTab, SettingsTarget } from "../../app/settingsTarget";
import { transitionFixedCosts } from "../../domain/appDataTransitions";
import { categoryOptions } from "../../domain/categories";
import { commitmentPaidAmount } from "../../domain/commitments";
import { movementInfo } from "../../domain/movements";
import {
  uid,
  type AppData,
  type CategoryKey,
  type FixedCost,
  type FixedCostKind,
  type SpendBeneficiary,
} from "../../domain/types";
import { Button } from "../bits";
import { changedTransactions, type RequestConfirmation } from "./shared";

export interface BudgetSettingsProps {
  active: boolean;
  data: AppData;
  target: SettingsTarget;
  assetFeatureActive: boolean;
  onUpdateTarget: (targetSaveRate: number) => void;
  onUpdateCurrency: (currency: string, locale: string) => void;
  onUpdateFxRates: (fxRates: Record<string, number>) => void;
  onUpdateFixedCosts: (fixedCosts: FixedCost[]) => void;
  onOpenTab: (tab: SettingsTab) => void;
  requestConfirmation: RequestConfirmation;
}

function beneficiaryValue(beneficiary: SpendBeneficiary): string {
  return beneficiary.type === "member" ? `member:${beneficiary.memberId}` : beneficiary.type;
}

function beneficiaryFromValue(value: string): SpendBeneficiary {
  if (value.startsWith("member:")) {
    return { type: "member", memberId: value.slice("member:".length) };
  }
  return value === "household" ? { type: "household" } : { type: "unassigned" };
}

function looksLikeLoanCommitment(label: string): boolean {
  return /\b(?:loan|mortgage|debt)\b/i.test(label);
}

export function BudgetSettings({
  active,
  data,
  target,
  assetFeatureActive,
  onUpdateTarget,
  onUpdateCurrency,
  onUpdateFxRates,
  onUpdateFixedCosts,
  onOpenTab,
  requestConfirmation,
}: BudgetSettingsProps) {
  const {
    currency,
    locale,
    fxRates,
    members,
    customCategories,
  } = data.settings;
  const fixedCosts = data.fixedCosts;
  const categoryChoices = categoryOptions(customCategories);
  const foreignCurrencies = [...new Set(
    members.flatMap((member) =>
      member.portions.map((portion) => portion.currency.trim().toUpperCase())),
  )]
    .filter((code) => code && code !== currency.trim().toUpperCase())
    .sort();
  const [draft, setDraft] = useState<FixedCost | null>(null);
  const original = draft ? fixedCosts.find((item) => item.id === draft.id) : undefined;
  const pendingFixedCosts = useMemo(() => {
    if (!draft) return fixedCosts;
    return original
      ? fixedCosts.map((item) => item.id === draft.id ? draft : item)
      : [...fixedCosts, draft];
  }, [draft, fixedCosts, original]);
  const affectedTransactions = useMemo(
    () => draft
      ? changedTransactions(data.transactions, transitionFixedCosts(data, pendingFixedCosts).transactions)
      : [],
    [data, draft, pendingFixedCosts],
  );

  useEffect(() => {
    if (target.tab !== "budget" || !target.itemId) return;
    const focused = fixedCosts.find((item) => item.id === target.itemId);
    if (focused) setDraft(focused);
  }, [fixedCosts, target.itemId, target.tab]);

  const editCommitment = (fixed: FixedCost) => setDraft({ ...fixed });
  const patchDraft = (patch: Partial<FixedCost>) =>
    setDraft((current) => current ? { ...current, ...patch } : current);
  const saveDraft = () => {
    if (!draft) return;
    const apply = () => {
      onUpdateFixedCosts(pendingFixedCosts);
      setDraft(null);
    };
    const matcherChanged = JSON.stringify(original?.merchantMatch ?? [])
      !== JSON.stringify(draft.merchantMatch ?? []);
    if (!matcherChanged) {
      apply();
      return;
    }
    const examples = affectedTransactions
      .slice(0, 3)
      .map((transaction) => transaction.description)
      .join(", ");
    requestConfirmation(
      "Apply imported payment match?",
      affectedTransactions.length
        ? `${affectedTransactions.length} existing transaction${affectedTransactions.length === 1 ? "" : "s"} will change: ${examples}${affectedTransactions.length > 3 ? ", and more" : ""}.`
        : "No existing transactions match this text. Future imported payments may be classified by it.",
      "Apply match",
      apply,
    );
  };
  const beginNewCommitment = () => {
    const soleMember = members.length === 1 ? members[0] : undefined;
    setDraft({
      id: uid("fixed"),
      label: "",
      amount: 0,
      kind: "expense",
      category: "housing",
      beneficiary: soleMember
        ? { type: "member", memberId: soleMember.id }
        : { type: "household" },
    });
  };

  if (!active) return null;
  return (
    <>
      <div className="settings-section" id="settings-panel-budget" role="tabpanel" aria-labelledby="settings-tab-budget">
        <div id="settings-section-currency">
          <h3>Currency & savings target</h3>
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
          <details>
            <summary>Regional formatting</summary>
            <label className="field">
              <span>Locale</span>
              <input
                value={locale}
                placeholder="e.g. en-US"
                onChange={(event) => onUpdateCurrency(currency, event.target.value.trim())}
              />
            </label>
          </details>
        </div>
      </div>

      {foreignCurrencies.length > 0 && (
        <div className="settings-section" id="settings-section-exchange-rates">
          <h3>Exchange rates</h3>
          <p className="muted">
            Used to project expected foreign-currency deposits. Confirmed actuals are always stored in {currency}.
          </p>
          <div className="fx-rate-list">
            {foreignCurrencies.map((code) => {
              const missing = !(Number(fxRates[code]) > 0);
              return (
                <label className={`field ${missing ? "missing-rate" : ""}`} key={code}>
                  <span>1 {code} =</span>
                  <input
                    aria-label={`${code} exchange rate`}
                    type="number"
                    min="0"
                    step="any"
                    placeholder="Rate required"
                    value={fxRates[code] || ""}
                    onChange={(event) => {
                      const rate = Number(event.target.value);
                      const next = { ...fxRates };
                      if (rate > 0) next[code] = rate;
                      else delete next[code];
                      onUpdateFxRates(next);
                    }}
                  />
                  <b>{currency}</b>
                </label>
              );
            })}
          </div>
        </div>
      )}

      <div className="settings-section" id="settings-section-commitments">
        <div className="section-title">
          <div>
            <h3>Recurring commitments</h3>
            <p className="muted">Keep the monthly plan compact. Open one commitment when it needs attention.</p>
          </div>
          <Button variant="secondary" onClick={beginNewCommitment}>Add commitment</Button>
        </div>
        {!fixedCosts.length && !draft && <p className="muted empty-commitments">No recurring commitments yet.</p>}
        <div className="commitment-list">
          {fixedCosts.map((fixed) => (
            <article className="fixed-cost-card" id={`settings-item-${fixed.id}`} key={fixed.id}>
              <header className="fixed-cost-card-header">
                <div>
                  <span className="soft-label">{movementInfo(fixed.kind).label}</span>
                  <strong>{fixed.label.trim() || "Untitled commitment"}</strong>
                  <small>{fixed.amount.toLocaleString()} {currency} / month</small>
                </div>
                <Button variant="secondary" onClick={() => editCommitment(fixed)}>
                  {draft?.id === fixed.id ? "Editing" : "Edit"}
                </Button>
              </header>
              {(fixed.totalAmount || fixed.merchantMatch?.length) && (
                <small>
                  {fixed.totalAmount
                    ? `${Math.min(fixed.totalAmount, commitmentPaidAmount(data.transactions, fixed)).toLocaleString()} of ${fixed.totalAmount.toLocaleString()} posted`
                    : "Imported payment matching is on"}
                </small>
              )}
            </article>
          ))}
          {draft && (
            <article className="fixed-cost-card" id={`settings-item-${draft.id}`}>
              <header className="fixed-cost-card-header">
                <div>
                  <span className="soft-label">{original ? "Edit commitment" : "New commitment"}</span>
                  <strong>{draft.label.trim() || "Untitled commitment"}</strong>
                </div>
              </header>
              <div className="fixed-cost-grid">
                <label className="field">
                  <span>Commitment name</span>
                  <input
                    autoFocus
                    aria-label="Commitment name"
                    value={draft.label}
                    onChange={(event) => patchDraft({ label: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Monthly amount</span>
                  <input
                    aria-label={`Amount for ${draft.label || "commitment"}`}
                    type="number"
                    min="0"
                    value={draft.amount || ""}
                    onChange={(event) => patchDraft({ amount: Math.max(0, Number(event.target.value) || 0) })}
                  />
                </label>
                <label className="field">
                  <span>Payment type</span>
                  <select
                    aria-label={`Payment type for ${draft.label || "commitment"}`}
                    value={draft.kind}
                    onChange={(event) => patchDraft({ kind: event.target.value as FixedCostKind })}
                  >
                    <option value="expense">Bill / regular expense</option>
                    <option value="loan_payment">Loan / debt payment</option>
                    <option value="investment_transfer">Investment contribution</option>
                  </select>
                </label>
                {draft.kind !== "investment_transfer" && (
                  <label className="field">
                    <span>Purpose</span>
                    <select
                      aria-label={`Purpose for ${draft.label || "commitment"}`}
                      value={draft.category}
                      onChange={(event) => patchDraft({ category: event.target.value as CategoryKey })}
                    >
                      {categoryChoices.map((option) => (
                        <option key={option.key} value={option.key}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                )}
                {draft.kind !== "investment_transfer" && members.length > 1 && (
                  <label className="field">
                    <span>Who it was for</span>
                    <select
                      aria-label={`Who ${draft.label || "commitment"} is for`}
                      value={beneficiaryValue(draft.beneficiary)}
                      onChange={(event) => patchDraft({ beneficiary: beneficiaryFromValue(event.target.value) })}
                    >
                      <option value="household">Household</option>
                      {members.map((member) => (
                        <option key={member.id} value={`member:${member.id}`}>{member.name}</option>
                      ))}
                      <option value="unassigned">Unassigned</option>
                    </select>
                  </label>
                )}
              </div>

              <details open={Boolean(draft.merchantMatch?.length || draft.totalAmount || draft.holdingId)}>
                <summary>Match imported payments</summary>
                <p className="muted">
                  Set dates, totals, statement text, and any investment link together. Nothing changes until you save.
                </p>
                <div className="fixed-cost-grid">
                  <label className="field">
                    <span>First month</span>
                    <input
                      aria-label={`First month for ${draft.label || "commitment"}`}
                      type="month"
                      value={draft.from ?? ""}
                      onChange={(event) => patchDraft({ from: event.target.value || undefined })}
                    />
                  </label>
                  <label className="field">
                    <span>Final month</span>
                    <input
                      aria-label={`Last month for ${draft.label || "commitment"}`}
                      type="month"
                      value={draft.until ?? ""}
                      onChange={(event) => patchDraft({ until: event.target.value || undefined })}
                    />
                  </label>
                  <label className="field">
                    <span>Contract / hold total</span>
                    <input
                      aria-label={`Contract total for ${draft.label || "commitment"}`}
                      type="number"
                      min="0"
                      value={draft.totalAmount ?? ""}
                      onChange={(event) => patchDraft({
                        totalAmount: event.target.value
                          ? Math.max(0, Number(event.target.value) || 0)
                          : undefined,
                      })}
                    />
                  </label>
                  <label className="field">
                    <span>Statement text</span>
                    <input
                      aria-label={`Merchant match for ${draft.label || "commitment"}`}
                      placeholder="e.g. UNION ASSURANCE LIMITED INST"
                      value={(draft.merchantMatch ?? []).join(", ")}
                      onChange={(event) => patchDraft({
                        merchantMatch: event.target.value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      })}
                    />
                  </label>
                  <label className={`field ${draft.kind === "investment_transfer" && !draft.holdingId ? "missing-rate" : ""}`}>
                    <span>Holding</span>
                    <select
                      aria-label={`Asset holding for ${draft.label || "commitment"}`}
                      value={draft.holdingId ?? ""}
                      onChange={(event) => patchDraft({
                        holdingId: event.target.value || undefined,
                        ...(!event.target.value ? { investmentAmount: undefined } : {}),
                      })}
                    >
                      <option value="">
                        {draft.kind === "investment_transfer" ? "Choose holding" : "No investment portion"}
                      </option>
                      {data.assetHoldings
                        .filter((holding) => holding.status !== "closed")
                        .map((holding) => (
                          <option value={holding.id} key={holding.id}>{holding.label}</option>
                        ))}
                    </select>
                  </label>
                  {draft.kind !== "investment_transfer" && draft.holdingId && (
                    <label className="field">
                      <span>Investment amount per payment</span>
                      <input
                        aria-label={`Investment portion for ${draft.label || "commitment"}`}
                        type="number"
                        min="0"
                        max={draft.amount}
                        value={draft.investmentAmount ?? ""}
                        onChange={(event) => patchDraft({
                          investmentAmount: event.target.value
                            ? Math.min(draft.amount, Math.max(0, Number(event.target.value) || 0))
                            : undefined,
                        })}
                      />
                    </label>
                  )}
                </div>
              </details>

              <div className="fixed-purpose-guidance" role="status">
                <div>
                  <strong>
                    {affectedTransactions.length} ledger row{affectedTransactions.length === 1 ? "" : "s"} will change
                  </strong>
                  <span>
                    {affectedTransactions.length
                      ? affectedTransactions.slice(0, 3).map((transaction) => transaction.description).join(", ")
                      : "No current transactions are affected by this draft."}
                  </span>
                </div>
              </div>
              {draft.kind === "expense" && looksLikeLoanCommitment(draft.label) && (
                <div className="fixed-purpose-guidance" role="note">
                  <div>
                    <strong>This name looks like a loan.</strong>
                    <span>Confirm the payment type while keeping its purpose separate.</span>
                  </div>
                  <button className="link-button" onClick={() => patchDraft({ kind: "loan_payment" })}>
                    Mark as loan / debt
                  </button>
                </div>
              )}
              {draft.kind === "loan_payment" && (
                <div className="fixed-purpose-guidance" role="note">
                  <div>
                    <strong>Purpose stays separate from the loan.</strong>
                    <span>For example, a car loan can still use Transport as its purpose.</span>
                  </div>
                  <button className="link-button" onClick={() => onOpenTab("categories")}>
                    Manage custom purposes
                  </button>
                </div>
              )}
              {draft.kind === "investment_transfer" && !draft.holdingId && (
                <button className="link-button" onClick={() => onOpenTab("assets")}>
                  Create or choose a holding
                </button>
              )}
              <div className="modal-actions">
                {original && (
                  <Button
                    variant="danger"
                    onClick={() => requestConfirmation(
                      "Delete commitment?",
                      `${original.label || "This commitment"} will be removed. Existing linked payments will be returned to their normal classification.`,
                      "Delete commitment",
                      () => {
                        onUpdateFixedCosts(fixedCosts.filter((item) => item.id !== original.id));
                        setDraft(null);
                      },
                    )}
                  >
                    Delete
                  </Button>
                )}
                <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
                <Button variant="primary" disabled={!draft.label.trim()} onClick={saveDraft}>
                  Save commitment
                </Button>
              </div>
            </article>
          )}
        </div>
      </div>

      {!assetFeatureActive && (
        <details className="settings-section">
          <summary>Optional tools</summary>
          <p className="muted">Asset and investment tracking stays hidden until you choose to use it.</p>
          <Button variant="secondary" onClick={() => onOpenTab("assets")}>
            Track assets and investments
          </Button>
        </details>
      )}
    </>
  );
}
