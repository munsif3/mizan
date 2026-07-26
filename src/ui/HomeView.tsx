import { useState, type CSSProperties } from "react";
import { ChevronDown } from "lucide-react";
import type { SettingsTarget } from "../app/settingsTarget";
import { computeAccountCoverage, coverageLabel, type AccountCoverageRow } from "../domain/accountCoverage";
import { assetTypeLabel } from "../domain/assets";
import { commitmentExpectedAmount, commitmentMatchedTransactions } from "../domain/commitments";
import { monthLabel } from "../domain/dates";
import type { PortionResolution } from "../domain/income";
import type { IncomeCandidate } from "../domain/incomeMatch";
import type { SharedContributionCandidate } from "../domain/contributions";
import type { EfficiencySnapshot } from "../domain/efficiency";
import type { MonthSummary } from "../domain/summary";
import type { Account, CategoryKey, EfficiencyOpportunity, Member, MemberId } from "../domain/types";
import { Button, Disclosure, DrilldownAmount, MoneyValue } from "./bits";
import {
  HOME_ACTION_PRIORITY,
  rankHomeActions,
  type AppActionTarget,
  type HomeAction,
} from "./homeActions";
export interface HomeTransactionFilters {
  category?: CategoryKey;
  beneficiary?: "household" | "unassigned" | MemberId;
  payer?: MemberId | "joint";
  merchant?: string;
}

type Attribution = MonthSummary["attribution"];
type AttributionPurposeRow = Attribution["purposeRows"][number];
type AttributionMemberRow = Attribution["memberRows"][number];

function openTarget(
  onOpenTransactions: ((filters: HomeTransactionFilters) => void) | undefined,
  filters: HomeTransactionFilters,
) {
  return onOpenTransactions ? () => onOpenTransactions(filters) : undefined;
}

function efficiencyTitle(kind: EfficiencyOpportunity["kind"]): string {
  if (kind === "recurring_value_check") return "Check the value";
  if (kind === "questionable_recurring") return "Questionable recurring cost";
  if (kind === "recurring_price_increase") return "Recurring price increase";
  if (kind === "category_above_baseline") return "Above your baseline";
  if (kind === "commitment_ending") return "Money becoming available";
  return "Outcome ready to verify";
}

function efficiencyFilters(opportunity: EfficiencyOpportunity): HomeTransactionFilters {
  const beneficiary = opportunity.subject.beneficiary.type === "member"
    ? opportunity.subject.beneficiary.memberId
    : opportunity.subject.beneficiary.type;
  return {
    category: opportunity.subject.category,
    beneficiary,
    ...(opportunity.subject.type === "merchant" ? { merchant: opportunity.subject.merchantKey } : {}),
  };
}

function EfficiencySection({
  snapshot,
  money,
  percent,
  financialValuesHidden,
  onReview,
  onVerify,
  onOpenTransactions,
  hasActivePlan,
}: {
  snapshot: EfficiencySnapshot;
  money: (value: number) => string;
  percent: (value: number, digits?: number) => string;
  financialValuesHidden: boolean;
  onReview: (opportunity: EfficiencyOpportunity) => void;
  onVerify: (opportunity: EfficiencyOpportunity) => void;
  onOpenTransactions?: (filters: HomeTransactionFilters) => void;
  hasActivePlan: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? snapshot.opportunities : snapshot.topOpportunities;
  return (
    <section className="friendly-section efficiency-section">
      <div className="friendly-heading efficiency-heading">
        <div>
          <span className="soft-label">Efficiency opportunities</span>
          <h3>{snapshot.opportunities.length ? "Improve costs without losing what matters" : "Watching for useful changes"}</h3>
        </div>
        <div className="efficiency-readiness">
          <span className={`attention-pill ${snapshot.readiness === "ready" ? "" : "danger"}`}>{snapshot.readiness.replaceAll("_", " ")}</span>
          <p>{snapshot.readinessReason}</p>
          {snapshot.targetGap > 0 && <strong><MoneyValue formatted={money(snapshot.targetGap)} hidden={financialValuesHidden} /> projected target gap</strong>}
        </div>
      </div>

      {visible.length ? (
        <div className="efficiency-grid">
          {visible.map((opportunity) => {
            const verification = opportunity.kind === "verification_due";
            const ending = opportunity.kind === "commitment_ending";
            const valueCheck = opportunity.kind === "recurring_value_check";
            return (
              <article className={`efficiency-card ${verification ? "verification" : ""}`} key={opportunity.fingerprint}>
                <div className="efficiency-card-heading">
                  <span className="soft-label">{efficiencyTitle(opportunity.kind)}</span>
                  <span className="efficiency-confidence">{opportunity.confidence} confidence</span>
                </div>
                <h4>{opportunity.subjectLabel}</h4>
                <p>{opportunity.evidence[0]}</p>
                <div className="efficiency-impact">
                  <span>{verification ? "Observed reduction" : ending ? "Could release" : valueCheck ? "Current monthly cost" : "Estimated monthly saving"}</span>
                  <strong><MoneyValue formatted={money(verification ? opportunity.observedMonthlyReduction ?? 0 : valueCheck ? opportunity.currentMonthlyCost : opportunity.estimatedMonthlySavings)} hidden={financialValuesHidden} /></strong>
                </div>
                {!valueCheck && opportunity.estimatedMonthlySavings > 0 && (
                  <div className="efficiency-metrics">
                    <span><MoneyValue formatted={money(opportunity.estimatedAnnualSavings)} hidden={financialValuesHidden} /> annual estimate</span>
                    {opportunity.saveRatePoints > 0 && <span>{!financialValuesHidden && "+"}<MoneyValue formatted={percent(opportunity.saveRatePoints)} hidden={financialValuesHidden} /> save-rate points</span>}
                    {opportunity.targetGapCoverage > 0 && <span><MoneyValue formatted={percent(opportunity.targetGapCoverage, 0)} hidden={financialValuesHidden} /> of target gap</span>}
                  </div>
                )}
                {opportunity.substitutionWarning && <p className="efficiency-warning">Possible same-category substitution needs review.</p>}
                <div className="efficiency-actions">
                  <Button variant="primary" onClick={() => verification ? onVerify(opportunity) : onReview(opportunity)}>
                    {verification ? "Verify outcome" : "Review opportunity"}
                  </Button>
                  {onOpenTransactions && opportunity.subject.type !== "fixed_cost" && (
                    <Button variant="secondary" onClick={() => onOpenTransactions(efficiencyFilters(opportunity))}>Open evidence</Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="efficiency-empty">
          <strong>
            {hasActivePlan
              ? "An active plan is in progress"
              : snapshot.readiness === "ready" ? "No material opportunity is active" : "Recommendations are deliberately paused"}
          </strong>
          <p>
            {hasActivePlan
              ? "Mizan will surface the plan here when its target month is ready for verification."
              : snapshot.readiness === "ready"
                ? "Mizan will surface a change when the evidence clears the materiality threshold."
                : snapshot.readinessReason}
          </p>
        </div>
      )}

      {snapshot.opportunities.length > 3 && (
        <button className="link-button efficiency-expand" onClick={() => setExpanded((current) => !current)}>
          {expanded ? "Show top three" : `See all ${snapshot.opportunities.length} opportunities`}
        </button>
      )}
    </section>
  );
}

function PurposeMatrix({
  attribution,
  money,
  onOpenTransactions,
  solo,
}: {
  attribution: Attribution;
  money: (value: number) => string;
  onOpenTransactions?: (filters: HomeTransactionFilters) => void;
  solo: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<CategoryKey>>(() => new Set());
  const members = attribution.memberRows.map((row) => row.member);
  // A one-member household has no beneficiary split, so the matrix is purpose x total.
  const columns = solo ? 1 : members.length + 3;
  const matrixStyle = { "--who-columns": columns } as CSSProperties;

  const toggle = (key: CategoryKey) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const amountCell = (
    row: AttributionPurposeRow,
    value: number,
    columnLabel: string,
    filters: HomeTransactionFilters,
    hideWhenZero = true,
  ) => (
    <div className={`who-matrix-cell ${hideWhenZero && value === 0 ? "is-zero" : ""}`} role="cell" data-label={columnLabel}>
      <DrilldownAmount
        value={value}
        money={money}
        label={`${row.name}, ${columnLabel}`}
        onClick={openTarget(onOpenTransactions, { category: row.key, ...filters })}
      />
    </div>
  );

  if (!attribution.purposeRows.length) {
    return (
      <div className="ledger-empty-state compact">
        <span className="soft-label">No recorded activity</span>
        <h3>Only planning commitments are present</h3>
        <p>Imported or manually entered spending will appear here by purpose and who it was for.</p>
      </div>
    );
  }

  return (
    <div className="spending-matrix" role="table" aria-label="Spending by purpose and who it was for" style={matrixStyle}>
      <div className="who-matrix-header" role="row">
        <span role="columnheader">What for</span>
        {!solo && <span role="columnheader">Household</span>}
        {!solo && members.map((member) => <span role="columnheader" key={member.id}>{member.name}</span>)}
        {!solo && <span role="columnheader">Unassigned</span>}
        <span role="columnheader">Total</span>
      </div>

      {attribution.purposeRows.map((row) => {
        const isExpanded = expanded.has(row.key);
        const driversId = `purpose-drivers-${row.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
        return (
          <div className={`who-purpose-group ${isExpanded ? "expanded" : ""}`} role="rowgroup" key={row.key}>
            <div className="who-matrix-row" role="row">
              <div className="who-purpose-cell" role="rowheader">
                <button
                  type="button"
                  className="purpose-toggle"
                  aria-expanded={isExpanded}
                  aria-controls={driversId}
                  onClick={() => toggle(row.key)}
                >
                  <span className="color-dot" style={{ background: row.color }} />
                  <span>
                    <strong>{row.name}</strong>
                    <small>{row.merchants.length} merchant{row.merchants.length === 1 ? "" : "s"}</small>
                  </span>
                  <ChevronDown size={18} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
              {!solo && amountCell(row, row.household, "Household", { beneficiary: "household" })}
              {!solo && members.map((member) => (
                <div className={`who-matrix-cell ${(row.byMember[member.id] ?? 0) === 0 ? "is-zero" : ""}`} role="cell" data-label={member.name} key={member.id}>
                  <DrilldownAmount
                    value={row.byMember[member.id] ?? 0}
                    money={money}
                    label={`${row.name}, ${member.name}`}
                    onClick={openTarget(onOpenTransactions, { category: row.key, beneficiary: member.id })}
                  />
                </div>
              ))}
              {!solo && amountCell(row, row.unassigned, "Unassigned", { beneficiary: "unassigned" })}
              {amountCell(row, row.total, "Total", {}, false)}
            </div>

            {isExpanded && (
              <div className="purpose-drivers" id={driversId}>
                <span className="purpose-drivers-label">Largest merchants</span>
                {row.merchants.slice(0, 4).map((merchant) => (
                  <div className="purpose-driver-row" style={matrixStyle} key={merchant.merchant}>
                    <span>{merchant.merchant}</span>
                    {!solo && <span className={`purpose-driver-amount ${merchant.household === 0 ? "is-zero" : ""}`} data-label="Household">
                      <DrilldownAmount
                        value={merchant.household}
                        money={money}
                        label={`${merchant.merchant}, ${row.name}, Household`}
                        onClick={openTarget(onOpenTransactions, { category: row.key, beneficiary: "household", merchant: merchant.merchant })}
                      />
                    </span>}
                    {!solo && members.map((member) => (
                      <span className={`purpose-driver-amount ${(merchant.byMember[member.id] ?? 0) === 0 ? "is-zero" : ""}`} data-label={member.name} key={member.id}>
                        <DrilldownAmount
                          value={merchant.byMember[member.id] ?? 0}
                          money={money}
                          label={`${merchant.merchant}, ${row.name}, ${member.name}`}
                          onClick={openTarget(onOpenTransactions, { category: row.key, beneficiary: member.id, merchant: merchant.merchant })}
                        />
                      </span>
                    ))}
                    {!solo && <span className={`purpose-driver-amount ${merchant.unassigned === 0 ? "is-zero" : ""}`} data-label="Unassigned">
                      <DrilldownAmount
                        value={merchant.unassigned}
                        money={money}
                        label={`${merchant.merchant}, ${row.name}, Unassigned`}
                        onClick={openTarget(onOpenTransactions, { category: row.key, beneficiary: "unassigned", merchant: merchant.merchant })}
                      />
                    </span>}
                    <span className="purpose-driver-amount" data-label="Total">
                      <DrilldownAmount
                        value={merchant.total}
                        money={money}
                        label={`${merchant.merchant}, ${row.name}, Total`}
                        onClick={openTarget(onOpenTransactions, { category: row.key, merchant: merchant.merchant })}
                      />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ResponsibilityCard({
  row,
  money,
  onOpenTransactions,
}: {
  row: AttributionMemberRow;
  money: (value: number) => string;
  onOpenTransactions?: (filters: HomeTransactionFilters) => void;
}) {
  const settled = Math.abs(row.settlementNet) < 0.01;
  const settlementLabel = settled
    ? "No balancing needed"
    : row.settlementNet > 0
      ? "To receive in settle-up"
      : "To pay in settle-up";
  const settlementExplanation = settled
    ? "No member-to-member balancing is needed for the attributable settlement pool."
    : row.settlementNet > 0
      ? `${row.member.name} fronted more of the member-funded settlement pool.`
      : `Other members fronted part of ${row.member.name}'s settlement share.`;

  return (
    <article className="responsibility-card" style={{ "--person": row.member.color } as CSSProperties}>
      <header>
        <span className="soft-label">{row.member.name}</span>
        <p>Recorded responsibility</p>
        <h4>{money(row.recordedResponsibility)}</h4>
      </header>
      <dl className="responsibility-breakdown">
        <div>
          <dt>Personal spending</dt>
          <dd>
            <DrilldownAmount
              value={row.personalSpend}
              money={money}
              label={`${row.member.name}'s personal spending`}
              onClick={openTarget(onOpenTransactions, { beneficiary: row.member.id })}
            />
          </dd>
        </div>
        <div>
          <dt>Equal share of common spending</dt>
          <dd>
            <DrilldownAmount
              value={row.sharedResponsibility}
              money={money}
              label={`${row.member.name}'s common spending share`}
              onClick={openTarget(onOpenTransactions, { beneficiary: "household" })}
            />
          </dd>
        </div>
        <div className="responsibility-divider">
          <dt>Paid from their accounts</dt>
          <dd>
            <DrilldownAmount
              value={row.amountFronted}
              money={money}
              label={`Spending paid from ${row.member.name}'s accounts`}
              onClick={openTarget(onOpenTransactions, { payer: row.member.id })}
            />
          </dd>
        </div>
        <div>
          <dt>Shared costs they fronted</dt>
          <dd>{money(row.sharedFronted)}</dd>
        </div>
        <div>
          <dt>Personal costs fronted for others</dt>
          <dd>{money(row.personalFrontedForOthers)}</dd>
        </div>
      </dl>
      <div className={`settlement-statement ${settled ? "settled" : row.settlementNet > 0 ? "credit" : "debit"}`}>
        <span>{settlementLabel}</span>
        <strong>{settled ? "—" : money(Math.abs(row.settlementNet))}</strong>
        <small>{settlementExplanation}</small>
      </div>
      {onOpenTransactions && (
        <div className="responsibility-actions">
          <Button
            variant="secondary"
            aria-label={`View ${row.member.name}'s spending`}
            onClick={() => onOpenTransactions({ beneficiary: row.member.id })}
          >
            View spending
          </Button>
          <Button
            variant="secondary"
            aria-label={`View payments made by ${row.member.name}`}
            onClick={() => onOpenTransactions({ payer: row.member.id })}
          >
            View payments
          </Button>
        </div>
      )}
    </article>
  );
}

interface HomeDetailModel {
  summary: MonthSummary;
  money: (value: number) => string;
  percent: (value: number, digits?: number) => string;
  financialValuesHidden: boolean;
  solo: boolean;
  onOpenTransactions?: (filters: HomeTransactionFilters) => void;
  efficiency?: EfficiencySnapshot;
  hasActiveEfficiencyPlan: boolean;
  onReviewEfficiency?: (opportunity: EfficiencyOpportunity) => void;
  onVerifyEfficiency?: (opportunity: EfficiencyOpportunity) => void;
  hasActivity: boolean;
  fixedCommitmentsNeedReview: boolean;
  onOpenSettings: (target?: SettingsTarget) => void;
  freshnessLabel: string;
  checkInDays: number | null;
  movementRows: MonthSummary["movementRows"];
  coverageRows: AccountCoverageRow[];
}

function HomeDetailSections({ model }: { model: HomeDetailModel }) {
  const {
    summary: s, money, percent, financialValuesHidden, solo, onOpenTransactions, efficiency, hasActiveEfficiencyPlan,
    onReviewEfficiency, onVerifyEfficiency, hasActivity, fixedCommitmentsNeedReview,
    onOpenSettings, freshnessLabel, checkInDays, movementRows, coverageRows,
  } = model;
  return (
    <>
      {efficiency
        && (efficiency.opportunities.length > 0 || hasActiveEfficiencyPlan)
        && onReviewEfficiency
        && onVerifyEfficiency && (
        <Disclosure
          title="Efficiency opportunities"
          summary={efficiency.opportunities.length
            ? `${efficiency.opportunities.length} evidence-based opportunities`
            : "Active household plan in progress"}
        >
        <EfficiencySection
          snapshot={efficiency}
          money={money}
          percent={percent}
          financialValuesHidden={financialValuesHidden}
          onReview={onReviewEfficiency}
          onVerify={onVerifyEfficiency}
          onOpenTransactions={onOpenTransactions}
          hasActivePlan={hasActiveEfficiencyPlan}
        />
        </Disclosure>
      )}

      {hasActivity ? (
        <Disclosure
          title={solo ? "Spending" : "Spending and settlement"}
          summary={solo
            ? `${money(s.attribution.recordedSpend)} recorded by purpose`
            : `${money(s.attribution.recordedSpend)} recorded across purpose, who it was for, and paid from`}
        >
      <section className="friendly-section attribution-section">
        <div className="friendly-heading attribution-heading">
          <div>
            <span className="soft-label">{solo ? "Where the money went" : "Who spent what"}</span>
            <h3>{solo ? "By purpose" : "Purpose, responsibility, and who paid"}</h3>
          </div>
          <p>Recorded activity: {money(s.attribution.recordedSpend)}</p>
        </div>

        <PurposeMatrix
          attribution={s.attribution}
          money={money}
          onOpenTransactions={onOpenTransactions}
          solo={solo}
        />

        {!solo && (<>
        <div className="funding-reconciliation" aria-label="Recorded activity reconciliation">
          <div>
            <span>
              <strong>Paid from members' accounts</strong>
              <small>Recorded activity traceable to member accounts or confirmed contributions.</small>
            </span>
            <b>{money(s.attribution.memberFundedSpend)}</b>
          </div>
          <div>
            <span>
              <strong>Joint or unregistered funding</strong>
              <small>Recorded spending with no single person it was paid from; excluded from settlement.</small>
            </span>
            <DrilldownAmount
              value={s.attribution.jointOrUnregisteredFunding}
              money={money}
              label="Joint or unregistered funding"
              onClick={openTarget(onOpenTransactions, { payer: "joint" })}
            />
          </div>
          <div className="funding-total">
            <span>
              <strong>Recorded activity total</strong>
              <small>Member-funded and joint funding together.</small>
            </span>
            <DrilldownAmount
              value={s.attribution.recordedSpend}
              money={money}
              label="All recorded spending"
              onClick={openTarget(onOpenTransactions, {})}
            />
          </div>
          <div className={s.attribution.unassignedBeneficiarySpend > 0 ? "needs-review" : ""}>
            <span>
              <strong>Who it was for is still unassigned</strong>
              <small>Included in recorded activity, but not assigned to the household or a person yet.</small>
            </span>
            <DrilldownAmount
              value={s.attribution.unassignedBeneficiarySpend}
              money={money}
              label="Spending with no person assigned"
              onClick={openTarget(onOpenTransactions, { beneficiary: "unassigned" })}
            />
          </div>
          <div className={`planning-only ${fixedCommitmentsNeedReview ? "needs-review" : ""}`}>
            <span>
              <strong>Planning-only fixed commitments</strong>
              <small>
                Used by the forecast, but excluded from recorded activity and settlement until payment evidence arrives.
                {s.attribution.fixedCommitments.unassigned > 0
                  ? ` ${money(s.attribution.fixedCommitments.unassigned)} still needs who it is for.`
                  : fixedCommitmentsNeedReview ? " A commitment purpose still needs review." : ""}
              </small>
            </span>
            <div className="planning-commitment-actions">
              <b>{money(s.attribution.fixedCommitments.total)}</b>
              {fixedCommitmentsNeedReview && <button className="link-button" onClick={() => onOpenSettings({ tab: "budget", section: "commitments" })}>Review commitments</button>}
            </div>
          </div>
        </div>

        <div className="responsibility-heading">
          <div>
            <span className="soft-label">Member statements</span>
            <h4>Responsibility is not the same as who paid</h4>
          </div>
          <p>Common spending is shared equally across {s.attribution.memberRows.length} member{s.attribution.memberRows.length === 1 ? "" : "s"}.</p>
        </div>
        <div className="responsibility-grid">
          {s.attribution.memberRows.map((row) => (
            <ResponsibilityCard
              row={row}
              money={money}
              onOpenTransactions={onOpenTransactions}
              key={row.member.id}
            />
          ))}
        </div>
        </>)}
      </section>

      <section className="home-grid plan-grid overview-grid">
        <div className="home-panel spend-plan">
          <span className="soft-label">Spend plan</span>
          <h3>{money(Math.max(0, s.targetSpend - s.totalSpend))}</h3>
          <p>left for the month before dipping below the savings target.</p>
          {s.protectedIncome > 0 && <p className="muted">Protected one-off income improves savings without increasing this allowance.</p>}
          <div className="mini-stats">
            <span><b>{money(s.remainingDaily)}</b> / day for {s.daysLeft} days</span>
            <span><b>{money(s.spendPerDay)}</b> / day so far</span>
            <span><b>{money(s.dailyAllowance)}</b> / day keeps the plan comfortable</span>
          </div>
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
          {s.isCurrentMonth && coverageRows.length > 0 && (
            <div className="coverage-list" aria-label="Account update coverage">
              {coverageRows.slice(0, 4).map((row) => (
                <small className="coverage-row" data-status={row.status} key={row.account.id}>
                  <strong>{row.account.label}</strong>
                  <span>{row.status === "missing" ? "Not confirmed" : `Through ${row.throughDate}`}</span>
                </small>
              ))}
            </div>
          )}
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
                <strong>{money(commitmentExpectedAmount(fixed, s.month))}</strong>
                <small>
                  {fixed.kind === "loan_payment"
                    ? "Loan / debt · "
                    : fixed.kind === "investment_transfer"
                      ? "Investment contribution · "
                      : fixed.investmentAmount
                        ? "Insurance + investment · "
                        : ""}
                  {commitmentMatchedTransactions(s.monthTransactions, fixed, s.month).length
                    ? "matched to statement"
                    : fixed.until ? `ends ${monthLabel(fixed.until)}` : "ongoing"}
                </small>
              </div>
            ))}
          </div>
        </div>
        )}
      </section>}
        </Disclosure>
      ) : (
        <section className="ledger-empty-state">
          <span className="soft-label">The ledger is ready</span>
          <h3>Start with this month's activity</h3>
          <p>
            Once transactions arrive, this page will show what the household spent on, who benefited, who paid,
            and why any settlement is needed without filling the page with zero-value panels.
          </p>
        </section>
      )}
    </>
  );
}


function useHomeViewModel({
  summary,
  money,
  currencyMoney,
  percent = (value, digits = 1) => `${value.toFixed(digits)}%`,
  financialValuesHidden = false,
  lastCheckInAt,
  onOpenSettings,
  onOpenImport,
  onReviewQueue,
  onCompleteCheckIn,
  onConfirmIncome,
  onAddOneOffIncome,
  incomeCandidates,
  contributionCandidates,
  members,
  accounts,
  onConfirmContribution,
  onOpenTransactions,
  efficiency,
  hasActiveEfficiencyPlan = false,
  onReviewEfficiency,
  onVerifyEfficiency,
}: {
  summary: MonthSummary;
  money: (value: number) => string;
  currencyMoney?: (value: number, currency: string) => string;
  percent?: (value: number, digits?: number) => string;
  financialValuesHidden?: boolean;
  lastCheckInAt: string;
  onOpenSettings: (target?: SettingsTarget) => void;
  onOpenImport: () => void;
  onReviewQueue: () => void;
  onCompleteCheckIn: () => void;
  onConfirmIncome: (item: PortionResolution, candidate?: IncomeCandidate) => void;
  onAddOneOffIncome?: () => void;
  incomeCandidates?: Map<string, IncomeCandidate>;
  contributionCandidates?: SharedContributionCandidate[];
  members?: Member[];
  accounts?: Account[];
  onConfirmContribution?: (candidate: SharedContributionCandidate) => void;
  onOpenTransactions?: (filters: HomeTransactionFilters) => void;
  efficiency?: EfficiencySnapshot;
  hasActiveEfficiencyPlan?: boolean;
  onReviewEfficiency?: (opportunity: EfficiencyOpportunity) => void;
  onVerifyEfficiency?: (opportunity: EfficiencyOpportunity) => void;
}) {
  const s = summary;
  const [showAllActions, setShowAllActions] = useState(false);
  const moneyIn = currencyMoney ?? ((value: number, _currency: string) => money(value));
  const candidates = incomeCandidates ?? new Map<string, IncomeCandidate>();
  const contributionSuggestions = contributionCandidates ?? [];
  const householdMembers = members ?? [];
  const coverageRows = computeAccountCoverage(accounts ?? [], householdMembers, new Date());
  const onTrack = s.projectedSaveRate >= s.targetSaveRate;
  const hasActivity = s.monthTransactions.length > 0 || s.totalSpend > 0;
  // One-member households have no beneficiary split or settlement to show.
  const solo = s.attribution.memberRows.length === 1;
  const movementRows = s.movementRows.filter((row) => row.value > 0 || row.delta !== 0);
  const coverageNeedsUpdate = coverageRows.some((row) => row.status !== "current");
  const waitingForCoverage = s.isCurrentMonth && coverageRows.length > 0 && coverageNeedsUpdate;
  const dataNeedsUpdate = s.isCurrentMonth && (coverageRows.length
    ? coverageNeedsUpdate
    : (s.dataAgeDays === null ? s.dayNumber > 3 : s.dataAgeDays >= 7));
  const checkInTimestamp = Date.parse(lastCheckInAt);
  const checkInDays = Number.isFinite(checkInTimestamp)
    ? Math.max(0, Math.floor((Date.now() - checkInTimestamp) / 86_400_000))
    : null;
  const weeklyCheckInDue = s.isCurrentMonth && (checkInDays === null || checkInDays >= 7);
  const checkInReady = !dataNeedsUpdate && s.unresolvedCount === 0;
  const forecastReady = hasActivity && (!s.isCurrentMonth || !dataNeedsUpdate);
  const fixedCommitmentsNeedReview = s.attribution.fixedCommitments.unassigned > 0
    || s.attribution.fixedCommitments.purposeRows.some((row) => row.key === "uncategorized");
  const freshnessLabel = !s.isCurrentMonth
    ? "Historical month"
    : coverageRows.length
      ? coverageLabel(coverageRows)
    : !s.latestTransactionDate
      ? "No activity yet"
      : s.dataAgeDays === 0
        ? "Current today"
        : s.dataAgeDays === 1
          ? "1 day behind"
          : `${s.dataAgeDays} days behind`;

  const coverageNeedingUpdate = coverageRows.filter((row) => row.status !== "current");
  const coverageActions: HomeAction[] = coverageNeedingUpdate.length
    ? [{
        id: "account-coverage",
        family: "account_coverage",
        priority: HOME_ACTION_PRIORITY.account_coverage,
        count: coverageNeedingUpdate.length,
        title: coverageNeedingUpdate.length === 1
          ? `Update ${coverageNeedingUpdate[0]!.account.label}`
          : `Update ${coverageNeedingUpdate.length} accounts`,
        body: coverageNeedingUpdate.length === 1
          ? coverageNeedingUpdate[0]!.status === "missing"
            ? `${coverageNeedingUpdate[0]!.ownerLabel}'s account has no confirmed coverage date. Import a statement or mark what has been reviewed.`
            : `${coverageNeedingUpdate[0]!.ownerLabel}'s account is only confirmed through ${coverageNeedingUpdate[0]!.throughDate}. The household forecast remains incomplete.`
          : `${coverageNeedingUpdate.length} active accounts need current coverage before the household forecast is complete.`,
        details: coverageNeedingUpdate.length > 1
          ? coverageNeedingUpdate.map((row) => row.status === "missing"
              ? `${row.account.label} (${row.ownerLabel}): not confirmed`
              : `${row.account.label} (${row.ownerLabel}): confirmed through ${row.throughDate}`)
          : undefined,
        target: {
          kind: "button",
          label: coverageNeedingUpdate.length === 1 ? "Review account" : "Review accounts",
          onSelect: () => onOpenSettings({
            tab: "accounts",
            section: "accounts",
            ...(coverageNeedingUpdate.length === 1 ? { itemId: coverageNeedingUpdate[0]!.account.id } : {}),
          }),
        },
      }]
    : [];

  const attentionItems = rankHomeActions([
    ...coverageActions,
    ...s.incomeItems.filter((item) => item.receipt?.currencyReview).map((item): HomeAction => ({
      id: `income-currency-${item.memberId}-${item.portion.id}`,
      family: "income_currency_review",
      priority: HOME_ACTION_PRIORITY.income_currency_review,
      title: `Check ${item.portion.label} currency`,
      body: "This older confirmation could not be assigned a native currency safely. Review it to verify the household total.",
      target: { kind: "button", label: "Check currency", onSelect: () => onConfirmIncome(item) },
    })),
    ...s.incomeItems.filter((item) => item.missingRate).map((item): HomeAction => ({
      id: `exchange-rate-${item.memberId}-${item.portion.id}`,
      family: "missing_exchange_rate",
      priority: HOME_ACTION_PRIORITY.missing_exchange_rate,
      title: `Add ${item.portion.currency} exchange rate`,
      body: `${item.portion.label} cannot be included in the projection until its exchange rate is set.`,
      target: {
        kind: "button",
        label: "Add exchange rate",
        onSelect: () => onOpenSettings({ tab: "budget", section: "exchange-rates" }),
      },
    })),
    ...(dataNeedsUpdate && !waitingForCoverage
      ? [{
          id: "recent-activity",
          family: "recent_activity" as const,
          priority: HOME_ACTION_PRIORITY.recent_activity,
          title: "Bring transactions up to date",
          body: s.latestTransactionDate
            ? `Latest activity is ${s.latestTransactionDate}. Import or add recent transactions before trusting the forecast.`
            : "No transactions are recorded for this month. Import or add activity before trusting the forecast.",
          target: { kind: "button" as const, label: "Import activity", onSelect: onOpenImport },
        }]
      : []),
    ...(s.unresolvedCount
      ? [{
          id: "classification",
          family: "classification" as const,
          priority: HOME_ACTION_PRIORITY.classification,
          count: s.unresolvedCount,
          title: "Classify new spending",
          body: `${s.unresolvedCount} transaction${s.unresolvedCount === 1 ? "" : "s"} need a purpose or who it was for before the month is trustworthy.`,
          target: { kind: "button" as const, label: "Review queue", onSelect: onReviewQueue },
        }]
      : []),
    ...s.incomeItems.filter((item) => !item.receipt && (item.status === "overdue" || candidates.has(item.portion.id))).map((item): HomeAction => ({
      id: `income-confirmation-${item.memberId}-${item.portion.id}`,
      family: "income_confirmation",
      priority: HOME_ACTION_PRIORITY.income_confirmation,
      title: `Confirm ${item.portion.label}`,
      body: candidates.has(item.portion.id)
        ? `A matching credit of ${moneyIn(candidates.get(item.portion.id)!.sourceAmount, candidates.get(item.portion.id)!.sourceCurrency)} on ${candidates.get(item.portion.id)!.transaction.date} is already in your statement.`
        : `${item.memberName}'s expected income has passed its arrival window. Confirm what actually arrived.`,
      target: {
        kind: "button",
        label: "Confirm income",
        onSelect: () => onConfirmIncome(item, candidates.get(item.portion.id)),
      },
    })),
    ...(weeklyCheckInDue
      ? [{
          id: "weekly-check-in",
          family: "weekly_check_in" as const,
          priority: HOME_ACTION_PRIORITY.weekly_check_in,
          title: "Complete this week's money check-in",
          body: checkInReady
            ? "The data is current and this month's categories are clean. Record that you reviewed the plan."
            : "Update recent activity and resolve this month's purpose and who-it-was-for gaps, then record the check-in.",
          target: {
            kind: "button" as const,
            label: checkInReady ? "Mark reviewed" : "Acknowledge gaps",
            onSelect: onCompleteCheckIn,
          },
        }]
      : []),
    ...contributionSuggestions.map((candidate): HomeAction => {
      const contributor = householdMembers.find((member) => member.id === candidate.contributorMemberId)?.name ?? "Household member";
      const recovered = candidate.expenses.reduce((sum, expense) => sum + expense.amount, 0);
      return {
        id: `contribution-${candidate.debit.id}-${candidate.credit.id}`,
        family: "contribution_confirmation",
        priority: HOME_ACTION_PRIORITY.contribution_confirmation,
        title: `Confirm ${contributor}'s loan contribution`,
        body: `${money(candidate.amount)} moved into ${candidate.credit.account} near ${candidate.expenses.length} recovery deduction${candidate.expenses.length === 1 ? "" : "s"} totalling ${money(recovered)}. Review the transfer pair and recovery group before changing settlement.`,
        target: onConfirmContribution
          ? { kind: "button", label: "Review contribution", onSelect: () => onConfirmContribution(candidate) }
          : { kind: "status", label: "Review" },
      };
    }),
    ...s.transfers.map((transfer): HomeAction => ({
      id: `settlement-${transfer.fromId}-${transfer.toId}`,
      family: "settlement",
      priority: HOME_ACTION_PRIORITY.settlement,
      title: "Settle household balance",
      body: `${transfer.fromName} pays ${transfer.toName}: ${money(transfer.amount)}.`,
      target: { kind: "status", label: "Settlement" },
    })),
    ...s.possibleFixedCostDuplicates.map((fixed): HomeAction => ({
      id: `fixed-cost-duplicate-${fixed.id}`,
      family: "fixed_cost_duplicate",
      priority: HOME_ACTION_PRIORITY.fixed_cost_duplicate,
      title: `Check ${fixed.label} for double counting`,
      body: `A ${money(fixed.amount)} transaction in the same category is already in this month. If it is the same payment, remove this fixed cost.`,
      target: {
        kind: "button",
        label: "Check budget",
        onSelect: () => onOpenSettings({ tab: "budget", section: "commitments", itemId: fixed.id }),
      },
    })),
    ...s.monthFixed.filter((fixed) => fixed.kind === "investment_transfer" && !fixed.holdingId).map((fixed): HomeAction => ({
      id: `holding-link-${fixed.id}`,
      family: "holding_link",
      priority: HOME_ACTION_PRIORITY.holding_link,
      title: `Link ${fixed.label} to an asset`,
      body: "The installment is excluded from spend, but it needs a Cash, property, FD, policy, fund, or other holding before Mizan can track its cost basis.",
      target: {
        kind: "button",
        label: "Choose holding",
        onSelect: () => onOpenSettings({ tab: "assets", section: "assets" }),
      },
    })),
    ...s.endingSoon.map((fixed): HomeAction => ({
      id: `ending-commitment-${fixed.id}`,
      family: "ending_commitment",
      priority: HOME_ACTION_PRIORITY.ending_commitment,
      title: `${fixed.label} ends ${monthLabel(fixed.until ?? "")}`,
      body: `${money(fixed.amount)} per month can be redirected once it ends.`,
      target: {
        kind: "button",
        label: "Plan it",
        onSelect: () => onOpenSettings({ tab: "budget", section: "commitments", itemId: fixed.id }),
      },
    })),
    ...(!onTrack
      ? [{
          id: "save-rate",
          family: "save_rate" as const,
          priority: HOME_ACTION_PRIORITY.save_rate,
          title: "Save-rate target at risk",
          body: `Projected save rate is below the ${percent(s.targetSaveRate, 0)} target.`,
          target: { kind: "status" as const, label: "At risk", tone: "danger" as const },
        }]
      : []),
  ]);
  const visibleAttentionItems = showAllActions ? attentionItems : attentionItems.slice(0, 3);

  return {
    s, onTrack, forecastReady, onOpenImport, onOpenSettings, onReviewQueue,
    checkInDays, money, moneyIn, percent, solo,
    financialValuesHidden, onConfirmIncome, candidates, onAddOneOffIncome, attentionItems,
    visibleAttentionItems, showAllActions, setShowAllActions, onOpenTransactions, efficiency, onReviewEfficiency,
    onVerifyEfficiency, hasActiveEfficiencyPlan, hasActivity, fixedCommitmentsNeedReview, freshnessLabel, movementRows, coverageRows,
    waitingForCoverage,
  };
}

type HomeViewModel = ReturnType<typeof useHomeViewModel>;

function HomeHeroSummary({ model }: { model: HomeViewModel }) {
  const {
    s, onTrack, forecastReady, money, financialValuesHidden, percent, solo,
    waitingForCoverage, freshnessLabel,
  } = model;
  return (
    <>
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
              At the current pace, you are projected to save <b><MoneyValue formatted={money(s.projectedSaved)} hidden={financialValuesHidden} /></b>. {solo ? "Your" : "The shared"} target
              is a <MoneyValue formatted={percent(s.targetSaveRate, 0)} hidden={financialValuesHidden} /> save rate.
            </p>
          ) : (
            <p>
              {waitingForCoverage
                ? "The forecast is paused until every active account has a current coverage confirmation."
                : "The forecast is paused until this month has current transactions."} Your {solo ? "" : "shared "}target remains a
              {" "}<MoneyValue formatted={percent(s.targetSaveRate, 0)} hidden={financialValuesHidden} /> save rate.
            </p>
          )}
        </div>
        <div className="hero-meter">
          {forecastReady ? (
            <>
              <span>Projected save rate</span>
              <strong><MoneyValue formatted={percent(s.projectedSaveRate)} hidden={financialValuesHidden} /></strong>
              <div className="comfort-track">
                <span style={{ width: financialValuesHidden ? "0%" : `${Math.max(0, Math.min(100, s.projectedSaveRate))}%` }} />
                <i style={{ left: financialValuesHidden ? "0%" : `${s.targetSaveRate}%` }} />
              </div>
            </>
          ) : (
            <>
              <span>Forecast status</span>
              <strong className="forecast-paused">{waitingForCoverage ? "Waiting for account coverage" : "Waiting for activity"}</strong>
              <p>{waitingForCoverage
                ? freshnessLabel
                : s.latestTransactionDate ? `Latest activity: ${s.latestTransactionDate}` : "No transactions recorded yet"}</p>
            </>
          )}
        </div>
      </section>

      <section className="financial-strip" aria-label="Monthly financial summary">
        <div><span>Available income</span><strong><MoneyValue formatted={money(s.incomeTotal)} hidden={financialValuesHidden} /></strong></div>
        <div><span>Recorded spend</span><strong><MoneyValue formatted={money(s.attribution.recordedSpend)} hidden={financialValuesHidden} /></strong></div>
        <div><span>Plan remaining</span><strong><MoneyValue formatted={money(Math.max(0, s.targetSpend - s.totalSpend))} hidden={financialValuesHidden} /></strong></div>
        <div><span>Projected saving</span><strong>{forecastReady ? <MoneyValue formatted={money(s.projectedSaved)} hidden={financialValuesHidden} /> : "Paused"}</strong></div>
      </section>

    </>
  );
}

function HomeIncomeSection({ model }: { model: HomeViewModel }) {
  const {
    s, hasActivity, money, financialValuesHidden, onAddOneOffIncome, moneyIn,
    candidates, onConfirmIncome,
  } = model;
  return (
    <>
      <Disclosure
        title="Income"
        summary={`${s.incomeItems.filter((item) => item.receipt).length} of ${s.incomeItems.length} expected deposits confirmed`}
        defaultOpen={!hasActivity}
      >
      <section className="friendly-section income-panel">
        <div className="friendly-heading">
          <div>
            <span className="soft-label">Income</span>
            <h3>Expected and received</h3>
          </div>
          <div className="income-heading-actions">
            <p><MoneyValue formatted={money(s.incomeTotal)} hidden={financialValuesHidden} /> available after tax</p>
            {s.protectedIncome > 0 && <small><MoneyValue formatted={money(s.protectedIncome)} hidden={financialValuesHidden} /> protected from the spending plan</small>}
            {onAddOneOffIncome && <Button variant="secondary" onClick={onAddOneOffIncome}>Add one-off income</Button>}
          </div>
        </div>
        <div className="income-checklist">
          {s.incomeItems.map((item) => {
            const window = item.portion.window;
            const candidate = candidates.get(item.portion.id);
            const oneOff = item.portion.schedule.frequency === "one_off";
            const statusLabel = item.receipt?.currencyReview
              ? "Check currency"
              : item.missingRate
              ? `Missing ${item.portion.currency} rate`
              : item.status === "received"
                ? item.receipt?.transactionId ? "Received · matched" : "Received"
                : oneOff && item.status === "overdue" && !item.countsInTotal
                  ? "Overdue · excluded"
                : item.status === "due"
                  ? `${oneOff ? "Expected · " : ""}Due day ${window?.startDay}-${window?.endDay}`
                  : item.status === "overdue"
                    ? "Overdue"
                    : item.status === "upcoming"
                      ? `${oneOff ? "Expected · " : ""}Upcoming day ${window?.startDay}-${window?.endDay}`
                      : oneOff ? "Expected" : "No arrival date";
            return <div className="income-check-row" key={`${item.memberId}-${item.portion.id}`}>
              <span className="color-dot" style={{ background: item.memberColor }} />
              <div>
                <strong>{item.portion.label}</strong>
                <small>
                  {item.memberName}{item.portion.currency ? ` · ${item.portion.currency}` : ""}
                  {oneOff ? ` · One-off${item.budgetTreatment === "protected" ? " · Protected" : ""}` : ""}
                </small>
                {candidate && <small className="income-match-hint">Matched {candidate.transaction.description} · {candidate.transaction.date}</small>}
              </div>
              <b>{moneyIn(item.nativeNet, item.nativeCurrency)}{!item.countsInTotal ? " expected" : ""}</b>
              <span className={`income-status ${item.receipt?.currencyReview || item.missingRate ? "missing" : item.status}`}>{statusLabel}</span>
              <Button variant="secondary" onClick={() => onConfirmIncome(item, candidate)}>{item.receipt ? "Edit income" : "Confirm income"}</Button>
            </div>;
          })}
        </div>
      </section>
      </Disclosure>

    </>
  );
}

function HomeActionControl({
  target,
  rank,
}: {
  target: AppActionTarget;
  rank: "primary" | "secondary" | "backlog";
}) {
  if (target.kind === "status") {
    return <span className={`attention-pill ${target.tone === "danger" ? "danger" : ""}`}>{target.label}</span>;
  }
  return (
    <Button
      variant={rank === "primary" ? "primary" : rank === "secondary" ? "secondary" : "ghost"}
      onClick={target.onSelect}
    >
      {target.label}
    </Button>
  );
}

function HomeAttentionSection({ model }: { model: HomeViewModel }) {
  const {
    hasActivity, attentionItems, forecastReady, onTrack, visibleAttentionItems,
    setShowAllActions, showAllActions,
  } = model;
  return (
    <>
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
            visibleAttentionItems.map((item, index) => {
              const rank = index === 0 ? "primary" : index < 3 ? "secondary" : "backlog";
              return (
              <div
                className="attention-card"
                data-action-count={item.count}
                data-action-family={item.family}
                data-action-rank={rank}
                key={item.id}
              >
                <div>
                  {index === 0 && <span className="soft-label">Do this next</span>}
                  {index === 3 && <span className="soft-label">Backlog</span>}
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                  {item.details && item.details.length > 0 && (
                    <ul>
                      {item.details.map((detail) => <li key={detail}>{detail}</li>)}
                    </ul>
                  )}
                </div>
                <HomeActionControl target={item.target} rank={rank} />
              </div>
              );
            })
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
        {attentionItems.length > 3 && (
          <button
            aria-expanded={showAllActions}
            className="link-button action-queue-toggle"
            onClick={() => setShowAllActions((current) => !current)}
          >
            {showAllActions ? "Show priority tasks" : `Show ${attentionItems.length - 3} more`}
          </button>
        )}
      </section>}

    </>
  );
}

function HomeAssetSection({ model }: { model: HomeViewModel }) {
  const { s, money, financialValuesHidden, onOpenSettings } = model;
  const snapshot = s.assetSnapshot;
  if (!snapshot.rows.length && s.investmentContributions <= 0 && s.plannedInvestmentContributions <= 0) return null;
  return (
    <Disclosure
      title="Assets & investments"
      summary={snapshot.totalValue > 0
        ? `${money(snapshot.totalValue)} across ${snapshot.rows.length} holding${snapshot.rows.length === 1 ? "" : "s"}`
        : `${snapshot.rows.length} holding${snapshot.rows.length === 1 ? "" : "s"} awaiting valuation`}
    >
      <section className="friendly-section asset-overview">
        <div className="friendly-heading">
          <div>
            <span className="soft-label">Holdings</span>
            <h3>Value and contributions stay separate</h3>
          </div>
          <Button variant="secondary" onClick={() => onOpenSettings({ tab: "assets", section: "assets" })}>Manage holdings</Button>
        </div>
        <div className="asset-summary-strip">
          <div>
            <span>Latest valued total</span>
            <strong><MoneyValue formatted={money(snapshot.totalValue)} hidden={financialValuesHidden} /></strong>
            {snapshot.unvaluedCount > 0 && <small>{snapshot.unvaluedCount} holding{snapshot.unvaluedCount === 1 ? "" : "s"} not valued</small>}
          </div>
          <div>
            <span>Contributed this month</span>
            <strong><MoneyValue formatted={money(s.investmentContributions)} hidden={financialValuesHidden} /></strong>
            <small>Recorded transaction evidence</small>
          </div>
          <div>
            <span>Still planned this month</span>
            <strong><MoneyValue formatted={money(s.plannedInvestmentContributions)} hidden={financialValuesHidden} /></strong>
            <small>Unmatched scheduled contributions</small>
          </div>
        </div>
        <div className="asset-row-list">
          {snapshot.rows.map((row) => (
            <article key={row.holding.id}>
              <div>
                <button
                  aria-label={`Edit ${row.holding.label} holding`}
                  className="link-button"
                  onClick={() => onOpenSettings({
                    tab: "assets",
                    section: "assets",
                    itemId: row.holding.id,
                  })}
                >
                  <strong>{row.holding.label}</strong>
                </button>
                <small>{assetTypeLabel(row.holding.type)} · {row.holding.status.replaceAll("_", " ")}</small>
              </div>
              <div>
                <span>{row.value === null ? "No valuation" : <MoneyValue formatted={money(row.value)} hidden={financialValuesHidden} />}</span>
                <small>{row.valuationDate ? `Valued ${row.valuationDate}` : "Add a dated valuation"}</small>
              </div>
              <div>
                <span><MoneyValue formatted={money(row.contributed)} hidden={financialValuesHidden} /></span>
                <small>Recorded cost basis</small>
              </div>
            </article>
          ))}
        </div>
      </section>
    </Disclosure>
  );
}

function HomeOverview({ model }: { model: HomeViewModel }) {
  const {
    s, onOpenSettings, checkInDays, money, percent, financialValuesHidden, solo,
    onOpenTransactions, efficiency, hasActiveEfficiencyPlan, onReviewEfficiency,
    onVerifyEfficiency, hasActivity, fixedCommitmentsNeedReview, freshnessLabel, movementRows, coverageRows,
  } = model;
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
          <Button variant="primary" onClick={() => onOpenSettings({ tab: "household", section: "income" })}>Open income settings</Button>
        </div>
      </section>
    );
  }

  return (
    <div className="household-home">
      <HomeHeroSummary model={model} />
      <HomeIncomeSection model={model} />
      <HomeAttentionSection model={model} />
      <HomeAssetSection model={model} />
      <HomeDetailSections model={{
        summary: s, money, percent, financialValuesHidden, solo, onOpenTransactions, efficiency, hasActiveEfficiencyPlan,
        onReviewEfficiency, onVerifyEfficiency, hasActivity, fixedCommitmentsNeedReview,
        onOpenSettings, freshnessLabel, checkInDays, movementRows, coverageRows,
      }} />
    </div>
  );
}

export function HomeView(props: Parameters<typeof useHomeViewModel>[0]) {
  return <HomeOverview model={useHomeViewModel(props)} />;
}
