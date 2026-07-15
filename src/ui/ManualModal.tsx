import { useState } from "react";
import { beneficiaryForAccount, resolveAccount } from "../domain/accounts";
import { spendingCategoryOptions } from "../domain/categories";
import { isoDateOf } from "../domain/dates";
import { isSpendKind, kindNeedsCategory, kindNeedsCounterparty, MOVEMENT_OPTIONS } from "../domain/movements";
import type { Account, CategoryKey, Counterparty, CustomCategory, Member, MovementKind, SpendBeneficiary } from "../domain/types";
import { Modal } from "./bits";

export interface ManualEntry {
  date: string;
  description: string;
  amount: number;
  category: CategoryKey;
  beneficiary: SpendBeneficiary;
  beneficiarySource?: "account_default";
  account: string;
  note: string;
  kind: MovementKind;
  counterpartyId?: string;
}

export function ManualModal({
  accounts,
  members,
  customCategories,
  counterparties,
  onAdd,
  onClose,
}: {
  accounts: Account[];
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
  const initialAccount = accounts[0];
  const initialBeneficiary = beneficiaryForAccount(initialAccount, members);
  const beneficiaryValue = (value: SpendBeneficiary) => value.type === "member" ? `member:${value.memberId}` : value.type;
  const [beneficiary, setBeneficiary] = useState(beneficiaryValue(initialBeneficiary));
  const [beneficiaryTouched, setBeneficiaryTouched] = useState(false);
  const [account, setAccount] = useState(initialAccount?.label ?? "Cash");
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
    if (isSpendKind(kind) && beneficiary === "unassigned") {
      setError("Choose who this spending was for.");
      return;
    }
    const resolvedAccount = resolveAccount(account, accounts);
    const accountDefault = beneficiaryForAccount(resolvedAccount, members);
    const usesAccountDefault = !beneficiaryTouched
      && accountDefault.type !== "unassigned"
      && beneficiaryValue(accountDefault) === beneficiary;
    onAdd({
      date,
      description: description.trim(),
      amount: value,
      category: showCategory ? category : "uncategorized",
      beneficiary: isSpendKind(kind)
        ? beneficiary === "household"
          ? { type: "household" }
          : { type: "member", memberId: beneficiary.slice("member:".length) }
        : { type: "unassigned" },
      ...(isSpendKind(kind) && usesAccountDefault ? { beneficiarySource: "account_default" as const } : {}),
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
        <label className="field"><span>Date</span><input aria-label="Date" type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label className="field"><span>Amount</span><input aria-label="Amount" type="number" min="0.01" step="0.01" inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      </div>
      <label className="field"><span>Description</span><input aria-label="Description" required value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <div className="form-grid">
        {showCategory ? (
          <label className="field">
            <span>Category</span>
            <select aria-label="Category" value={category} onChange={(event) => setCategory(event.target.value as CategoryKey)}>
              {categoryChoices.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
          </label>
        ) : (
          <span className="field" />
        )}
        {showType || kind !== "expense" ? (
          <label className="field">
            <span>Movement</span>
            <select aria-label="Movement" value={kind} onChange={(event) => setKind(event.target.value as MovementKind)}>
              {MOVEMENT_OPTIONS.map((option) => <option key={option.kind} value={option.kind}>{option.label}</option>)}
            </select>
          </label>
        ) : (
          <div className="field">
            <button type="button" className="link-button" onClick={() => setShowType(true)}>Movement: Expense · change</button>
          </div>
        )}
      </div>
      {isSpendKind(kind) && (
        <label className="field">
          <span>Who was it for?</span>
          <select aria-label="Beneficiary" value={beneficiary} onChange={(event) => {
            setBeneficiary(event.target.value);
            setBeneficiaryTouched(true);
          }}>
            <option value="unassigned" disabled>Choose beneficiary</option>
            <option value="household">Household</option>
            {members.map((member) => <option key={member.id} value={`member:${member.id}`}>{member.name}</option>)}
          </select>
        </label>
      )}
      {showCounterparty && (
        <label className="field">
          <span>Person</span>
          <select aria-label="Counterparty" value={counterpartyId} onChange={(event) => setCounterpartyId(event.target.value)}>
            <option value="">Unspecified</option>
            {counterparties.map((cp) => <option key={cp.id} value={cp.id}>{cp.name}</option>)}
          </select>
        </label>
      )}
      <div className="form-grid">
        <label className="field">
          <span>Account</span>
          <input aria-label="Account" list="mizan-accounts" value={account} onChange={(event) => {
            const value = event.target.value;
            setAccount(value);
            if (!beneficiaryTouched) setBeneficiary(beneficiaryValue(beneficiaryForAccount(resolveAccount(value, accounts), members)));
          }} />
          <datalist id="mizan-accounts">
            {accounts.map((option) => <option key={option.id} value={option.label} />)}
          </datalist>
        </label>
        <label className="field"><span>Note</span><input aria-label="Note" value={note} onChange={(event) => setNote(event.target.value)} /></label>
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
