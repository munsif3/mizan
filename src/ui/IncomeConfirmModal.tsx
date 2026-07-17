import { useState } from "react";
import { transactionDisplayCurrency } from "../domain/accounts";
import { monthLabel } from "../domain/dates";
import { fxRateFor, netOf, receiptId, type PortionResolution } from "../domain/income";
import type { IncomeCandidate } from "../domain/incomeMatch";
import { formatMoney, normalizeCurrency, resolveIncomeCurrency } from "../domain/money";
import type { Account, IncomeReceipt, Transaction } from "../domain/types";
import { Button, ConfirmDialog, Modal } from "./bits";

function useIncomeConfirmationModel({
  item,
  allocationItems = [item],
  candidate,
  linkedTransaction,
  alternatives = [],
  accounts = [],
  householdCurrency,
  fxRates = {},
  locale,
  money,
  currencyMoney,
  onSave,
  onRemove,
  onUnlinkEvidence,
  onClose,
}: {
  item: PortionResolution;
  allocationItems?: PortionResolution[];
  candidate?: IncomeCandidate;
  linkedTransaction?: Transaction;
  alternatives?: Transaction[];
  accounts?: Account[];
  householdCurrency: string;
  fxRates?: Record<string, number>;
  locale?: string;
  money: (value: number) => string;
  currencyMoney?: (value: number, currency: string) => string;
  onSave: (receipts: IncomeReceipt[]) => void;
  onRemove: () => void;
  onUnlinkEvidence?: (transactionId: string) => void;
  onClose: () => void;
}) {
  const householdCode = normalizeCurrency(householdCurrency);
  const portionCurrency = normalizeCurrency(item.portion.currency, householdCode);
  const portionRate = fxRateFor(portionCurrency, householdCode, fxRates);
  const resolveTransactionCurrency = (transaction?: Transaction, candidateCurrency?: string) => resolveIncomeCurrency({
    savedCurrency: item.receipt?.receivedCurrency,
    candidateCurrency,
    accountCurrency: transaction ? transactionDisplayCurrency(transaction, accounts, householdCode) : undefined,
    portionCurrency,
    householdCurrency: householdCode,
    statementAmount: transaction?.amount,
    portionAmount: item.portion.amount,
    fxRate: portionRate,
  });
  const initialTransaction = linkedTransaction ?? candidate?.transaction;
  const initialResolution = initialTransaction
    ? resolveTransactionCurrency(initialTransaction, candidate?.sourceCurrency)
    : resolveIncomeCurrency({
        savedCurrency: item.receipt?.receivedCurrency,
        portionCurrency,
        householdCurrency: householdCode,
      });
  const initialCurrency = initialResolution.currency;
  const initialRate = item.receipt?.fxRate ?? candidate?.fxRate ?? fxRateFor(initialCurrency, householdCurrency, fxRates) ?? 0;
  const initialReceivedAmount = item.receipt?.receivedAmount
    ?? candidate?.sourceAmount
    ?? (initialCurrency !== householdCode && initialRate > 0
      ? (item.receipt?.amount ?? item.deposit) / initialRate
      : (item.receipt?.amount ?? item.deposit));
  const eligibleAllocationItems = allocationItems.filter((target) => target.memberId === item.memberId
    && target.month === item.month
    && (!target.receipt?.transactionId || target.receipt.transactionId === initialTransaction?.id || target.portion.id === item.portion.id));
  const initialGroupItems = initialTransaction
    ? eligibleAllocationItems.filter((target) => target.receipt?.transactionId === initialTransaction.id)
    : [];

  const [receivedCurrency, setReceivedCurrency] = useState(initialCurrency);
  const [rate, setRate] = useState(initialRate);
  const [amount, setAmount] = useState(initialReceivedAmount);
  const [date, setDate] = useState(item.receipt?.date ?? candidate?.transaction.date ?? "");
  const [transactionId, setTransactionId] = useState(item.receipt?.transactionId ?? candidate?.transaction.id ?? "");
  const [splitCredit, setSplitCredit] = useState(initialGroupItems.length > 1);
  const [pendingConfirmation, setPendingConfirmation] = useState<null | {
    title: string;
    body: string;
    confirmLabel: string;
    action: () => void;
  }>(null);
  const [allocations, setAllocations] = useState<Record<string, number>>(() => Object.fromEntries(
    eligibleAllocationItems.map((target) => {
      const receipt = target.receipt;
      if (receipt && initialTransaction && receipt.transactionId === initialTransaction.id) {
        return [target.portion.id, receipt.receivedAmount
          ?? (initialCurrency !== householdCode && (receipt.fxRate ?? initialRate) > 0
            ? receipt.amount / (receipt.fxRate ?? initialRate)
            : receipt.amount)];
      }
      return [target.portion.id, target.portion.id === item.portion.id ? initialReceivedAmount : 0];
    }),
  ));

  const moneyIn = currencyMoney ?? ((value: number, currency: string) => formatMoney(value, { currency, locale: locale ?? "" }));
  const available = [...new Map(
    [linkedTransaction, candidate?.transaction, ...alternatives]
      .filter((transaction): transaction is Transaction => Boolean(transaction))
      .map((transaction) => [transaction.id, transaction]),
  ).values()];
  const selectedTransaction = available.find((transaction) => transaction.id === transactionId) ?? initialTransaction;
  const selectedResolution = selectedTransaction
    ? resolveTransactionCurrency(selectedTransaction, candidate?.transaction.id === selectedTransaction.id ? candidate.sourceCurrency : undefined)
    : initialResolution;
  const foreignReceipt = receivedCurrency !== householdCode;
  const householdAmount = foreignReceipt ? amount * rate : amount;
  const net = netOf(householdAmount, {
    taxRate: item.taxRate,
    taxWithheld: item.taxWithheld,
  });
  const currencyChoices = [...new Set([portionCurrency, selectedResolution.currency, householdCode])].filter(Boolean);
  const allocationTotal = Object.values(allocations).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const allocationDifference = selectedTransaction ? selectedTransaction.amount - allocationTotal : 0;
  const allocationTolerance = selectedTransaction ? Math.max(0.01, Math.abs(selectedTransaction.amount) * 1e-9) : 0.01;
  const allocationBalanced = Boolean(selectedTransaction) && Math.abs(allocationDifference) <= allocationTolerance;

  const statementMoney = (transaction: Transaction, value: number) => {
    const resolution = resolveTransactionCurrency(
      transaction,
      candidate?.transaction.id === transaction.id ? candidate.sourceCurrency : undefined,
    );
    return moneyIn(value, resolution.currency);
  };

  const selectTransaction = (id: string) => {
    const transaction = available.find((candidateTransaction) => candidateTransaction.id === id);
    setTransactionId(id);
    setSplitCredit(false);
    if (transaction) {
      const currency = resolveTransactionCurrency(
        transaction,
        candidate?.transaction.id === transaction.id ? candidate.sourceCurrency : undefined,
      ).currency;
      const nextRate = fxRateFor(currency, householdCurrency, fxRates) ?? 0;
      setReceivedCurrency(currency);
      setRate(nextRate);
      setAmount(transaction.amount);
      setDate(transaction.date);
      setAllocations(Object.fromEntries(eligibleAllocationItems.map((target) => [
        target.portion.id,
        target.portion.id === item.portion.id ? transaction.amount : 0,
      ])));
    }
  };

  const receiptForAllocation = (target: PortionResolution, receivedAmount: number): IncomeReceipt => {
    const convertedAmount = foreignReceipt ? receivedAmount * rate : receivedAmount;
    return {
      id: receiptId(target.month, target.memberId, target.portion.id),
      month: target.month,
      memberId: target.memberId,
      portionId: target.portion.id,
      amount: Number(convertedAmount) || 0,
      ...(foreignReceipt ? { receivedAmount: Number(receivedAmount) || 0, receivedCurrency, fxRate: Number(rate) || 0 } : {}),
      ...(date ? { date } : {}),
      ...(transactionId ? { transactionId } : {}),
      label: target.receipt?.label ?? target.portion.label,
      taxRate: target.taxRate,
      taxWithheld: target.taxWithheld,
      budgetTreatment: target.receipt?.budgetTreatment ?? target.budgetTreatment,
    };
  };

  const save = () => {
    if (splitCredit && selectedTransaction) {
      if (!allocationBalanced || (foreignReceipt && (!Number.isFinite(rate) || rate <= 0))) return;
      const next = eligibleAllocationItems
        .map((target) => ({ target, amount: Number(allocations[target.portion.id]) || 0 }))
        .filter((allocation) => allocation.amount > 0)
        .map((allocation) => receiptForAllocation(allocation.target, allocation.amount));
      if (!next.length) return;
      const removedExisting = initialGroupItems.filter((target) => !next.some((receipt) => receipt.portionId === target.portion.id));
      if (removedExisting.length) {
        setPendingConfirmation({
          title: "Remove income allocations?",
          body: `${removedExisting.length} income allocation${removedExisting.length === 1 ? "" : "s"} will be removed from this statement credit and their monthly confirmations will be deleted.`,
          confirmLabel: "Remove and save",
          action: () => onSave(next),
        });
        return;
      }
      onSave(next);
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0 || (foreignReceipt && (!Number.isFinite(rate) || rate <= 0))) return;
    onSave([receiptForAllocation(item, amount)]);
  };

  const removeConfirmation = () => {
    setPendingConfirmation({
      title: "Delete income confirmation?",
      body: initialGroupItems.length > 1
        ? `${item.portion.label} will be removed from this combined statement credit. Other income allocations will remain.`
        : `${item.portion.label} will no longer be confirmed for ${monthLabel(item.month)}.`,
      confirmLabel: "Delete confirmation",
      action: onRemove,
    });
  };

  return {
    item, onClose, receivedCurrency, foreignReceipt, householdCurrency, transactionId,
    selectedTransaction, statementMoney, onUnlinkEvidence, available, selectTransaction,
    eligibleAllocationItems, splitCredit, setSplitCredit, moneyIn, allocationTotal,
    allocationDifference, allocations, setAllocations, allocationBalanced, amount, setAmount,
    selectedResolution, householdCode, setReceivedCurrency, setRate, fxRates, currencyChoices,
    rate, date, setDate, money, householdAmount, net, removeConfirmation, save,
    pendingConfirmation, setPendingConfirmation,
  };
}

type IncomeConfirmationModel = ReturnType<typeof useIncomeConfirmationModel>;

function IncomeConfirmationBody({ model }: { model: IncomeConfirmationModel }) {
  const {
    item, onClose, receivedCurrency, foreignReceipt, householdCurrency, transactionId,
    selectedTransaction, statementMoney, onUnlinkEvidence, available, selectTransaction,
    eligibleAllocationItems, splitCredit, setSplitCredit, moneyIn, allocationTotal,
    allocationDifference, allocations, setAllocations, allocationBalanced, amount, setAmount,
    selectedResolution, householdCode, setReceivedCurrency, setRate, fxRates, currencyChoices,
    rate, date, setDate, money, householdAmount, net, removeConfirmation, save,
    pendingConfirmation, setPendingConfirmation,
  } = model;
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
            <small>{selectedTransaction.account} · {selectedTransaction.date} · {statementMoney(selectedTransaction, selectedTransaction.amount)}</small>
            {onUnlinkEvidence && (
              <button type="button" className="link-button" onClick={() => onUnlinkEvidence(transactionId)}>Unlink statement evidence</button>
            )}
          </div>
        )}
        {available.length > 0 && (
          <label className="field">
            <span>{transactionId ? "Link a different credit" : "Link a statement credit"}</span>
            <select value={transactionId} onChange={(event) => selectTransaction(event.target.value)}>
              <option value="">Enter manually</option>
              {available.map((transaction) => (
                <option key={transaction.id} value={transaction.id}>{transaction.date} · {transaction.description} · {statementMoney(transaction, transaction.amount)}</option>
              ))}
            </select>
          </label>
        )}
        {selectedTransaction && eligibleAllocationItems.length > 1 && (
          <label className="check-row split-income-toggle">
            <input type="checkbox" checked={splitCredit} onChange={(event) => setSplitCredit(event.target.checked)} />
            <span><strong>Split this credit across income sources</strong><small>Use this when salary and a bonus arrived as one bank deposit.</small></span>
          </label>
        )}
        {splitCredit && selectedTransaction ? (
          <div className="income-allocation-editor">
            <div className="income-allocation-heading">
              <strong>Deposit breakdown</strong>
              <small>{moneyIn(allocationTotal, receivedCurrency)} allocated · {moneyIn(Math.abs(allocationDifference), receivedCurrency)} {allocationDifference >= 0 ? "left" : "over"}</small>
            </div>
            {eligibleAllocationItems.map((target) => (
              <label className="income-allocation-row" key={target.portion.id}>
                <span><strong>{target.portion.label}</strong><small>{target.portion.schedule.frequency === "one_off" ? "One-off income" : "Monthly income"}</small></span>
                <input
                  aria-label={`Allocation for ${target.portion.label}`}
                  type="number"
                  min="0"
                  step="any"
                  value={allocations[target.portion.id] || ""}
                  onChange={(event) => setAllocations((current) => ({ ...current, [target.portion.id]: Math.max(0, Number(event.target.value) || 0) }))}
                />
              </label>
            ))}
            {!allocationBalanced && <p className="field-error" role="alert">Allocations must equal the statement credit before saving.</p>}
          </div>
        ) : (
          <label className="field">
            <span>Amount received ({receivedCurrency})</span>
            <input autoFocus type="number" min="0" step="any" value={amount || ""} onChange={(event) => setAmount(Math.max(0, Number(event.target.value) || 0))} />
          </label>
        )}
        {selectedResolution.conflict && (
          <label className="field">
            <span>Currency received</span>
            <select
              aria-label="Currency received"
              value={receivedCurrency}
              onChange={(event) => {
                const currency = normalizeCurrency(event.target.value, householdCode);
                setReceivedCurrency(currency);
                setRate(fxRateFor(currency, householdCurrency, fxRates) ?? 0);
              }}
            >
              {currencyChoices.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
            </select>
            <small>The account and income source use different currencies. Confirm the currency shown on the statement.</small>
          </label>
        )}
        {foreignReceipt && (
          <label className="field">
            <span>FX rate ({householdCurrency} per {receivedCurrency})</span>
            <input type="number" min="0" step="any" value={rate || ""} onChange={(event) => setRate(Math.max(0, Number(event.target.value) || 0))} />
          </label>
        )}
        <label className="field">
          <span>Date received</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        {!splitCredit && !item.taxWithheld && item.taxRate > 0 && (
          <p className="income-net-caption">
            {foreignReceipt && <>{moneyIn(amount, receivedCurrency)} × {rate || 0} = {money(householdAmount)}. </>}
            {money(net)} counts as available after setting aside {item.taxRate}% tax.
          </p>
        )}
        {foreignReceipt && !splitCredit && (item.taxWithheld || item.taxRate <= 0) && (
          <p className="income-net-caption">{moneyIn(amount, receivedCurrency)} × {rate || 0} = {money(householdAmount)} for household totals.</p>
        )}
        <div className="modal-actions">
          {item.receipt && <Button variant="danger" onClick={removeConfirmation}>Delete income confirmation</Button>}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary"
            disabled={splitCredit ? !allocationBalanced || (foreignReceipt && rate <= 0) : amount <= 0 || (foreignReceipt && rate <= 0)}
            onClick={save}
          >
            {item.receipt ? "Save changes" : "Confirm income"}
          </Button>
        </div>
      </div>
      {pendingConfirmation && (
        <ConfirmDialog
          title={pendingConfirmation.title}
          confirmLabel={pendingConfirmation.confirmLabel}
          onClose={() => setPendingConfirmation(null)}
          onConfirm={() => {
            pendingConfirmation.action();
            setPendingConfirmation(null);
          }}
        >
          <p>{pendingConfirmation.body}</p>
        </ConfirmDialog>
      )}
    </Modal>
  );
}

export function IncomeConfirmModal(props: Parameters<typeof useIncomeConfirmationModel>[0]) {
  return <IncomeConfirmationBody model={useIncomeConfirmationModel(props)} />;
}
