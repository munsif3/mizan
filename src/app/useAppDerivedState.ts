import { useEffect, useMemo } from "react";
import { transactionDisplayCurrency } from "../domain/accounts";
import { computeAccountCoverage } from "../domain/accountCoverage";
import { detectSharedContributionCandidates } from "../domain/contributions";
import { isoDateOf } from "../domain/dates";
import { computeEfficiencySnapshot } from "../domain/efficiency";
import { detectIncomeCandidates } from "../domain/incomeMatch";
import { formatMoney } from "../domain/money";
import {
  computeHistory,
  computeMonthSummary,
  monthsWithData,
  reviewQueue,
  selectableMonths,
} from "../domain/summary";
import { detectTransferCandidates } from "../domain/transfers";
import type { AppData, Transaction } from "../domain/types";
import { PRIVATE_FINANCIAL_VALUE } from "../ui/bits";
import type { BootstrapPhase } from "./useHouseholdSession";

interface DerivedStateInput {
  data: AppData;
  month: string;
  setMonth: (month: string) => void;
  bootstrapPhase: BootstrapPhase;
  privacy: boolean;
}

export function useAppDerivedState({
  data,
  month,
  setMonth,
  bootstrapPhase,
  privacy,
}: DerivedStateInput) {
  const today = new Date();
  const todayKey = isoDateOf(today);
  const todayMonth = todayKey.slice(0, 7);
  const historyMonths = useMemo(() => monthsWithData(data, today), [data, todayKey]);
  const navigationMonths = useMemo(() => selectableMonths(data, today), [data, todayKey]);
  const monthRangeReady = bootstrapPhase === "ready";
  const currentMonth = month && (!monthRangeReady || navigationMonths.includes(month)) ? month : todayMonth;

  useEffect(() => {
    if (monthRangeReady && month && month !== currentMonth) setMonth(currentMonth);
  }, [currentMonth, month, monthRangeReady, setMonth]);

  const summary = useMemo(() => computeMonthSummary(data, currentMonth, today), [data, currentMonth, todayKey]);
  const completedMonthSummaries = useMemo(
    () => navigationMonths
      .filter((candidate) => candidate < todayMonth)
      .slice(-3)
      .map((candidate) => computeMonthSummary(data, candidate, today)),
    [data, navigationMonths, todayMonth, todayKey],
  );
  const efficiency = useMemo(
    () => computeEfficiencySnapshot(data, currentMonth, today),
    [data, currentMonth, todayKey],
  );
  const queue = useMemo(() => reviewQueue(data.transactions), [data]);
  const history = useMemo(() => computeHistory(data, historyMonths, today), [data, historyMonths, todayKey]);
  const coverageRows = useMemo(
    () => computeAccountCoverage(data.accounts, data.settings.members, today),
    [data.accounts, data.settings.members, todayKey],
  );
  const transferCandidates = useMemo(
    () => detectTransferCandidates(data.transactions, data.accounts, undefined, true),
    [data.transactions, data.accounts],
  );
  const contributionCandidates = useMemo(
    () => detectSharedContributionCandidates(
      data.transactions,
      data.accounts,
      data.settings.members,
      data.sharedContributions,
    ),
    [data.transactions, data.accounts, data.settings.members, data.sharedContributions],
  );
  const incomeCandidates = useMemo(
    () => detectIncomeCandidates(
      data.settings.members,
      data.transactions,
      data.accounts,
      data.incomeReceipts,
      data.settings.currency,
      data.settings.fxRates,
      currentMonth,
    ),
    [
      data.settings.members,
      data.settings.currency,
      data.settings.fxRates,
      data.transactions,
      data.accounts,
      data.incomeReceipts,
      currentMonth,
    ],
  );
  const incomeCandidateMap = useMemo(
    () => new Map(incomeCandidates.map((candidate) => [candidate.portionId, candidate])),
    [incomeCandidates],
  );
  const incomeLinkedIds = useMemo(
    () => new Set(data.incomeReceipts.map((receipt) => receipt.transactionId).filter((id): id is string => Boolean(id))),
    [data.incomeReceipts],
  );
  const money = (value: number) => privacy
    ? PRIVATE_FINANCIAL_VALUE
    : formatMoney(value, { currency: data.settings.currency, locale: data.settings.locale });
  const currencyMoney = (value: number, currency: string) => privacy
    ? PRIVATE_FINANCIAL_VALUE
    : formatMoney(value, { currency, locale: data.settings.locale });
  const transactionMoney = (transaction: Transaction, value: number) => privacy
    ? PRIVATE_FINANCIAL_VALUE
    : formatMoney(value, {
        currency: transactionDisplayCurrency(transaction, data.accounts, data.settings.currency),
        locale: data.settings.locale,
      });
  const percent = (value: number, digits = 1) => privacy ? PRIVATE_FINANCIAL_VALUE : `${value.toFixed(digits)}%`;

  return {
    todayMonth,
    today,
    navigationMonths,
    currentMonth,
    summary,
    completedMonthSummaries,
    efficiency,
    queue,
    history,
    coverageRows,
    transferCandidates,
    contributionCandidates,
    incomeCandidateMap,
    incomeLinkedIds,
    money,
    currencyMoney,
    transactionMoney,
    percent,
  };
}

export type AppDerivedState = ReturnType<typeof useAppDerivedState>;
