import { monthLabel } from "../domain/dates";
import type { PortionResolution } from "../domain/income";
import type { IncomeCandidate } from "../domain/incomeMatch";
import type { SharedContributionCandidate } from "../domain/contributions";
import type { MonthSummary } from "../domain/summary";
import type { Member } from "../domain/types";
import { PersonPanel } from "./bits";

export function HomeView({
  summary,
  money,
  lastCheckInAt,
  onOpenSettings,
  onOpenImport,
  onReviewQueue,
  onCompleteCheckIn,
  onConfirmIncome,
  incomeCandidates,
  contributionCandidates,
  members,
  onConfirmContribution,
}: {
  summary: MonthSummary;
  money: (value: number) => string;
  lastCheckInAt: string;
  onOpenSettings: () => void;
  onOpenImport: () => void;
  onReviewQueue: () => void;
  onCompleteCheckIn: () => void;
  onConfirmIncome: (item: PortionResolution, candidate?: IncomeCandidate) => void;
  incomeCandidates?: Map<string, IncomeCandidate>;
  contributionCandidates?: SharedContributionCandidate[];
  members?: Member[];
  onConfirmContribution?: (candidate: SharedContributionCandidate) => void;
}) {
  const s = summary;
  const candidates = incomeCandidates ?? new Map<string, IncomeCandidate>();
  const contributionSuggestions = contributionCandidates ?? [];
  const householdMembers = members ?? [];
  const onTrack = s.projectedSaveRate >= s.targetSaveRate;
  const hasActivity = s.monthTransactions.length > 0 || s.totalSpend > 0;
  const categoryRows = s.fullCategoryRows.filter((row) => row.value > 0);
  const movementRows = s.movementRows.filter((row) => row.value > 0 || row.delta !== 0);
  const dataNeedsUpdate =
    s.isCurrentMonth && (s.dataAgeDays === null ? s.dayNumber > 3 : s.dataAgeDays >= 7);
  const checkInTimestamp = Date.parse(lastCheckInAt);
  const checkInDays = Number.isFinite(checkInTimestamp)
    ? Math.max(0, Math.floor((Date.now() - checkInTimestamp) / 86_400_000))
    : null;
  const weeklyCheckInDue = s.isCurrentMonth && (checkInDays === null || checkInDays >= 7);
  const checkInReady = !dataNeedsUpdate && s.uncategorizedCount === 0;
  const forecastReady = hasActivity && (!s.isCurrentMonth || !dataNeedsUpdate);
  const freshnessLabel = !s.isCurrentMonth
    ? "Historical month"
    : !s.latestTransactionDate
      ? "No activity yet"
      : s.dataAgeDays === 0
        ? "Current today"
        : s.dataAgeDays === 1
          ? "1 day behind"
          : `${s.dataAgeDays} days behind`;

  const attentionItems = [
    ...contributionSuggestions.map((candidate) => {
      const contributor = householdMembers.find((member) => member.id === candidate.contributorMemberId)?.name ?? "Household member";
      const recovered = candidate.expenses.reduce((sum, expense) => sum + expense.amount, 0);
      return {
        title: `Confirm ${contributor}'s loan contribution`,
        body: `${money(candidate.amount)} moved into ${candidate.credit.account} near ${candidate.expenses.length} recovery deduction${candidate.expenses.length === 1 ? "" : "s"} totalling ${money(recovered)}. Review the transfer pair and recovery group before changing settlement.`,
        action: onConfirmContribution ? <button onClick={() => onConfirmContribution(candidate)}>Review match</button> : <span className="attention-pill">Review</span>,
      };
    }),
    ...s.incomeItems.filter((item) => !item.receipt && (item.status === "overdue" || candidates.has(item.portion.id))).map((item) => ({
      title: `Confirm ${item.portion.label}`,
      body: candidates.has(item.portion.id)
        ? `A matching credit of ${money(candidates.get(item.portion.id)!.amount)} on ${candidates.get(item.portion.id)!.transaction.date} is already in your statement.`
        : `${item.memberName}'s expected income has passed its arrival window. Confirm what actually arrived.`,
      action: <button onClick={() => onConfirmIncome(item, candidates.get(item.portion.id))}>Confirm income</button>,
    })),
    ...s.incomeItems.filter((item) => item.missingRate).map((item) => ({
      title: `Add ${item.portion.currency} exchange rate`,
      body: `${item.portion.label} cannot be included in the projection until its exchange rate is set.`,
      action: <button className="secondary" onClick={onOpenSettings}>Open Settings</button>,
    })),
    ...(dataNeedsUpdate
      ? [
          {
            title: "Bring transactions up to date",
            body: s.latestTransactionDate
              ? `Latest activity is ${s.latestTransactionDate}. Import or add recent transactions before trusting the forecast.`
              : "No transactions are recorded for this month. Import or add activity before trusting the forecast.",
            action: <button onClick={onOpenImport}>Import activity</button>,
          },
        ]
      : []),
    ...(s.uncategorizedCount
      ? [
          {
            title: "Categorize new merchants",
            body: `${s.uncategorizedCount} transaction${s.uncategorizedCount === 1 ? "" : "s"} need categories before the month is trustworthy.`,
            action: <button onClick={onReviewQueue}>Review now</button>,
          },
        ]
      : []),
    ...(weeklyCheckInDue
      ? [
          {
            title: "Complete this week's money check-in",
            body: checkInReady
              ? "The data is current and this month's categories are clean. Record that you reviewed the plan."
              : "Update recent activity and clear this month's review items, then record the check-in.",
            action: checkInReady ? (
              <button onClick={onCompleteCheckIn}>Mark reviewed</button>
            ) : (
              <span className="attention-pill danger">Update first</span>
            ),
          },
        ]
      : []),
    ...s.transfers.map((transfer) => ({
      title: "Settle household balance",
      body: `${transfer.fromName} pays ${transfer.toName}: ${money(transfer.amount)}.`,
      action: <span className="attention-pill">Settlement</span>,
    })),
    ...s.possibleFixedCostDuplicates.map((fixed) => ({
      title: `Check ${fixed.label} for double counting`,
      body: `A ${money(fixed.amount)} transaction in the same category is already in this month. If it is the same payment, remove this fixed cost.`,
      action: <button className="secondary" onClick={onOpenSettings}>Check budget</button>,
    })),
    ...s.endingSoon.map((fixed) => ({
      title: `${fixed.label} ends ${monthLabel(fixed.until ?? "")}`,
      body: `${money(fixed.amount)} per month can be redirected once it ends.`,
      action: <button className="secondary" onClick={onOpenSettings}>Plan it</button>,
    })),
    ...(!onTrack
      ? [
          {
            title: "Save-rate target at risk",
            body: `Projected save rate is below the ${s.targetSaveRate}% target.`,
            action: <span className="attention-pill danger">At risk</span>,
          },
        ]
      : []),
  ];

  if (!s.incomeItems.length) {
    return (
      <section className="home-hero tight onboard">
        <div>
          <span className="soft-label">Setup</span>
          <h2>Start with your income</h2>
          <p>
            Mizan needs each member's income to judge every month against the save-rate target. Add recurring fixed
            costs only for commitments that are not already counted in imported transactions.
          </p>
        </div>
        <div className="hero-meter">
          <button onClick={onOpenSettings}>Open Settings</button>
        </div>
      </section>
    );
  }

  return (
    <div className="household-home">
      <section className={`home-hero ${!forecastReady ? "incomplete" : onTrack ? "good" : "tight"}`}>
        <div>
          <span className="soft-label">{monthLabel(s.month)}</span>
          <h2>
            {!forecastReady
              ? "Add activity to read this month"
              : onTrack
                ? "You have room to stay on track"
                : "This month needs a little care"}
          </h2>
          {forecastReady ? (
            <p>
              At the current pace, you are projected to save <b>{money(s.projectedSaved)}</b>. The shared target
              is a {s.targetSaveRate}% save rate.
            </p>
          ) : (
            <p>
              The forecast is paused until this month has current transactions. Your shared target remains a
              {` ${s.targetSaveRate}%`} save rate.
            </p>
          )}
          <div className="hero-actions">
            {!forecastReady ? (
              <button onClick={onOpenImport}>Import activity</button>
            ) : s.uncategorizedCount ? (
              <button onClick={onReviewQueue}>Review {s.uncategorizedCount}</button>
            ) : (
              <button className="secondary" onClick={onOpenSettings}>Adjust budget</button>
            )}
          </div>
        </div>
        <div className="hero-meter">
          {forecastReady ? (
            <>
              <span>Projected save rate</span>
              <strong>{s.projectedSaveRate.toFixed(1)}%</strong>
              <div className="comfort-track">
                <span style={{ width: `${Math.max(0, Math.min(100, s.projectedSaveRate))}%` }} />
                <i style={{ left: `${s.targetSaveRate}%` }} />
              </div>
            </>
          ) : (
            <>
              <span>Forecast status</span>
              <strong className="forecast-paused">Waiting for activity</strong>
              <p>{s.latestTransactionDate ? `Latest activity: ${s.latestTransactionDate}` : "No transactions recorded yet"}</p>
            </>
          )}
        </div>
      </section>

      <section className="friendly-section income-panel">
        <div className="friendly-heading">
          <div>
            <span className="soft-label">Income</span>
            <h3>Expected and received</h3>
          </div>
          <p>{money(s.incomeTotal)} available after tax</p>
        </div>
        <div className="income-checklist">
          {s.incomeItems.map((item) => {
            const window = item.portion.window;
            const candidate = candidates.get(item.portion.id);
            const statusLabel = item.missingRate
              ? `Missing ${item.portion.currency} rate`
              : item.status === "received"
                ? item.receipt?.transactionId ? "Received · matched" : "Received"
                : item.status === "due"
                  ? `Due day ${window?.startDay}-${window?.endDay}`
                  : item.status === "overdue"
                    ? "Overdue"
                    : item.status === "upcoming"
                      ? `Upcoming day ${window?.startDay}-${window?.endDay}`
                      : "No arrival date";
            return <div className="income-check-row" key={`${item.memberId}-${item.portion.id}`}>
              <span className="color-dot" style={{ background: item.memberColor }} />
              <div>
                <strong>{item.portion.label}</strong>
                <small>{item.memberName}{item.portion.currency ? ` · ${item.portion.currency}` : ""}</small>
                {candidate && <small className="income-match-hint">Matched {candidate.transaction.description} · {candidate.transaction.date}</small>}
              </div>
              <b>{item.missingRate ? `${item.portion.amount} ${item.portion.currency}` : money(item.net)}</b>
              <span className={`income-status ${item.missingRate ? "missing" : item.status}`}>{statusLabel}</span>
              <button className="secondary" onClick={() => onConfirmIncome(item, candidate)}>{item.receipt ? "Edit" : "Confirm"}</button>
            </div>;
          })}
        </div>
      </section>

      {(hasActivity || attentionItems.length > 0) && <section className="friendly-section attention-section">
        <div className="friendly-heading">
          <div>
            <span className="soft-label">Needs attention</span>
            <h3>{attentionItems.length ? "Handle these first" : "No urgent action"}</h3>
          </div>
          <p>
            {!forecastReady
              ? "Forecast paused until the ledger is current."
              : onTrack
                ? "Savings pace is currently on target."
                : "A small adjustment keeps the month readable."}
          </p>
        </div>
        <div className="attention-grid">
          {attentionItems.length ? (
            attentionItems.map((item) => (
              <div className="attention-card" key={`${item.title}-${item.body}`}>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                </div>
                {item.action}
              </div>
            ))
          ) : (
            <div className="attention-card calm">
              <div>
                <strong>Keep watching the pace</strong>
                <p>No stale data, review items, possible double counts, settlement, or ending commitments need action right now.</p>
              </div>
              <span className="attention-pill">Clear</span>
            </div>
          )}
        </div>
      </section>}

      {hasActivity ? (
        <>
      <section className="home-grid plan-grid">
        <div className="home-panel spend-plan">
          <span className="soft-label">Spend plan</span>
          <h3>{money(Math.max(0, s.targetSpend - s.totalSpend))}</h3>
          <p>left for the month before dipping below the savings target.</p>
          <div className="mini-stats">
            <span><b>{money(s.remainingDaily)}</b> / day for {s.daysLeft} days</span>
            <span><b>{money(s.spendPerDay)}</b> / day so far</span>
            <span><b>{money(s.dailyAllowance)}</b> / day keeps the plan comfortable</span>
          </div>
        </div>

        <div className="home-panel top-spend">
          <span className="soft-label">Biggest area</span>
          <h3>{s.topCategory.name}</h3>
          <p>{money(s.topCategory.value)} this month</p>
          <div className="category-swatch" style={{ background: s.topCategory.color }} />
        </div>

        <div className="home-panel">
          <span className="soft-label">Data freshness</span>
          <h3>{freshnessLabel}</h3>
          <p>
            {s.latestTransactionDate ? `Latest activity: ${s.latestTransactionDate}.` : "Add or import this month's activity."}
            {!s.isCurrentMonth
              ? " This is a completed month."
              : checkInDays === null
                ? " Weekly check-in not recorded yet."
                : checkInDays === 0
                  ? " Reviewed today."
                  : ` Reviewed ${checkInDays} day${checkInDays === 1 ? "" : "s"} ago.`}
          </p>
        </div>
      </section>

      <section className="people-grid">
        {s.memberRows.map((row) => (
          <PersonPanel
            key={row.member.id}
            name={row.member.name}
            paid={row.paid}
            personal={row.personal}
            color={row.member.color}
            money={money}
          />
        ))}
        <div className="person-panel shared">
          <span className="soft-label">Shared household</span>
          <h3>{money(s.sharedSpend)}</h3>
          <p>
            Rent, groceries, utilities, transport, health, family, and other shared costs. Fair share is{" "}
            {money(s.fairShare)} each.
          </p>
          {s.transfers.length ? (
            s.transfers.map((t) => (
              <div className="settle-button" key={`${t.fromId}-${t.toId}`}>
                {t.fromName} pays {t.toName}: {money(t.amount)}
              </div>
            ))
          ) : (
            <div className="settle-button settled">No balancing needed</div>
          )}
        </div>
      </section>

      <section className="friendly-section">
        <div className="friendly-heading">
          <div>
            <span className="soft-label">Where the money went</span>
            <h3>Monthly categories</h3>
          </div>
          <p>Total spend: {money(s.totalSpend)}</p>
        </div>
        <div className="friendly-categories">
          {categoryRows.map((row) => (
            <div
              className="friendly-category"
              key={row.key}
              style={{ "--accent": row.color, "--share": `${(row.value / s.maxCategoryValue) * 100}%` } as React.CSSProperties}
            >
              <div>
                <span className="color-dot" />
                <strong>{row.name}</strong>
                <small>{s.totalSpend ? Math.round((row.value / s.totalSpend) * 100) : 0}%</small>
              </div>
              <div className="friendly-bar"><span /></div>
              <b>{money(row.value)}</b>
            </div>
          ))}
        </div>
      </section>

      {(movementRows.length > 0 || s.monthFixed.length > 0) && <section className="two-column">
        {movementRows.length > 0 && (
        <div className="friendly-section">
          <div className="friendly-heading">
            <div>
              <span className="soft-label">What changed</span>
              <h3>{s.previousMonth ? `Compared with ${monthLabel(s.previousMonth)}` : "Starting point"}</h3>
            </div>
          </div>
          <div className="change-list">
            {movementRows.map((row) => (
              <div key={row.key}>
                <span className="color-dot" style={{ background: row.color }} />
                <p>
                  <b>{row.name}</b>
                  <small>{row.delta >= 0 ? "up" : "down"} {money(Math.abs(row.delta))}</small>
                </p>
                <strong>{money(row.value)}</strong>
              </div>
            ))}
          </div>
        </div>
        )}

        {s.monthFixed.length > 0 && (
        <div className="friendly-section">
          <div className="friendly-heading">
            <div>
              <span className="soft-label">Monthly commitments</span>
              <h3>Fixed costs</h3>
            </div>
          </div>
          <div className="fixed-list">
            {s.monthFixed.map((fixed) => (
              <div key={fixed.id}>
                <span>{fixed.label}</span>
                <strong>{money(fixed.amount)}</strong>
                <small>{fixed.until ? `ends ${monthLabel(fixed.until)}` : "ongoing"}</small>
              </div>
            ))}
          </div>
        </div>
        )}
      </section>}
        </>
      ) : (
        <section className="ledger-empty-state">
          <span className="soft-label">The ledger is ready</span>
          <h3>Start with this month's activity</h3>
          <p>
            Once transactions arrive, this page will show your spending room, household balance, categories, and
            month-to-month changes without filling the page with zero-value panels.
          </p>
        </section>
      )}
    </div>
  );
}
