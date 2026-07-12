import { useState } from "react";
import { transactionDisplayCurrency } from "../domain/accounts";
import { monthLabel } from "../domain/dates";
import { fxRateFor, netOf, receiptId, type PortionResolution } from "../domain/income";
import type { IncomeCandidate } from "../domain/incomeMatch";
import { formatMoney } from "../domain/money";
import type { Account, IncomeReceipt, Transaction } from "../domain/types";
import { Modal } from "./bits";

export function IncomeConfirmModal({
  item,
  candidate,
  linkedTransaction,
  alternatives,
  accounts = [],
  householdCurrency,
  fxRates = {},
  locale = "",
  money,
  transactionMoney,
  onSave,
  onRemove,
  onClose,
}: {
  item: PortionResolution;
  candidate?: IncomeCandidate;
  linkedTransaction?: Transaction;
  alternatives?: Transaction[];
  accounts?: Account[];
  householdCurrency: string;
  fxRates?: Record<string, number>;
  locale?: string;
  money: (value: number) => string;
  transactionMoney?: (txn: Transaction, value: number) => string;
  onSave: (receipt: IncomeReceipt) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const initialTransaction = linkedTransaction ?? candidate?.transaction;
  const portionCurrency = item.portion.currency.trim().toUpperCase() || householdCurrency.trim().toUpperCase();
  const initialCurrency = item.receipt?.receivedCurrency
    ?? candidate?.sourceCurrency
    ?? (initialTransaction ? transactionDisplayCurrency(initialTransaction, accounts, householdCurrency).trim().toUpperCase() : portionCurrency);
  const [receivedCurrency, setReceivedCurrency] = useState(initialCurrency);
  const initialRate = item.receipt?.fxRate ?? candidate?.fxRate ?? fxRateFor(initialCurrency, householdCurrency, fxRates) ?? 0;
  const [rate, setRate] = useState(initialRate);
  const foreignReceipt = receivedCurrency !== householdCurrency.trim().toUpperCase();
  const initialReceivedAmount = item.receipt?.receivedAmount
    ?? candidate?.sourceAmount
    ?? (initialCurrency !== householdCurrency.trim().toUpperCase() && initialRate > 0
      ? (item.receipt?.amount ?? item.deposit) / initialRate
      : (item.receipt?.amount ?? item.deposit));
  const [amount, setAmount] = useState(initialReceivedAmount);
  const [date, setDate] = useState(item.receipt?.date ?? candidate?.transaction.date ?? "");
  const [transactionId, setTransactionId] = useState(item.receipt?.transactionId ?? candidate?.transaction.id ?? "");
  const householdAmount = foreignReceipt ? amount * rate : amount;
  const net = netOf(householdAmount, item.portion);
  const rowMoney = transactionMoney ?? ((_transaction: Transaction, value: number) => money(value));
  const receivedMoney = (value: number) => formatMoney(value, { currency: receivedCurrency, locale });
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
      const currency = transactionDisplayCurrency(transaction, accounts, householdCurrency).trim().toUpperCase();
      setReceivedCurrency(currency);
      setRate(fxRateFor(currency, householdCurrency, fxRates) ?? 0);
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
      amount: Number(householdAmount) || 0,
      ...(foreignReceipt ? { receivedAmount: Number(amount) || 0, receivedCurrency, fxRate: Number(rate) || 0 } : {}),
      ...(date ? { date } : {}),
      ...(transactionId ? { transactionId } : {}),
    };
    onSave(receipt);
  };

  return (
    <Modal title={`Confirm ${item.portion.label}`} onClose={onClose}>
      <div className="modal-form income-confirm-form">
        <p className="muted">
          Record what actually reached the account in {receivedCurrency}. {foreignReceipt
            ? `Mizan converts it to ${householdCurrency} for household totals.`
            : ""} This confirmation applies only to {monthLabel(item.month)}.
        </p>
        {transactionId && selectedTransaction && (
          <div className="income-evidence">
            <span className="soft-label">From your statement</span>
            <strong>{selectedTransaction.description}</strong>
            <small>{selectedTransaction.account} · {selectedTransaction.date} · {rowMoney(selectedTransaction, selectedTransaction.amount)}</small>
            <button type="button" className="link-button" onClick={() => setTransactionId("")}>Unlink / enter manually</button>
          </div>
        )}
        {available.length > 0 && (
          <label className="field">
            <span>{transactionId ? "Link a different credit" : "Link a statement credit"}</span>
            <select value={transactionId} onChange={(event) => selectTransaction(event.target.value)}>
              <option value="">Enter manually</option>
              {available.map((transaction) => (
                <option key={transaction.id} value={transaction.id}>{transaction.date} · {transaction.description} · {rowMoney(transaction, transaction.amount)}</option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>Amount received ({receivedCurrency})</span>
          <input autoFocus type="number" min="0" step="any" value={amount || ""} onChange={(event) => setAmount(Number(event.target.value) || 0)} />
        </label>
        {foreignReceipt && (
          <label className="field">
            <span>FX rate ({householdCurrency} per {receivedCurrency})</span>
            <input type="number" min="0" step="any" value={rate || ""} onChange={(event) => setRate(Number(event.target.value) || 0)} />
          </label>
        )}
        <label className="field">
          <span>Date received (optional)</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        {!item.portion.taxWithheld && item.portion.taxRate > 0 && (
          <p className="income-net-caption">
            {foreignReceipt && <>{receivedMoney(amount)} × {rate || 0} = {money(householdAmount)}. </>}
            {money(net)} counts as available after setting aside {item.portion.taxRate}% tax.
          </p>
        )}
        {foreignReceipt && (item.portion.taxWithheld || item.portion.taxRate <= 0) && (
          <p className="income-net-caption">{receivedMoney(amount)} × {rate || 0} = {money(householdAmount)} for household totals.</p>
        )}
        <div className="modal-actions">
          {item.receipt && <button className="secondary danger" onClick={onRemove}>Remove confirmation</button>}
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button disabled={foreignReceipt && rate <= 0} onClick={save}>Confirm received</button>
        </div>
      </div>
    </Modal>
  );
}
