import { monthLabel } from "../domain/dates";
import type { HistoryRow } from "../domain/summary";
import type { EfficiencyPlan } from "../domain/types";
import { Button, Disclosure, EmptyState, MoneyValue } from "./bits";

export function HistoryView({
  rows,
  currentMonth,
  targetSaveRate,
  money,
  percent = (value) => `${value.toFixed(1)}%`,
  financialValuesHidden = false,
  efficiencyPlans,
  onSelectMonth,
}: {
  rows: HistoryRow[];
  currentMonth: string;
  targetSaveRate: number;
  money: (value: number) => string;
  percent?: (value: number, digits?: number) => string;
  financialValuesHidden?: boolean;
  efficiencyPlans: EfficiencyPlan[];
  onSelectMonth?: (month: string) => void;
}) {
  const sorted = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  const chartRows = sorted.slice(-12);
  const best = [...rows].sort((a, b) => b.rate - a.rate || a.month.localeCompare(b.month))[0];
  const current = rows.find((row) => row.month === currentMonth);
  const averageRate = rows.length ? rows.reduce((sum, row) => sum + row.rate, 0) / rows.length : 0;
  const verifiedPlans = efficiencyPlans.filter((plan) => plan.state === "verified" && plan.outcome);
  const currentOutcomes = current
    ? verifiedPlans.filter((plan) => plan.outcome?.month === current.month)
    : [];

  if (!rows.length) {
    return (
      <EmptyState eyebrow="History" title="Your monthly trend starts with activity">
        <p>Import or add transactions to build a month-by-month view.</p>
      </EmptyState>
    );
  }

  return (
    <div className="history-view quiet-history">
      <section className="history-summary" aria-label="History summary">
        <div>
          <span className="soft-label">Selected month</span>
          <strong className={current ? (current.rate >= targetSaveRate ? "good-text" : "bad-text") : ""}>
            {current ? <MoneyValue formatted={percent(current.rate)} hidden={financialValuesHidden} /> : "No data"}
          </strong>
          <p>{current ? `${monthLabel(current.month)} save rate` : `No recorded data for ${monthLabel(currentMonth)}.`}</p>
        </div>
        <div>
          <span className="soft-label">Best month</span>
          <strong>{best ? monthLabel(best.month) : "None"}</strong>
          <p>{best ? <><MoneyValue formatted={percent(best.rate)} hidden={financialValuesHidden} /> save rate</> : "No comparison yet"}</p>
        </div>
        <div>
          <span className="soft-label">Average</span>
          <strong className={averageRate >= targetSaveRate ? "good-text" : "bad-text"}><MoneyValue formatted={percent(averageRate)} hidden={financialValuesHidden} /></strong>
          <p>Target is <MoneyValue formatted={percent(targetSaveRate, 0)} hidden={financialValuesHidden} /></p>
        </div>
      </section>

      <section className="ledger-panel history-ledger history-chart-panel">
        <div className="friendly-heading">
          <div>
            <span className="panel-kicker">Save-rate trend</span>
            <h3>Last {chartRows.length} recorded month{chartRows.length === 1 ? "" : "s"}</h3>
          </div>
          <p>Choose a bar to review that month.</p>
        </div>

        <figure className="history-chart" aria-label={financialValuesHidden ? "Monthly save-rate chart. Financial values hidden." : `Monthly save-rate chart. Target ${percent(targetSaveRate, 0)}.`}>
          <div className="history-chart-plot">
            <div className="history-target-line" style={{ bottom: financialValuesHidden ? "0%" : `${Math.max(0, Math.min(100, targetSaveRate))}%` }}>
              <span>Target <MoneyValue formatted={percent(targetSaveRate, 0)} hidden={financialValuesHidden} /></span>
            </div>
            <div className="history-bars">
              {chartRows.map((row) => (
                <button
                  type="button"
                  className={`history-bar ${row.month === currentMonth ? "selected" : ""} ${row.rate >= targetSaveRate ? "positive" : "negative"}`}
                  aria-label={`${monthLabel(row.month)} save rate ${financialValuesHidden ? "financial value hidden" : percent(row.rate)}${row.month === currentMonth ? ", selected" : ""}`}
                  aria-pressed={row.month === currentMonth}
                  onClick={() => onSelectMonth?.(row.month)}
                  key={row.month}
                >
                  <span className="history-bar-value" style={{ height: financialValuesHidden ? "3%" : `${Math.max(3, Math.min(100, row.rate))}%` }} />
                  <small>{monthLabel(row.month).split(" ")[0]}</small>
                </button>
              ))}
            </div>
          </div>
          <figcaption>Save rate uses confirmed income and recorded spend. The target rule is informational, not a score.</figcaption>
        </figure>
      </section>

      {current ? (
        <section className="ledger-panel selected-month-detail">
          <div className="friendly-heading">
            <div>
              <span className="panel-kicker">Selected record</span>
              <h3>{monthLabel(current.month)}</h3>
            </div>
            <strong className={current.rate >= targetSaveRate ? "good-text" : "bad-text"}><MoneyValue formatted={percent(current.rate)} hidden={financialValuesHidden} /></strong>
          </div>
          <dl className="selected-month-metrics">
            <div><dt>Income</dt><dd><MoneyValue formatted={money(current.income)} hidden={financialValuesHidden} /></dd></div>
            <div><dt>Spend</dt><dd><MoneyValue formatted={money(current.spend)} hidden={financialValuesHidden} /></dd></div>
            <div><dt>Saved</dt><dd><MoneyValue formatted={money(current.saved)} hidden={financialValuesHidden} /></dd></div>
          </dl>
          {(current.oneOffIncome > 0 || current.protectedIncome > 0) && (
            <p className="history-income-notes">
              {current.oneOffIncome > 0 ? <><MoneyValue formatted={money(current.oneOffIncome)} hidden={financialValuesHidden} /> one-off</> : ""}
              {current.oneOffIncome > 0 && current.protectedIncome > 0 ? " · " : ""}
              {current.protectedIncome > 0 ? <><MoneyValue formatted={money(current.protectedIncome)} hidden={financialValuesHidden} /> protected</> : ""}
            </p>
          )}
          {currentOutcomes.length > 0 && (
            <div className="efficiency-history-marker">
              {currentOutcomes.map((plan) => (
                <small key={plan.id}>
                  Efficiency outcome · {plan.subjectLabel}: <MoneyValue formatted={money(plan.outcome!.observedMonthlyReduction)} hidden={financialValuesHidden} /> observed reduction · {plan.outcome!.result.replaceAll("_", " ")}
                </small>
              ))}
              <em>Informational comparison only; not added to saved or save-rate figures.</em>
            </div>
          )}
        </section>
      ) : (
        <EmptyState eyebrow="Selected month" title={`No recorded data for ${monthLabel(currentMonth)}`} compact>
          <p>Choose a recorded month from the chart or add activity to this month.</p>
        </EmptyState>
      )}

      <Disclosure title="Monthly records" summary="Income, spend, saved, and save rate for every recorded month">
        <div className="history-record-list">
          {sorted.map((row) => (
            <Button
              variant="ghost"
              type="button"
              className={`history-record-button ${row.month === currentMonth ? "selected" : ""}`.trim()}
              aria-current={row.month === currentMonth ? "date" : undefined}
              onClick={() => onSelectMonth?.(row.month)}
              key={row.month}
            >
              <strong>{monthLabel(row.month)}</strong>
              <span>Income <MoneyValue formatted={money(row.income)} hidden={financialValuesHidden} /></span>
              <span>Spend <MoneyValue formatted={money(row.spend)} hidden={financialValuesHidden} /></span>
              <span>Saved <MoneyValue formatted={money(row.saved)} hidden={financialValuesHidden} /></span>
              <b className={row.rate >= targetSaveRate ? "good-text" : "bad-text"}><MoneyValue formatted={percent(row.rate)} hidden={financialValuesHidden} /></b>
            </Button>
          ))}
        </div>
      </Disclosure>
    </div>
  );
}
