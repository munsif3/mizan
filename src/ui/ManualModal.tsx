import { useState } from "react";
import { spendingCategoryOptions } from "../domain/categories";
import { isoDateOf } from "../domain/dates";
import { kindNeedsCategory, kindNeedsCounterparty, MOVEMENT_OPTIONS } from "../domain/movements";
import type { CategoryKey, Counterparty, CustomCategory, Member, MovementKind } from "../domain/types";
import { Modal } from "./bits";

export interface ManualEntry {
  date: string;
  description: string;
  amount: number;
  category: CategoryKey;
  account: string;
  note: string;
  kind: MovementKind;
  counterpartyId?: string;
}

export function ManualModal({
  accountOptions,
  members,
  customCategories,
  counterparties,
  onAdd,
  onClose,
}: {
  accountOptions: string[];
  members: Member[];
  customCategories: CustomCategory[];
  counterparties: Counterparty[];
  onAdd: (entry: ManualEntry) => void;
  onClose: () => void;
}) {
  const categoryChoices = spendingCategoryOptions(members, customCategories);
  const [date, setDate] = useState(() => isoDateOf(new Date()));
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<CategoryKey>("food");
  const [account, setAccount] = useState("Cash");
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<MovementKind>("expense");
  const [showType, setShowType] = useState(false);
  const [counterpartyId, setCounterpartyId] = useState("");
  const [error, setError] = useState("");

  const showCategory = kindNeedsCategory(kind);
  const showCounterparty = kindNeedsCounterparty(kind);

  function submit() {
    const value = Number(amount);
    if (!date) {
      setError("Choose a transaction date.");
      return;
    }
    if (!description.trim()) {
      setError("Add a short description.");
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    onAdd({
      date,
      description: description.trim(),
      amount: value,
      category: showCategory ? category : "uncategorized",
      account: account.trim() || "Manual",
      note: note.trim(),
      kind,
      counterpartyId: showCounterparty && counterpartyId ? counterpartyId : undefined,
    });
    onClose();
  }

  return (
    <Modal title="Add transaction" onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <div className="form-grid">
        <label className="field"><span>Date</span><input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label className="field"><span>Amount</span><input type="number" min="0.01" step="0.01" inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      </div>
      <label className="field"><span>Description</span><input required value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <div className="form-grid">
        {showCategory ? (
          <label className="field">
            <span>Category</span>
            <select value={category} onChange={(event) => setCategory(event.target.value as CategoryKey)}>
              {categoryChoices.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
          </label>
        ) : (
          <span className="field" />
        )}
        {showType || kind !== "expense" ? (
          <label className="field">
            <span>Movement</span>
            <select value={kind} onChange={(event) => setKind(event.target.value as MovementKind)}>
              {MOVEMENT_OPTIONS.map((option) => <option key={option.kind} value={option.kind}>{option.label}</option>)}
            </select>
          </label>
        ) : (
          <div className="field">
            <button type="button" className="link-button" onClick={() => setShowType(true)}>Movement: Expense · change</button>
          </div>
        )}
      </div>
      {showCounterparty && (
        <label className="field">
          <span>Person</span>
          <select value={counterpartyId} onChange={(event) => setCounterpartyId(event.target.value)}>
            <option value="">Unspecified</option>
            {counterparties.map((cp) => <option key={cp.id} value={cp.id}>{cp.name}</option>)}
          </select>
        </label>
      )}
      <div className="form-grid">
        <label className="field">
          <span>Account</span>
          <input list="mizan-accounts" value={account} onChange={(event) => setAccount(event.target.value)} />
          <datalist id="mizan-accounts">
            {accountOptions.map((option) => <option key={option} value={option} />)}
          </datalist>
        </label>
        <label className="field"><span>Note</span><input value={note} onChange={(event) => setNote(event.target.value)} /></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={onClose}>Cancel</button>
        <button type="submit">Add</button>
      </div>
      </form>
    </Modal>
  );
}
