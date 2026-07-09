import { monthLabel } from "../domain/dates";
import type { MonthSummary } from "../domain/summary";
import { PersonPanel } from "./bits";

export function HomeView({
  summary,
  money,
  onOpenSettings,
}: {
  summary: MonthSummary;
  money: (value: number) => string;
  onOpenSettings: () => void;
}) {
  const s = summary;
  const onTrack = s.projectedSaveRate >= s.targetSaveRate;

  const reviewItems = [
    s.uncategorizedCount
      ? `${s.uncategorizedCount} transaction${s.uncategorizedCount === 1 ? "" : "s"} need categories`
      : "",
    ...s.transfers.map((t) => `${t.fromName} pays ${t.toName}: ${money(t.amount)}`),
    ...s.endingSoon.map(
      (fixed) =>
        `${fixed.label} (${money(fixed.amount)}/mo) ends ${monthLabel(fixed.until ?? "")} — decide where that money goes next`,
    ),
    onTrack ? "Savings pace is still on target" : `Spend pace is above the ${s.targetSaveRate}% save-rate target`,
  ].filter(Boolean);

  if (!s.incomeTotal) {
    return (
      <section className="home-hero tight onboard">
        <div>
          <span className="soft-label">Setup</span>
          <h2>Start with your income</h2>
          <p>
            Mizan needs each member's income and your fixed costs to judge every month against the save-rate target.
            Add them once in Settings — or import a JSON backup and everything carries over.
          </p>
        </div>
        <div className="hero-meter">
          <button onClick={onOpenSettings}>Open Settings</button>
        </div>
      </section>
    );
  }

  return (
    <div className="couple-home">
      <section className={`home-hero ${onTrack ? "good" : "tight"}`}>
        <div>
          <span className="soft-label">{monthLabel(s.month)}</span>
          <h2>{onTrack ? "You are on track this month" : "This month needs a little care"}</h2>
          <p>
            At the current pace, you are projected to save <b>{money(s.projectedSaved)}</b>. The shared target
            is a {s.targetSaveRate}% save rate.
          </p>
        </div>
        <div className="hero-meter">
          <span>Projected save rate</span>
          <strong>{s.projectedSaveRate.toFixed(1)}%</strong>
          <div className="comfort-track">
            <span style={{ width: `${Math.max(0, Math.min(100, s.projectedSaveRate))}%` }} />
            <i style={{ left: `${s.targetSaveRate}%` }} />
          </div>
        </div>
      </section>

      <section className="home-grid">
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

        <div className="home-panel talk-list">
          <span className="soft-label">Quick check-in</span>
          <h3>Worth a two-minute chat</h3>
          <ul>
            {reviewItems.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>

        <div className="home-panel top-spend">
          <span className="soft-label">Biggest area</span>
          <h3>{s.topCategory.name}</h3>
          <p>{money(s.topCategory.value)} this month</p>
          <div className="category-swatch" style={{ background: s.topCategory.color }} />
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
            Rent, transport, food, family, investments, and other shared costs. Fair share is{" "}
            {money(s.fairShare)} each.
          </p>
          {s.transfers.length ? (
            s.transfers.map((t) => (
              <button className="settle-button" key={`${t.fromId}-${t.toId}`}>
                {t.fromName} pays {t.toName}: {money(t.amount)}
              </button>
            ))
          ) : (
            <button className="settle-button settled">No balancing needed</button>
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
          {s.fullCategoryRows.map((row) => (
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

      <section className="two-column">
        <div className="friendly-section">
          <div className="friendly-heading">
            <div>
              <span className="soft-label">What changed</span>
              <h3>{s.previousMonth ? `Compared with ${monthLabel(s.previousMonth)}` : "Starting point"}</h3>
            </div>
          </div>
          <div className="change-list">
            {s.movementRows.map((row) => (
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
            {!s.monthFixed.length && <p className="muted">No fixed costs yet — add rent, loans, and standing payments in Settings.</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
