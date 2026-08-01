import type { CSSProperties } from "react";
import { type AccountCoverageRow } from "../domain/accountCoverage";
import { monthLabel } from "../domain/dates";
import { BalanceInstrument } from "./BalanceInstrument";
import { Button, MoneyValue } from "./bits";
import { useHomeViewModel, type HomeViewModel, type HomeViewProps } from "./HomeView";
import type { HomeActionFamily } from "./homeActions";
import { WeeklyRitualCard } from "./WeeklyClose";

const MEASUREMENT_BLOCKERS = new Set<HomeActionFamily>([
  "account_coverage",
  "income_currency_review",
  "missing_exchange_rate",
  "recent_activity",
]);

function fullMonthLabel(month: string): string {
  const [year, rawMonth] = month.split("-").map(Number);
  if (!year || !rawMonth) return monthLabel(month);
  return new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, rawMonth - 1, 1)));
}

function readableDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function ordinal(day: number): string {
  const remainder = day % 100;
  if (remainder >= 11 && remainder <= 13) return `${day}th`;
  if (day % 10 === 1) return `${day}st`;
  if (day % 10 === 2) return `${day}nd`;
  if (day % 10 === 3) return `${day}rd`;
  return `${day}th`;
}

export function BalanceConfidenceChip({
  rows,
  hasActivity,
  title,
  onClick,
}: {
  rows: AccountCoverageRow[];
  hasActivity: boolean;
  title: string;
  onClick: () => void;
}) {
  const current = rows.filter((row) => row.status === "current").length;
  const state = !hasActivity ? "empty" : current === rows.length ? "full" : "partial";
  const label = state === "empty"
    ? "Not yet measured"
    : state === "full"
      ? "Fully measured"
      : `Partly measured · ${current} of ${rows.length} accounts`;

  return (
    <button
      type="button"
      className={`balance-confidence-chip ${state}`}
      title={title}
      onClick={onClick}
    >
      {state === "partial" && <span className="balance-confidence-dot" aria-hidden="true" />}
      {label}
    </button>
  );
}

function Segment({
  className,
  label,
  value,
  income,
  money,
  hidden,
}: {
  className: string;
  label: string;
  value: number;
  income: number;
  money: (value: number) => string;
  hidden: boolean;
}) {
  const width = income > 0 ? Math.max(0, Math.min(100, value / income * 100)) : 0;
  const showLabel = width >= 9;
  return (
    <div
      role="img"
      aria-label={`${label}: ${hidden ? "financial value hidden" : money(value)}`}
      className={`accounted-segment ${className}${showLabel ? "" : " compact"}`}
      style={{ "--segment-width": `${width}%` } as CSSProperties}
    >
      {showLabel && (
        <>
          <span>{label}</span>
          <strong><MoneyValue formatted={money(value)} hidden={hidden} /></strong>
        </>
      )}
    </div>
  );
}

function AccountedForBar({ model }: { model: HomeViewModel }) {
  const { s, hasActivity, measurementExposure: exposure, money, financialValuesHidden } = model;
  const overPlan = Math.max(0, s.totalSpend - s.targetSpend);
  const spent = Math.max(0, s.attribution.recordedSpend);
  const saved = Math.max(0, s.projectedSaved);
  const plannedLeft = Math.max(0, Math.max(0, s.targetSpend - s.totalSpend) - exposure.amount);
  const leftInPlan = Math.max(
    0,
    plannedLeft + (s.incomeTotal - spent - exposure.amount - plannedLeft - saved),
  );
  const exposureWidth = s.incomeTotal > 0
    ? Math.max(0, Math.min(100, exposure.amount / s.incomeTotal * 100))
    : 0;

  return (
    <section className="accounted-card" aria-label="Income accounted for">
      <span className="mz-eyebrow">
        <MoneyValue formatted={money(s.incomeTotal)} hidden={financialValuesHidden} /> income, accounted for
      </span>
      {!hasActivity ? (
        <div className="accounted-bar entirely-unmeasured">
          <span className="sr-only">No activity has been measured</span>
          <div className="accounted-segment unmeasured full" />
        </div>
      ) : overPlan > 0 ? (
        <div className="accounted-bar over-plan">
          <div className="accounted-segment danger full">
            <span>Over the plan by</span>
            <strong><MoneyValue formatted={money(overPlan)} hidden={financialValuesHidden} /></strong>
          </div>
        </div>
      ) : (
        <div className="accounted-bar">
          <Segment
            className="spent"
            label="Spent"
            value={spent}
            income={s.incomeTotal}
            money={money}
            hidden={financialValuesHidden}
          />
          {exposure.amount > 0 && (
            <div
              role="img"
              aria-label="Unmeasured spending bound"
              className="accounted-segment unmeasured"
              style={{ "--segment-width": `${exposureWidth}%` } as CSSProperties}
            />
          )}
          <Segment
            className="left-in-plan"
            label="Left in plan"
            value={leftInPlan}
            income={s.incomeTotal}
            money={money}
            hidden={financialValuesHidden}
          />
          <Segment
            className="saved"
            label="Saved"
            value={saved}
            income={s.incomeTotal}
            money={money}
            hidden={financialValuesHidden}
          />
        </div>
      )}
      <div className="accounted-legend">
        <span className="accounted-hollow-swatch" aria-hidden="true" />
        <span>
          The empty box is spending Mizan believes exists but has <strong>not read</strong>. It is drawn hollow on
          purpose — it is never filled in with an estimate.
        </span>
      </div>
    </section>
  );
}

function Verdict({ model }: { model: HomeViewModel }) {
  const {
    s, solo, hasActivity, money, financialValuesHidden, measurementExposure: exposure, dataNeedsUpdate: behind,
  } = model;
  const promised = s.incomeTotal * s.targetSaveRate / 100;
  const exposedAccount = exposure.accounts[0];
  const missingBasis = exposure.accounts.some((row) => row.status === "missing");

  return (
    <div className="balance-verdict">
      <h1 className="mz-display-xl">
        {!hasActivity ? (
          <>{fullMonthLabel(s.month)} hasn&apos;t been measured yet.</>
        ) : (
          <>
            You&apos;ve saved{" "}
            <MoneyValue className="balance-saved-value" formatted={money(s.projectedSaved)} hidden={financialValuesHidden} />
            {" "}of the{" "}
            <MoneyValue className="balance-promised-value" formatted={money(promised)} hidden={financialValuesHidden} />
            {" "}you promised {solo ? "yourself" : "each other"}.
          </>
        )}
      </h1>
      {hasActivity && (
        <p className="balance-boundary mz-body-l">
          Measured, not projected — every rupee above traces to a statement line dated on or before{" "}
          <strong>{readableDate(s.latestTransactionDate)}</strong>.
          {behind && exposedAccount && (
            <>
              {" "}{exposedAccount.ownerLabel}&apos;s {exposedAccount.account.label}{" "}
              {exposedAccount.status === "missing"
                ? "has never been confirmed"
                : `hasn't been read since the ${ordinal(Number(exposedAccount.throughDate.slice(8, 10)))}`}
              , so {missingBasis ? "at least" : "up to"}{" "}
              <strong className="balance-exposure-value">
                <MoneyValue formatted={money(exposure.amount)} hidden={financialValuesHidden} />
              </strong>{" "}
              of spending may still be missing.
            </>
          )}
          {behind && !exposedAccount && " Recent account activity may still be missing."}
        </p>
      )}
    </div>
  );
}

function NextActionCard({
  model,
  onOpenBooks,
}: {
  model: HomeViewModel;
  onOpenBooks: () => void;
}) {
  const action = model.attentionItems.find((item) => item.family !== "weekly_check_in");
  if (!action) {
    return (
      <section className="balance-action-card calm">
        <span className="mz-eyebrow">Checked</span>
        <h2 className="mz-display-m">Nothing is waiting.</h2>
        <p className="mz-body">
          Account coverage, statement activity, new items, income confirmations, settle-up, and commitments are clear.
        </p>
        <div className="balance-action-buttons">
          <Button variant="secondary" onClick={onOpenBooks}>Open the books</Button>
        </div>
      </section>
    );
  }

  const blocksMeasurement = MEASUREMENT_BLOCKERS.has(action.family);
  return (
    <section
      className={`balance-action-card ${blocksMeasurement ? "blocking" : ""}`}
      data-action-count={action.count}
      data-action-family={action.family}
    >
      <div className="balance-action-meta">
        <span className="mz-eyebrow">{blocksMeasurement ? "Make it measured" : "Do this next"}</span>
        <span className="balance-time-pill">{action.estimateMinutes} min</span>
      </div>
      <h2 className="mz-display-m">{action.title}</h2>
      <p className="mz-body">{action.body}</p>
      <div className="balance-action-buttons">
        {action.target.kind === "button" && (
          <Button variant="primary" onClick={action.target.onSelect}>{action.target.label}</Button>
        )}
        <Button variant="secondary" onClick={onOpenBooks}>Open the books</Button>
      </div>
    </section>
  );
}

function SettleUpCard({
  model,
  onOpenBooks,
}: {
  model: HomeViewModel;
  onOpenBooks: () => void;
}) {
  if (model.solo) return null;
  const transfers = [...model.s.transfers].sort((left, right) => right.amount - left.amount);
  const transfer = transfers[0];
  return (
    <section className="balance-settle-card">
      <span className="mz-eyebrow">Between you</span>
      {transfer ? (
        <>
          <p className="mz-display-s">
            {transfer.fromName} owes {transfer.toName}{" "}
            <strong><MoneyValue formatted={model.money(transfer.amount)} hidden={model.financialValuesHidden} /></strong>.
          </p>
          <p className="mz-body-s">
            This comes from recorded responsibility and who actually paid. Settling later writes a transfer to the
            ledger — it doesn&apos;t alter either month.
          </p>
          <div className="balance-settle-actions">
            {model.onMarkSettled && (
              <Button variant="primary" onClick={() => void model.onMarkSettled!(transfer)}>Mark settled</Button>
            )}
            <Button variant="secondary" onClick={onOpenBooks}>See the working</Button>
            {model.canUndoLastSettlement && model.onUndoLastSettlement && (
              <button type="button" className="link-button" onClick={() => void model.onUndoLastSettlement!()}>
                Undo last settlement
              </button>
            )}
            {transfers.length > 1 && (
              <button type="button" className="link-button" onClick={onOpenBooks}>+{transfers.length - 1} more</button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="mz-display-s">You two are square.</p>
          {model.canUndoLastSettlement && model.onUndoLastSettlement && (
            <div className="balance-settle-actions">
              <button type="button" className="link-button" onClick={() => void model.onUndoLastSettlement!()}>
                Undo last settlement
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function BalanceContent({
  model,
  onOpenBooks,
}: {
  model: HomeViewModel;
  onOpenBooks: () => void;
}) {
  const { s, onOpenSettings, weeklyClose, onOpenWeeklyClose } = model;
  if (!s.incomeItems.length) {
    return (
      <section className="balance-onboarding">
        <span className="mz-eyebrow">Setup</span>
        <h1 className="mz-display-l">Start with your income</h1>
        <p className="mz-body-l">
          Add the income you can actually plan with. Mizan will use it to measure this month against the promise you set.
        </p>
        <Button
          variant="primary"
          onClick={() => onOpenSettings({ tab: "household", section: "income" })}
        >
          Add income
        </Button>
      </section>
    );
  }

  return (
    <main className="balance-view">
      <div className="balance-main">
        <Verdict model={model} />
        <BalanceInstrument
          summary={model.s}
          history={model.history}
          money={model.money}
          percent={model.percent}
          financialValuesHidden={model.financialValuesHidden}
        />
        <AccountedForBar model={model} />
      </div>
      {weeklyClose && onOpenWeeklyClose && (
        <div className="balance-ritual-row">
          <WeeklyRitualCard state={weeklyClose} onContinue={onOpenWeeklyClose} />
        </div>
      )}
      <div className={`balance-action-row${model.solo ? " solo" : ""}`}>
        <NextActionCard model={model} onOpenBooks={onOpenBooks} />
        <SettleUpCard model={model} onOpenBooks={onOpenBooks} />
      </div>
    </main>
  );
}

export function BalanceView({
  onOpenBooks,
  ...props
}: HomeViewProps & {
  onOpenBooks: () => void;
}) {
  return <BalanceContent model={useHomeViewModel(props)} onOpenBooks={onOpenBooks} />;
}
