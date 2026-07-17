import { useState } from "react";
import { uid, type IncomeBudgetTreatment, type IncomePortion, type Member } from "../domain/types";
import { Button, Modal } from "./bits";

export function OneOffIncomeModal({
  members,
  month,
  householdCurrency,
  onSave,
  onClose,
}: {
  members: Member[];
  month: string;
  householdCurrency: string;
  onSave: (memberId: string, portion: IncomePortion) => void;
  onClose: () => void;
}) {
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [label, setLabel] = useState("Annual bonus");
  const [scheduledMonth, setScheduledMonth] = useState(month);
  const [amount, setAmount] = useState(0);
  const [currency, setCurrency] = useState(householdCurrency);
  const [taxWithheld, setTaxWithheld] = useState(true);
  const [taxRate, setTaxRate] = useState(0);
  const [startDay, setStartDay] = useState(0);
  const [endDay, setEndDay] = useState(0);
  const [budgetTreatment, setBudgetTreatment] = useState<IncomeBudgetTreatment>("protected");
  const validMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(scheduledMonth);
  const canSave = Boolean(memberId && label.trim() && amount > 0 && currency.trim() && validMonth);

  const save = () => {
    if (!canSave) return;
    onSave(memberId, {
      id: uid("por"),
      label: label.trim(),
      amount,
      currency: currency.trim().toUpperCase(),
      taxRate,
      taxWithheld,
      window: startDay || endDay
        ? { startDay: startDay || endDay, endDay: endDay || startDay }
        : null,
      schedule: { frequency: "one_off", month: scheduledMonth },
      budgetTreatment,
    });
  };

  return (
    <Modal title="Add one-off income" onClose={onClose}>
      <div className="modal-form one-off-income-form">
        <p className="muted">
          Plan a bonus or other genuine household income for one month. It is protected from increasing the
          normal spending allowance unless you choose otherwise.
        </p>
        <label className="field">
          <span>Household member</span>
          <select value={memberId} onChange={(event) => setMemberId(event.target.value)}>
            {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
        </label>
        <div className="form-grid two">
          <label className="field">
            <span>Income name</span>
            <input autoFocus value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Annual bonus" />
          </label>
          <label className="field">
            <span>Expected month</span>
            <input type="month" value={scheduledMonth} onChange={(event) => setScheduledMonth(event.target.value)} />
          </label>
          <label className="field">
            <span>Expected deposit</span>
            <input type="number" min="0" step="any" value={amount || ""} onChange={(event) => setAmount(Math.max(0, Number(event.target.value) || 0))} />
          </label>
          <label className="field">
            <span>Currency</span>
            <input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase().trim())} />
          </label>
        </div>
        <div className="tax-treatment-choices" role="group" aria-label="Bonus tax treatment">
          <button type="button" className={taxWithheld ? "active" : ""} aria-pressed={taxWithheld} onClick={() => setTaxWithheld(true)}>
            <strong>Tax already deducted</strong><small>The deposit is ready to use.</small>
          </button>
          <button type="button" className={!taxWithheld ? "active" : ""} aria-pressed={!taxWithheld} onClick={() => setTaxWithheld(false)}>
            <strong>Tax paid later</strong><small>Mizan reserves tax first.</small>
          </button>
        </div>
        {!taxWithheld && (
          <label className="field">
            <span>Tax rate</span>
            <input type="number" min="0" max="99.99" value={taxRate || ""} onChange={(event) => setTaxRate(Math.max(0, Math.min(99.99, Number(event.target.value) || 0)))} />
          </label>
        )}
        <div className="form-grid two">
          <label className="field">
            <span>Arrival from day (optional)</span>
            <input type="number" min="1" max="31" value={startDay || ""} onChange={(event) => setStartDay(Math.max(0, Math.min(31, Number(event.target.value) || 0)))} />
          </label>
          <label className="field">
            <span>Arrival to day (optional)</span>
            <input type="number" min="1" max="31" value={endDay || ""} onChange={(event) => setEndDay(Math.max(0, Math.min(31, Number(event.target.value) || 0)))} />
          </label>
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={budgetTreatment === "protected"}
            onChange={(event) => setBudgetTreatment(event.target.checked ? "protected" : "ordinary")}
          />
          <span><strong>Protect from the spending plan</strong><small>Count it as income and savings without increasing the normal monthly allowance.</small></span>
        </label>
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!canSave} onClick={save}>Add planned income</Button>
        </div>
      </div>
    </Modal>
  );
}
