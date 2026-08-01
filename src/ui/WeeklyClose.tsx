import type { ComponentProps } from "react";
import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Circle } from "lucide-react";
import { computeAccountCoverage } from "../domain/accountCoverage";
import type { EfficiencyPlanInput } from "../domain/efficiency";
import { firstIncompleteWeeklyCloseStep, weeklyCloseSortProgress, WEEKLY_CLOSE_STEP_IDS } from "../domain/weeklyClose";
import type { EfficiencyPlan, EfficiencyOpportunity, WeeklyClose, WeeklyCloseStep } from "../domain/types";
import type { EfficiencySnapshot } from "../domain/efficiency";
import type { MonthSummary } from "../domain/summary";
import { Button } from "./bits";
import { CatchUpView } from "./CatchUpView";
import { SortView } from "./SortView";
import type { WeeklyReceiptValues } from "./WeeklyReceipt";

const EfficiencyReviewModal = lazy(async () => {
  const module = await import("./EfficiencyModal");
  return { default: module.EfficiencyReviewModal };
});

const STEP_LABELS: Record<WeeklyCloseStep, string> = {
  "catch-up": "Catch up the accounts",
  sort: "Sort what's new",
  read: "Read what changed",
  decide: "Decide one thing",
};

export interface WeeklyCloseBalanceState {
  weekIso: string;
  weekNumber: number;
  record: WeeklyClose | null;
  streak: number;
  accountsCurrent: number;
  accountsTotal: number;
  sortCount: number;
  movementCount: number;
  opportunityCount: number;
}

export interface WeeklyCloseProps {
  weekNumber: number;
  record: WeeklyClose | null;
  initialStep?: number;
  catchUpProps: ComponentProps<typeof CatchUpView>;
  sortProps: ComponentProps<typeof SortView>;
  summary: MonthSummary;
  efficiency: EfficiencySnapshot;
  existingPlan?: EfficiencyPlan;
  money: (value: number) => string;
  onSaveEfficiencyDecision: (opportunity: EfficiencyOpportunity, input: EfficiencyPlanInput) => EfficiencyPlan;
  onStepAnswered: (stepsCompleted: WeeklyCloseStep[], sortedCount: number, committedPlanId?: string) => Promise<void>;
  onComplete: (receipt: WeeklyReceiptValues) => void;
  onBack: () => void;
}

function movementSentence(row: MonthSummary["movementRows"][number], money: (value: number) => string): string {
  const movement = row.delta === 0
    ? "unchanged"
    : row.delta > 0
      ? `up ${money(row.delta)}`
      : `down ${money(Math.abs(row.delta))}`;
  return `${row.name} is ${movement}, at ${money(row.value)}.`;
}

export function WeeklyRitualCard({
  state,
  onContinue,
}: {
  state: WeeklyCloseBalanceState;
  onContinue: () => void;
}) {
  const completed = new Set(state.record?.stepsCompleted ?? []);
  const firstIncomplete = firstIncompleteWeeklyCloseStep(state.record);
  const isClosed = Boolean(state.record?.closedAt) && firstIncomplete === -1;
  const streakLabel = state.streak > 0 ? `${state.streak} week${state.streak === 1 ? "" : "s"} in a row` : "Starting again";
  const details: Record<WeeklyCloseStep, string> = {
    "catch-up": `${state.accountsCurrent} of ${state.accountsTotal}`,
    sort: state.sortCount ? String(state.sortCount) : "clear",
    read: `${state.movementCount} shift${state.movementCount === 1 ? "" : "s"}`,
    decide: `${state.opportunityCount} candidate${state.opportunityCount === 1 ? "" : "s"}`,
  };

  return (
    <section className="balance-ritual-card" aria-label="The weekly close">
      <div className="balance-ritual-heading">
        <span className="mz-eyebrow">The weekly close</span>
        <span className="balance-streak-pill">{streakLabel}</span>
      </div>
      <h2 className="mz-display-m">{isClosed ? `Week ${state.weekNumber} is closed` : `Close week ${state.weekNumber}`}</h2>
      <div className="balance-ritual-steps">
        {WEEKLY_CLOSE_STEP_IDS.map((step, index) => {
          const done = completed.has(step);
          const current = !done && index === firstIncomplete;
          return (
            <div className={`balance-ritual-step ${done ? "done" : current ? "current" : "future"}`} key={step}>
              <span className="balance-ritual-step-icon">
                {done ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : current ? index + 1 : <Circle size={10} strokeWidth={2} aria-hidden="true" />}
              </span>
              <span>{STEP_LABELS[step]}</span>
              <small>{details[step]}</small>
            </div>
          );
        })}
      </div>
      <div className="balance-ritual-actions">
        <Button variant="primary" onClick={onContinue}>{isClosed ? "View receipt" : "Continue"}<ArrowRight size={17} aria-hidden="true" /></Button>
        {!isClosed && <span>about 4 minutes left</span>}
      </div>
    </section>
  );
}

export function WeeklyClose({
  weekNumber,
  record,
  initialStep,
  catchUpProps,
  sortProps,
  summary,
  efficiency,
  existingPlan,
  money,
  onSaveEfficiencyDecision,
  onStepAnswered,
  onComplete,
  onBack,
}: WeeklyCloseProps) {
  const initialSummary = useRef(summary);
  const initialQueue = useRef(sortProps.queue.map(({ count, total }) => ({ count, total })));
  const safeStepsCompleted = Array.isArray(record?.stepsCompleted) ? record.stepsCompleted : [];
  const startingSortedCount = typeof record?.sortedCount === "number" && Number.isFinite(record.sortedCount)
    ? Math.max(0, record.sortedCount)
    : 0;
  const [stepsCompleted, setStepsCompleted] = useState<WeeklyCloseStep[]>(safeStepsCompleted);
  const [sortedCount, setSortedCount] = useState(startingSortedCount);
  const [committedMonthlySavings, setCommittedMonthlySavings] = useState(0);
  const [step, setStep] = useState(() => initialStep ?? Math.max(0, firstIncompleteWeeklyCloseStep({ stepsCompleted: safeStepsCompleted })));
  const [reviewingOpportunity, setReviewingOpportunity] = useState<EfficiencyOpportunity | null>(null);
  const coverageRows = useMemo(
    () => computeAccountCoverage(catchUpProps.accounts, catchUpProps.members, catchUpProps.today ?? new Date()),
    [catchUpProps.accounts, catchUpProps.members, catchUpProps.today],
  );
  const catchUpAnswered = coverageRows.every((row) => row.status === "current");
  const currentStep = WEEKLY_CLOSE_STEP_IDS[step] ?? "decide";

  function sortedProgress() {
    return weeklyCloseSortProgress(initialQueue.current, sortProps.queue, startingSortedCount);
  }

  async function answerStep(stepId: WeeklyCloseStep, committedPlanId?: string, planSavings = committedMonthlySavings) {
    const nextSteps = [...new Set([...stepsCompleted, stepId])];
    const progress = sortedProgress();
    const nextSortedCount = stepId === "sort" ? progress.count : sortedCount;
    await onStepAnswered(nextSteps, nextSortedCount, committedPlanId ?? record?.committedPlanId);
    setStepsCompleted(nextSteps);
    setSortedCount(nextSortedCount);
    const nextIndex = WEEKLY_CLOSE_STEP_IDS.findIndex((candidate) => !nextSteps.includes(candidate));
    if (nextIndex === -1) {
      onComplete({
        weekNumber,
        sortedCount: nextSortedCount,
        sortedAmount: progress.amount,
        statementAdded: Math.max(0, summary.totalSpend - initialSummary.current.totalSpend),
        accountsCurrent: coverageRows.filter((row) => row.status === "current").length,
        accountsTotal: coverageRows.length,
        saveRateBefore: initialSummary.current.projectedSaveRate,
        saveRateAfter: summary.projectedSaveRate,
        committedMonthlySavings: committedPlanId ? planSavings : 0,
      });
      return;
    }
    setStep(nextIndex);
  }

  const readRows = summary.movementRows.filter((row) => row.value > 0 || row.delta !== 0).slice(0, 3);
  const opportunities = efficiency.topOpportunities;
  const primaryOpportunity = opportunities[0];

  return (
    <main className="weekly-close-view" aria-labelledby="weekly-close-title">
      <header className="weekly-close-header">
        <div>
          <span className="mz-eyebrow">The weekly close · week {weekNumber}</span>
          <h1 id="weekly-close-title" className="mz-display-l">A short reading of the household.</h1>
          <p className="mz-body">Four answers, kept in place if you leave. Skipping a step is an answer; leaving it alone is not.</p>
        </div>
        <Button variant="ghost" onClick={onBack}>Back to Balance</Button>
      </header>

      <div className="weekly-close-progress" aria-label={`Step ${step + 1} of 4`}>
        {WEEKLY_CLOSE_STEP_IDS.map((item, index) => <span key={item} className={index < step || stepsCompleted.includes(item) ? "filled" : index === step ? "active" : "hollow"} />)}
      </div>

      {currentStep === "catch-up" && (
        <section className="weekly-close-step-panel">
          <CatchUpView {...catchUpProps} />
          <div className="weekly-close-step-actions">
            <Button variant="primary" disabled={!catchUpAnswered} onClick={() => void answerStep("catch-up")}>Accounts current <ArrowRight size={17} aria-hidden="true" /></Button>
            {!catchUpAnswered && <span>Bring each account current, or choose “Nothing new” on the accounts with no new activity.</span>}
          </div>
        </section>
      )}

      {currentStep === "sort" && (
        <section className="weekly-close-step-panel">
          <SortView {...sortProps} />
          <div className="weekly-close-step-actions">
            {sortProps.queue.length === 0
              ? <Button variant="primary" onClick={() => void answerStep("sort")}>Sorting answered <ArrowRight size={17} aria-hidden="true" /></Button>
              : <Button variant="secondary" onClick={() => void answerStep("sort")}>Stop here for now <ArrowRight size={17} aria-hidden="true" /></Button>}
            <span>{sortProps.queue.length === 0 ? "The queue is clear." : "Stopping is recorded as your answer. The remaining rows stay available in Sort."}</span>
          </div>
        </section>
      )}

      {currentStep === "read" && (
        <section className="weekly-close-read weekly-close-step-panel">
          <div className="weekly-close-step-heading">
            <span className="mz-eyebrow">Step 3 of 4 · Read</span>
            <h2 className="mz-display-l">What changed since the last reading?</h2>
            <p className="mz-body">At most three movements, in sentences rather than a table.</p>
          </div>
          <div className="weekly-close-movement-list">
            {readRows.length
              ? readRows.map((row) => <p key={row.key}>{movementSentence(row, money)}</p>)
              : <p>No material movement is showing yet. The ledger is the source if you want to look closer.</p>}
          </div>
          <div className="weekly-close-step-actions">
            <Button variant="primary" onClick={() => void answerStep("read")}>I&apos;ve read this <ArrowRight size={17} aria-hidden="true" /></Button>
          </div>
        </section>
      )}

      {currentStep === "decide" && (
        <section className="weekly-close-decide weekly-close-step-panel">
          <div className="weekly-close-step-heading">
            <span className="mz-eyebrow">Step 4 of 4 · Decide</span>
            <h2 className="mz-display-l">One useful decision, if there is one.</h2>
            <p className="mz-body">A plan is a commitment you choose. It does not rewrite the ledger or pretend an estimate already happened.</p>
          </div>
          {primaryOpportunity ? (
            <>
              <article className="weekly-close-opportunity primary">
                <span className="weekly-close-opportunity-label">Top opportunity</span>
                <h3 className="mz-display-m">{primaryOpportunity.subjectLabel}</h3>
                <p>{primaryOpportunity.evidence[0] ?? "A change is worth looking at against the household baseline."}</p>
                <Button variant="primary" onClick={() => setReviewingOpportunity(primaryOpportunity)}>Review and decide</Button>
              </article>
              {opportunities.slice(1).map((opportunity) => (
                <article className="weekly-close-opportunity dimmed" key={opportunity.fingerprint}>
                  <strong>{opportunity.subjectLabel}</strong>
                  <span>{opportunity.evidence[0] ?? "Evidence available"}</span>
                </article>
              ))}
              <Button variant="ghost" onClick={() => void answerStep("decide")}>Nothing this week, thanks</Button>
            </>
          ) : (
            <div className="weekly-close-no-opportunity">
              <p>{efficiency.readinessReason || "There is no evidence-backed opportunity ready to decide on this week."}</p>
              <Button variant="primary" onClick={() => void answerStep("decide")}>Nothing this week, thanks</Button>
            </div>
          )}
        </section>
      )}

      {reviewingOpportunity && (
        <Suspense fallback={null}>
          <EfficiencyReviewModal
            opportunity={reviewingOpportunity}
            existingPlan={existingPlan}
            contextMonth={summary.month}
            todayMonth={summary.month}
            money={money}
            onSave={(input) => {
              const plan = onSaveEfficiencyDecision(reviewingOpportunity, input);
              setCommittedMonthlySavings(plan.targetMonthlySavings);
              setReviewingOpportunity(null);
              void answerStep("decide", plan.id, plan.targetMonthlySavings);
            }}
            onClose={() => setReviewingOpportunity(null)}
          />
        </Suspense>
      )}
    </main>
  );
}
