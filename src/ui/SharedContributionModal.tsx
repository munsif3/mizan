import { useMemo, useState } from "react";
import { ownerOfTransaction } from "../domain/accounts";
import {
  allocateSharedContribution,
  recoveryRowsForContribution,
  sharedContributionError,
  sharedContributionId,
  transactionContributionAmount,
  type SharedContributionCandidate,
} from "../domain/contributions";
import type { Account, Member, SharedContribution, Transaction } from "../domain/types";
import { Modal } from "./bits";

export function SharedContributionModal({
  transactions,
  accounts,
  members,
  contributions,
  candidate,
  expenseId,
  contribution,
  money,
  onSave,
  onRemove,
  onClose,
}: {
  transactions: Transaction[];
  accounts: Account[];
  members: Member[];
  contributions: SharedContribution[];
  candidate?: SharedContributionCandidate;
  expenseId?: string;
  contribution?: SharedContribution;
  money: (value: number) => string;
  onSave: (contribution: SharedContribution) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const initialDebitId = contribution?.transferDebitTransactionId ?? candidate?.debit.id ?? "";
  const initialCreditId = contribution?.transferCreditTransactionId ?? candidate?.credit.id ?? "";
  const existingRecoveryRows = contribution ? recoveryRowsForContribution(contribution, transactions) : [];
  const initialExpenseIds = candidate?.expenses.map((expense) => expense.id)
    ?? (existingRecoveryRows.length ? existingRecoveryRows.map((expense) => expense.id) : expenseId ? [expenseId] : []);
  const [debitId, setDebitId] = useState(initialDebitId);
  const [creditId, setCreditId] = useState(initialCreditId);
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<string[]>(initialExpenseIds);

  const memberIds = useMemo(() => new Set(members.map((member) => member.id)), [members]);
  const debits = transactions.filter((txn) => {
    const owner = ownerOfTransaction(txn, accounts);
    return txn.direction === "debit" && memberIds.has(owner) && (txn.kind === "expense" || txn.kind === "internal_transfer");
  });
  const selectedDebit = transactions.find((txn) => txn.id === debitId);
  const credits = transactions.filter((txn) =>
    txn.direction === "credit"
      && (txn.kind === "account_credit" || txn.kind === "internal_transfer")
      && (!selectedDebit || Math.abs(transactionContributionAmount(txn) - transactionContributionAmount(selectedDebit)) <= 0.005),
  );
  const selectedCredit = transactions.find((txn) => txn.id === creditId);
  const sameAccount = (a: Transaction, b: Transaction) =>
    a.accountId && b.accountId ? a.accountId === b.accountId : a.account.trim().toUpperCase() === b.account.trim().toUpperCase();
  const nearby = (a: string, b: string) => {
    const first = Date.parse(`${a}T00:00:00Z`);
    const second = Date.parse(`${b}T00:00:00Z`);
    return Number.isFinite(first) && Number.isFinite(second) && Math.abs(Math.round((first - second) / 86_400_000)) <= 31;
  };
  const expenses = transactions
    .filter((txn) =>
      txn.direction === "debit"
        && txn.kind === "loan_payment"
        && txn.beneficiary.type === "household"
        && (!selectedCredit || (sameAccount(selectedCredit, txn) && nearby(selectedCredit.date, txn.date))),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const selectedExpenses = expenses.filter((txn) => selectedExpenseIds.includes(txn.id));
  const contributorMemberId = selectedDebit ? ownerOfTransaction(selectedDebit, accounts) : "joint";
  const amount = selectedDebit ? transactionContributionAmount(selectedDebit) : 0;
  const allocations = selectedCredit
    ? allocateSharedContribution(amount, selectedCredit.date, selectedExpenses, contributions, contribution?.id)
    : [];
  const allocatedTotal = allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  const draft: SharedContribution | null = selectedDebit && selectedCredit && selectedExpenses.length && contributorMemberId !== "joint"
    ? {
        id: contribution?.id ?? sharedContributionId(selectedExpenseIds, selectedDebit.id, selectedCredit.id),
        allocations,
        transferDebitTransactionId: selectedDebit.id,
        transferCreditTransactionId: selectedCredit.id,
        contributorMemberId,
        amount,
      }
    : null;
  const capacityError = draft && amount - allocatedTotal > 0.005
    ? "Selected recovery deductions do not have enough unallocated value for this contribution."
    : "";
  const error = capacityError || (draft ? sharedContributionError(draft, transactions, accounts, members, contributions) : "Select both transfer rows and at least one loan recovery deduction.");
  const contributor = members.find((member) => member.id === contributorMemberId);
  const payerId = selectedExpenses[0] ? ownerOfTransaction(selectedExpenses[0], accounts) : "joint";
  const payer = members.find((member) => member.id === payerId);
  const groupTotal = selectedExpenses.reduce((sum, expense) => sum + transactionContributionAmount(expense), 0);
  const allocatedByExpense = new Map(allocations.map((allocation) => [allocation.expenseTransactionId, allocation.amount]));

  const label = (txn: Transaction) => `${txn.date} · ${txn.description} · ${money(transactionContributionAmount(txn))} · ${txn.account}`;
  const toggleExpense = (id: string) => setSelectedExpenseIds((current) =>
    current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
  );

  return (
    <Modal title={contribution ? "Edit shared contribution" : "Confirm shared contribution"} onClose={onClose} wide>
      <div className="modal-form contribution-form">
        <p className="muted">Choose the outgoing transfer, its matching savings credit, and every partial loan recovery it funded. Mizan counts each recovery debit once and changes only who funded it.</p>
        <label>
          <span>Contributor's outgoing transfer</span>
          <select value={debitId} onChange={(event) => { setDebitId(event.target.value); setCreditId(""); }}>
            <option value="">Select debit</option>
            {debits.map((txn) => <option key={txn.id} value={txn.id}>{label(txn)}</option>)}
          </select>
        </label>
        <label>
          <span>Matching credit into the loan-paying account</span>
          <select value={creditId} onChange={(event) => setCreditId(event.target.value)}>
            <option value="">Select credit</option>
            {credits.map((txn) => <option key={txn.id} value={txn.id}>{label(txn)}</option>)}
          </select>
        </label>

        <fieldset className="contribution-recoveries">
          <legend>Loan recovery deductions funded</legend>
          {expenses.map((txn) => (
            <label key={txn.id} className={selectedExpenseIds.includes(txn.id) ? "selected" : ""}>
              <input
                type="checkbox"
                checked={selectedExpenseIds.includes(txn.id)}
                onChange={() => toggleExpense(txn.id)}
              />
              <span>{label(txn)}</span>
            </label>
          ))}
          {!expenses.length && <p className="muted">Classify the partial recovery rows as Loan / debt payment first.</p>}
        </fieldset>

        {draft && !error && (
          <div className="contribution-preview" aria-label="Contribution settlement preview">
            <strong>Total recovered: {money(groupTotal)}</strong>
            <span>{contributor?.name} funded {money(amount)} · {payer?.name} funded {money(Math.max(0, groupTotal - amount))}</span>
            <div className="contribution-allocation-list">
              {selectedExpenses.map((expense) => {
                const contributorAmount = allocatedByExpense.get(expense.id) ?? 0;
                return (
                  <small key={expense.id}>
                    {expense.date} · {expense.description}: {money(transactionContributionAmount(expense))} recovered · {contributor?.name} {money(contributorAmount)} · {payer?.name} {money(transactionContributionAmount(expense) - contributorAmount)}
                  </small>
                );
              })}
            </div>
            <small>Each allocation remains in its recovery row's bank-posting month.</small>
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          {contribution && <button className="danger secondary" onClick={() => onRemove(contribution.id)}>Unlink contribution</button>}
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button disabled={!draft || Boolean(error)} onClick={() => draft && !error && onSave(draft)}>
            {contribution ? "Save changes" : "Confirm contribution"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
