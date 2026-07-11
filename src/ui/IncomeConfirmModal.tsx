import { useState } from "react";
import { monthLabel } from "../domain/dates";
import { netOf, receiptId, type PortionResolution } from "../domain/income";
import type { IncomeCandidate } from "../domain/incomeMatch";
import type { IncomeReceipt, Transaction } from "../domain/types";
import { Modal } from "./bits";

export function IncomeConfirmModal({
  item,
  candidate,
  linkedTransaction,
  alternatives,
  householdCurrency,
  money,
  onSave,
  onRemove,
  onClose,
}: {
  item: PortionResolution;
  candidate?: IncomeCandidate;
  linkedTransaction?: Transaction;
  alternatives?: Transaction[];
  householdCurrency: string;
  money: (value: number) => string;
  onSave: (receipt: IncomeReceipt) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const initialTransaction = linkedTransaction ?? candidate?.transaction;
  const [amount, setAmount] = useState(item.receipt?.amount ?? candidate?.amount ?? item.deposit);
  const [date, setDate] = useState(item.receipt?.date ?? candidate?.transaction.date ?? "");
  const [transactionId, setTransactionId] = useState(item.receipt?.transactionId ?? candidate?.transaction.id ?? "");
  const net = netOf(amount, item.portion);
  const available = [...new Map(
    [linkedTransaction, candidate?.transaction, ...(alternatives ?? [])]
      .filter((transaction): transaction is Transaction => Boolean(transaction))
      .map((transaction) => [transaction.id, transaction]),
  ).values()];
  const selectedTransaction = available.find((transaction) => transaction.id === transactionId) ?? initialTransaction;

  const selectTransaction = (id: string) => {
    const transaction = available.find((item) => item.id === id);
    setTransactionId(id);
    if (transaction) {
      setAmount(transaction.amount);
      setDate(transaction.date);
    }
  };

  const save = () => {
    const receipt: IncomeReceipt = {
      id: receiptId(item.month, item.portion.id),
      month: item.month,
      memberId: item.memberId,
      portionId: item.portion.id,
      amount: Number(amount) || 0,
      ...(date ? { date } : {}),
      ...(transactionId ? { transactionId } : {}),
    };
    onSave(receipt);
  };

  return (
    <Modal title={`Confirm ${item.portion.label}`} onClose={onClose}>
      <div className="modal-form income-confirm-form">
        <p className="muted">
          Record what actually reached the account in {householdCurrency}. This confirmation applies only to {monthLabel(item.month)}.
        </p>
        {transactionId && selectedTransaction && (
          <div className="income-evidence">
            <span className="soft-label">From your statement</span>
            <strong>{selectedTransaction.description}</strong>
            <small>{selectedTransaction.account} · {selectedTransaction.date} · {money(selectedTransaction.amount)}</small>
            <button type="button" className="link-button" onClick={() => setTransactionId("")}>Unlink / enter manually</button>
          </div>
        )}
        {available.length > 0 && (
          <label className="field">
            <span>{transactionId ? "Link a different credit" : "Link a statement credit"}</span>
            <select value={transactionId} onChange={(event) => selectTransaction(event.target.value)}>
              <option value="">Enter manually</option>
              {available.map((transaction) => (
                <option key={transaction.id} value={transaction.id}>{transaction.date} · {transaction.description} · {money(transaction.amount)}</option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>Amount received ({householdCurrency})</span>
          <input autoFocus type="number" min="0" step="any" value={amount || ""} onChange={(event) => setAmount(Number(event.target.value) || 0)} />
        </label>
        <label className="field">
          <span>Date received (optional)</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        {!item.portion.taxWithheld && item.portion.taxRate > 0 && (
          <p className="income-net-caption">
            {money(net)} counts as available after setting aside {item.portion.taxRate}% tax.
          </p>
        )}
        <div className="modal-actions">
          {item.receipt && <button className="secondary danger" onClick={onRemove}>Remove confirmation</button>}
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button onClick={save}>Confirm received</button>
        </div>
      </div>
    </Modal>
  );
}
