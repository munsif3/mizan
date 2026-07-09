import { useState } from "react";
import { spendingCategoryOptions } from "../domain/categories";
import { isoDateOf } from "../domain/dates";
import type { CategoryKey, Member } from "../domain/types";
import { Modal } from "./bits";

export interface ManualEntry {
  date: string;
  description: string;
  amount: number;
  category: CategoryKey;
  account: string;
  note: string;
}

export function ManualModal({
  accountOptions,
  members,
  onAdd,
  onClose,
}: {
  accountOptions: string[];
  members: Member[];
  onAdd: (entry: ManualEntry) => void;
  onClose: () => void;
}) {
  const categoryChoices = spendingCategoryOptions(members);
  const [date, setDate] = useState(() => isoDateOf(new Date()));
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<CategoryKey>("food");
  const [account, setAccount] = useState("Cash");
  const [note, setNote] = useState("");

  function submit() {
    const value = Number(amount);
    if (!description.trim() || !value) return;
    onAdd({
      date,
      description: description.trim(),
      amount: value,
      category,
      account: account.trim() || "Manual",
      note: note.trim(),
    });
    onClose();
  }

  return (
    <Modal title="Add transaction" onClose={onClose}>
      <div className="form-grid">
        <label className="field"><span>Date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label className="field"><span>Amount</span><input type="number" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      </div>
      <label className="field"><span>Description</span><input value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <div className="form-grid">
        <label className="field">
          <span>Category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value as CategoryKey)}>
            {categoryChoices.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Account</span>
          <input list="mizan-accounts" value={account} onChange={(event) => setAccount(event.target.value)} />
          <datalist id="mizan-accounts">
            {accountOptions.map((option) => <option key={option} value={option} />)}
          </datalist>
        </label>
      </div>
      <label className="field"><span>Note</span><input value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <div className="modal-actions">
        <button className="secondary" onClick={onClose}>Cancel</button>
        <button onClick={submit}>Add</button>
      </div>
    </Modal>
  );
}
