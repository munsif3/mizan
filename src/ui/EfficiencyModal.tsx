import { useMemo, useState } from "react";
import { addMonths, monthLabel } from "../domain/dates";
import type { EfficiencyPlanInput } from "../domain/efficiency";
import type {
  ChangeEffort,
  EfficiencyAction,
  EfficiencyOpportunity,
  EfficiencyOutcomeResult,
  EfficiencyPlan,
  LifeValue,
} from "../domain/types";
import { Modal } from "./bits";

const VALUE_OPTIONS: Array<{ value: LifeValue; label: string; detail: string }> = [
  { value: "essential", label: "Essential", detail: "Protect this cost unless its price or use changes materially." },
  { value: "worthwhile", label: "Worth it", detail: "Keep the benefit, while remaining open to a cheaper route." },
  { value: "questionable", label: "Questionable", detail: "The cost may no longer justify the value it provides." },
];

const ACTION_OPTIONS: Array<{ value: EfficiencyAction; label: string }> = [
  { value: "keep", label: "Keep" },
  { value: "reduce", label: "Reduce" },
  { value: "replace", label: "Replace" },
  { value: "stop", label: "Stop" },
];

const EFFORT_OPTIONS: Array<{ value: ChangeEffort; label: string }> = [
  { value: "easy", label: "Easy" },
  { value: "moderate", label: "Moderate" },
  { value: "hard", label: "Hard" },
];

export function EfficiencyReviewModal({
  opportunity,
  existingPlan,
  contextMonth,
  todayMonth,
  money,
  onSave,
  onClose,
}: {
  opportunity: EfficiencyOpportunity;
  existingPlan?: EfficiencyPlan;
  contextMonth: string;
  todayMonth: string;
  money: (value: number) => string;
  onSave: (input: EfficiencyPlanInput) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState<LifeValue>(existingPlan?.value ?? "worthwhile");
  const [action, setAction] = useState<EfficiencyAction>(existingPlan?.action ?? opportunity.suggestedAction);
  const [effort, setEffort] = useState<ChangeEffort>(existingPlan?.effort ?? "moderate");
  const [targetMonthlySavings, setTargetMonthlySavings] = useState(
    existingPlan?.targetMonthlySavings || opportunity.estimatedMonthlySavings || opportunity.currentMonthlyCost,
  );
  const defaultTarget = useMemo(
    () => addMonths(contextMonth > todayMonth ? contextMonth : todayMonth, 1),
    [contextMonth, todayMonth],
  );
  const [targetMonth, setTargetMonth] = useState(existingPlan?.targetMonth ?? defaultTarget);
  const activeChange = action !== "keep";
  const canSave = !activeChange || (targetMonthlySavings > 0 && /^\d{4}-\d{2}$/.test(targetMonth));

  return (
    <Modal title="Review efficiency opportunity" onClose={onClose}>
      <form
        className="efficiency-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSave) return;
          onSave({ value, action, effort, targetMonthlySavings, ...(activeChange ? { targetMonth } : {}) });
        }}
      >
        <div className="efficiency-modal-summary">
          <span className="soft-label">{opportunity.confidence} confidence</span>
          <h3>{opportunity.subjectLabel}</h3>
          <p>
            Current monthly cost {money(opportunity.currentMonthlyCost)}
            {opportunity.baselineMonthlyCost > 0 ? ` · Baseline ${money(opportunity.baselineMonthlyCost)}` : ""}
          </p>
          {opportunity.estimatedMonthlySavings > 0 && (
            <strong>Estimated impact: {money(opportunity.estimatedMonthlySavings)} monthly · {money(opportunity.estimatedAnnualSavings)} annual</strong>
          )}
          <ul>{opportunity.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>

        <fieldset className="choice-fieldset">
          <legend>Value received</legend>
          <div className="choice-grid value-grid">
            {VALUE_OPTIONS.map((option) => (
              <label className={value === option.value ? "selected" : ""} key={option.value}>
                <input type="radio" name="life-value" value={option.value} checked={value === option.value} onChange={() => setValue(option.value)} />
                <span><strong>{option.label}</strong><small>{option.detail}</small></span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="choice-fieldset">
          <legend>Household decision</legend>
          <div className="choice-grid compact-grid">
            {ACTION_OPTIONS.map((option) => (
              <label className={action === option.value ? "selected" : ""} key={option.value}>
                <input type="radio" name="efficiency-action" value={option.value} checked={action === option.value} onChange={() => setAction(option.value)} />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="choice-fieldset">
          <legend>Change effort</legend>
          <div className="choice-grid compact-grid three">
            {EFFORT_OPTIONS.map((option) => (
              <label className={effort === option.value ? "selected" : ""} key={option.value}>
                <input type="radio" name="change-effort" value={option.value} checked={effort === option.value} onChange={() => setEffort(option.value)} />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {activeChange && (
          <div className="efficiency-targets">
            <label className="field">
              <span>Expected monthly saving</span>
              <input type="number" min="0.01" step="0.01" value={targetMonthlySavings} onChange={(event) => setTargetMonthlySavings(Number(event.target.value))} required />
            </label>
            <label className="field">
              <span>Target month</span>
              <input type="month" min={todayMonth} value={targetMonth} onChange={(event) => setTargetMonth(event.target.value)} required />
            </label>
          </div>
        )}

        <p className="muted efficiency-disclaimer">
          Estimates are planning aids. They never alter ledger spending, savings, settlement, or save-rate figures.
        </p>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={!canSave}>{activeChange ? "Save improvement plan" : `Keep until ${monthLabel(addMonths(contextMonth, 6))}`}</button>
        </div>
      </form>
    </Modal>
  );
}

export function EfficiencyOutcomeModal({
  opportunity,
  plan,
  money,
  onConfirm,
  onClose,
}: {
  opportunity: EfficiencyOpportunity;
  plan: EfficiencyPlan;
  money: (value: number) => string;
  onConfirm: (result: EfficiencyOutcomeResult) => void;
  onClose: () => void;
}) {
  const [dataComplete, setDataComplete] = useState(false);
  const [result, setResult] = useState<EfficiencyOutcomeResult>("achieved");
  return (
    <Modal title="Verify improvement outcome" onClose={onClose}>
      <div className="efficiency-form">
        <div className="efficiency-modal-summary">
          <span className="soft-label">Target month {monthLabel(plan.targetMonth ?? "")}</span>
          <h3>{plan.subjectLabel}</h3>
          <p>Baseline {money(plan.baseline.monthlyAmount)} · Target saving {money(plan.targetMonthlySavings)}</p>
          <strong>Observed reduction: {money(opportunity.observedMonthlyReduction ?? 0)}</strong>
          {opportunity.substitutionWarning && (
            <p className="efficiency-warning">Spending may have shifted elsewhere in the same purpose. Review the category before confirming a saving.</p>
          )}
        </div>

        <label className="checkbox-row efficiency-complete-check">
          <input type="checkbox" checked={dataComplete} onChange={(event) => setDataComplete(event.target.checked)} />
          <span><strong>All relevant statements are imported</strong><small>The target month is complete and its spending is classified.</small></span>
        </label>

        <label className="field">
          <span>Household result</span>
          <select value={result} onChange={(event) => setResult(event.target.value as EfficiencyOutcomeResult)}>
            <option value="achieved">Achieved</option>
            <option value="partial">Partially achieved</option>
            <option value="not_achieved">Not achieved</option>
          </select>
        </label>

        <p className="muted efficiency-disclaimer">The observed reduction remains an informational comparison, not extra ledger income or savings.</p>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="button" disabled={!dataComplete} onClick={() => onConfirm(result)}>Confirm outcome</button>
        </div>
      </div>
    </Modal>
  );
}
