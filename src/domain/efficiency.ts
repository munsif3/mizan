import { beneficiaryEquals } from "./beneficiaries";
import { categoryInfo } from "./categories";
import { addMonths, daysInMonth, isoDateOf, monthOf } from "./dates";
import { stableHash } from "./ids";
import { cleanMerchant, matchingRuleKey } from "./rules";
import { computeMonthSummary, isSpend, needsClassificationReview } from "./summary";
import { netAmount } from "./transactionMath";
import type {
  AppData,
  CategoryKey,
  ChangeEffort,
  EfficiencyAction,
  EfficiencyOpportunity,
  EfficiencyOutcomeResult,
  EfficiencyPlan,
  EfficiencySubject,
  LifeValue,
  SpendBeneficiary,
  Transaction,
} from "./types";

type EfficiencyReadiness = "ready" | "needs_current_data" | "needs_classification" | "building_baseline";

export interface EfficiencySnapshot {
  readiness: EfficiencyReadiness;
  readinessReason: string;
  baselineMonths: string[];
  targetGap: number;
  opportunities: EfficiencyOpportunity[];
  topOpportunities: EfficiencyOpportunity[];
  awaitingVerification: EfficiencyOpportunity[];
}

export interface EfficiencyPlanInput {
  value: LifeValue;
  action: EfficiencyAction;
  effort: ChangeEffort;
  targetMonthlySavings: number;
  targetMonth?: string;
}

interface SpendFact {
  transaction: Transaction;
  month: string;
  merchantKey: string;
  merchantLabel: string;
  category: CategoryKey;
  beneficiary: SpendBeneficiary;
  amount: number;
}

interface MerchantGroup {
  subject: Extract<EfficiencySubject, { type: "merchant" }>;
  label: string;
  monthly: Map<string, number>;
}

function beneficiaryKey(beneficiary: SpendBeneficiary): string {
  return beneficiary.type === "member" ? `member:${beneficiary.memberId}` : beneficiary.type;
}

function beneficiaryLabel(beneficiary: SpendBeneficiary, data: AppData): string {
  if (beneficiary.type === "household") return "Household";
  if (beneficiary.type === "unassigned") return "Unassigned";
  return data.settings.members.find((member) => member.id === beneficiary.memberId)?.name ?? "Former member";
}

/** Stable identity used to match persisted decisions to freshly derived opportunities. */
export function efficiencySubjectFingerprint(subject: EfficiencySubject): string {
  const identity = subject.type === "merchant"
    ? [subject.type, subject.merchantKey, subject.category, beneficiaryKey(subject.beneficiary)]
    : subject.type === "fixed_cost"
      ? [subject.type, subject.fixedCostId, subject.category, beneficiaryKey(subject.beneficiary)]
      : [subject.type, subject.category, beneficiaryKey(subject.beneficiary)];
  return `effsub_${stableHash(identity.join("\u0000"))}`;
}

function opportunityFingerprint(kind: EfficiencyOpportunity["kind"], subject: EfficiencySubject): string {
  return `effopp_${stableHash(`${kind}\u0000${efficiencySubjectFingerprint(subject)}`)}`;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function completedWindow(month: string, todayMonth: string, count = 6): string[] {
  const end = month < todayMonth ? month : addMonths(month, -1);
  return Array.from({ length: count }, (_, index) => addMonths(end, index - count + 1));
}

function facts(data: AppData): SpendFact[] {
  return data.transactions.flatMap((transaction) => {
    if (!isSpend(transaction) || transaction.category === "uncategorized" || transaction.beneficiary.type === "unassigned") return [];
    const merchantKey = cleanMerchant(matchingRuleKey(transaction.description, data.merchantRules) ?? transaction.description);
    if (!merchantKey) return [];
    return [{
      transaction,
      month: monthOf(transaction.date),
      merchantKey,
      merchantLabel: transaction.description.trim() || merchantKey,
      category: transaction.category,
      beneficiary: transaction.beneficiary,
      amount: netAmount(transaction),
    }];
  });
}

function merchantGroups(spendFacts: SpendFact[]): MerchantGroup[] {
  const groups = new Map<string, MerchantGroup>();
  for (const fact of spendFacts) {
    const subject: MerchantGroup["subject"] = {
      type: "merchant",
      merchantKey: fact.merchantKey,
      category: fact.category,
      beneficiary: fact.beneficiary,
    };
    const key = efficiencySubjectFingerprint(subject);
    const group = groups.get(key) ?? { subject, label: fact.merchantLabel, monthly: new Map<string, number>() };
    group.label = fact.merchantLabel;
    group.monthly.set(fact.month, (group.monthly.get(fact.month) ?? 0) + fact.amount);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => efficiencySubjectFingerprint(left.subject).localeCompare(efficiencySubjectFingerprint(right.subject)));
}

function categoryAmount(spendFacts: SpendFact[], month: string, category: CategoryKey, beneficiary: SpendBeneficiary): number {
  return spendFacts
    .filter((fact) => fact.month === month && fact.category === category && beneficiaryEquals(fact.beneficiary, beneficiary))
    .reduce((sum, fact) => sum + fact.amount, 0);
}

function merchantAmount(spendFacts: SpendFact[], month: string, subject: Extract<EfficiencySubject, { type: "merchant" }>): number {
  return spendFacts
    .filter((fact) => fact.month === month
      && fact.merchantKey === subject.merchantKey
      && fact.category === subject.category
      && beneficiaryEquals(fact.beneficiary, subject.beneficiary))
    .reduce((sum, fact) => sum + fact.amount, 0);
}

function latestPlan(plans: EfficiencyPlan[], subject: EfficiencySubject): EfficiencyPlan | undefined {
  const fingerprint = efficiencySubjectFingerprint(subject);
  return plans
    .filter((plan) => plan.fingerprint === fingerprint && plan.state !== "closed")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))[0];
}

function valueWeight(value: LifeValue | undefined): number {
  if (value === "essential") return 0.25;
  if (value === "worthwhile") return 0.65;
  if (value === "questionable") return 1;
  return 0.75;
}

function effortWeight(effort: ChangeEffort | undefined): number {
  if (effort === "easy") return 1;
  if (effort === "hard") return 0.5;
  return 0.75;
}

function makeOpportunity({
  kind,
  subject,
  subjectLabel,
  confidence,
  evidenceMonths,
  currentMonthlyCost,
  baselineMonthlyCost,
  estimatedMonthlySavings,
  suggestedAction,
  evidence,
  income,
  targetGap,
  plan,
  rankingAmount,
  observedMonthlyReduction,
  substitutionWarning,
}: {
  kind: EfficiencyOpportunity["kind"];
  subject: EfficiencySubject;
  subjectLabel: string;
  confidence: EfficiencyOpportunity["confidence"];
  evidenceMonths: string[];
  currentMonthlyCost: number;
  baselineMonthlyCost: number;
  estimatedMonthlySavings: number;
  suggestedAction: EfficiencyAction;
  evidence: string[];
  income: number;
  targetGap: number;
  plan?: EfficiencyPlan;
  rankingAmount?: number;
  observedMonthlyReduction?: number;
  substitutionWarning?: boolean;
}): EfficiencyOpportunity {
  const savings = Math.max(0, estimatedMonthlySavings);
  const coverage = targetGap > 0 ? Math.min(100, (savings / targetGap) * 100) : 0;
  const confidenceWeight = confidence === "high" ? 1 : 0.7;
  const scoreBase = (rankingAmount ?? savings) || currentMonthlyCost * 0.2;
  const score = scoreBase * confidenceWeight * valueWeight(plan?.value) * effortWeight(plan?.effort);
  return {
    fingerprint: opportunityFingerprint(kind, subject),
    kind,
    subject,
    subjectLabel,
    confidence,
    evidenceMonths,
    currentMonthlyCost,
    baselineMonthlyCost,
    estimatedMonthlySavings: savings,
    estimatedAnnualSavings: savings * 12,
    saveRatePoints: income > 0 ? (savings / income) * 100 : 0,
    targetGapCoverage: coverage,
    score,
    suggestedAction,
    evidence,
    ...(plan ? { planId: plan.id } : {}),
    ...(observedMonthlyReduction === undefined ? {} : { observedMonthlyReduction }),
    ...(substitutionWarning === undefined ? {} : { substitutionWarning }),
  };
}

function shouldSuppress(plan: EfficiencyPlan | undefined, month: string, currentCost: number): boolean {
  if (!plan) return false;
  if (plan.state === "planned") return true;
  const materialIncrease = plan.baseline.monthlyAmount > 0 && currentCost >= plan.baseline.monthlyAmount * 1.1;
  if (materialIncrease) return false;
  return Boolean(plan.revisitAfterMonth && month < plan.revisitAfterMonth);
}

function planMeasurement(data: AppData, spendFacts: SpendFact[], plan: EfficiencyPlan): { actual: number; substitutionWarning: boolean } {
  const month = plan.targetMonth ?? "";
  if (!month) return { actual: plan.baseline.monthlyAmount, substitutionWarning: false };
  if (plan.subject.type === "merchant") {
    const actual = merchantAmount(spendFacts, month, plan.subject);
    const categoryBaseline = median(plan.baseline.months.map((item) => categoryAmount(
      spendFacts,
      item,
      plan.subject.category,
      plan.subject.beneficiary,
    )));
    const categoryActual = categoryAmount(spendFacts, month, plan.subject.category, plan.subject.beneficiary);
    const observed = Math.max(0, plan.baseline.monthlyAmount - actual);
    return {
      actual,
      substitutionWarning: observed > 0 && categoryActual > Math.max(0, categoryBaseline - observed * 0.5),
    };
  }
  if (plan.subject.type === "category") {
    return {
      actual: categoryAmount(spendFacts, month, plan.subject.category, plan.subject.beneficiary),
      substitutionWarning: false,
    };
  }
  const fixedSubject = plan.subject as Extract<EfficiencySubject, { type: "fixed_cost" }>;
  const fixed = data.fixedCosts.find((item) => item.id === fixedSubject.fixedCostId);
  const actual = fixed && (!fixed.until || month <= fixed.until) ? Number(fixed.amount || 0) : 0;
  const categoryBaseline = median(plan.baseline.months.map((item) => categoryAmount(
    spendFacts,
    item,
    fixedSubject.category,
    fixedSubject.beneficiary,
  )));
  const categoryActual = categoryAmount(spendFacts, month, fixedSubject.category, fixedSubject.beneficiary);
  const observed = Math.max(0, plan.baseline.monthlyAmount - actual);
  return {
    actual,
    substitutionWarning: observed > 0 && categoryActual > Math.max(0, categoryBaseline - observed * 0.5),
  };
}

/** Compute all recommendations from current authoritative household data. */
export function computeEfficiencySnapshot(data: AppData, month: string, today: Date): EfficiencySnapshot {
  const todayMonth = isoDateOf(today).slice(0, 7);
  const summary = computeMonthSummary(data, month, today);
  const spendFacts = facts(data);
  const windowMonths = completedWindow(month, todayMonth);
  const monthsWithSpend = windowMonths.filter((item) => spendFacts.some((fact) => fact.month === item));
  const baselineMonths = monthsWithSpend.slice(-6);
  const currentDataIncomplete = summary.isCurrentMonth
    && (summary.dataAgeDays === null ? summary.dayNumber > 3 : summary.dataAgeDays >= 7);
  const currentNeedsClassification = summary.monthTransactions.some(needsClassificationReview);
  const readiness: EfficiencyReadiness = currentDataIncomplete
    ? "needs_current_data"
    : currentNeedsClassification
      ? "needs_classification"
      : baselineMonths.length < 3
        ? "building_baseline"
        : "ready";
  const readinessReason = readiness === "needs_current_data"
    ? "Import recent activity before trusting trend recommendations."
    : readiness === "needs_classification"
      ? "Classify this month's spending before comparing it with earlier months."
      : readiness === "building_baseline"
        ? `Mizan has ${baselineMonths.length} of the 3 completed months needed for trend recommendations.`
        : `Based on ${baselineMonths.length} completed months of classified recorded spending.`;
  const targetGap = Math.max(0, summary.projectedSpend - summary.targetSpend);
  const opportunities: EfficiencyOpportunity[] = [];

  if (baselineMonths.length >= 3) {
    const recurringMonths = windowMonths.slice(-4);
    for (const group of merchantGroups(spendFacts)) {
      const observed = recurringMonths
        .map((item) => ({ month: item, amount: group.monthly.get(item) ?? 0 }))
        .filter((item) => item.amount > 0);
      if (observed.length < 3) continue;
      const latest = observed.at(-1)!;
      const earlier = observed.slice(0, -1).map((item) => item.amount);
      const earlierMedian = median(earlier.length ? earlier : observed.map((item) => item.amount));
      const earlierStable = earlier.length < 2 || earlier.every((amount) => Math.abs(amount - earlierMedian) <= earlierMedian * 0.1);
      const allMedian = median(observed.map((item) => item.amount));
      const stable = observed.every((item) => Math.abs(item.amount - allMedian) <= allMedian * 0.1);
      if (!stable && !(earlierStable && latest.amount >= earlierMedian * 1.1)) continue;
      const plan = latestPlan(data.efficiencyPlans, group.subject);
      const analysisAmount = group.monthly.get(month) ?? latest.amount;
      const increase = earlierMedian > 0 && latest.amount >= earlierMedian * 1.1 ? latest.amount - earlierMedian : 0;
      if (shouldSuppress(plan, month, analysisAmount) && increase <= 0) continue;
      const suffix = beneficiaryLabel(group.subject.beneficiary, data);
      const label = `${group.label} · ${suffix}`;
      if (increase > 0) {
        opportunities.push(makeOpportunity({
          kind: "recurring_price_increase",
          subject: group.subject,
          subjectLabel: label,
          confidence: "high",
          evidenceMonths: observed.map((item) => item.month),
          currentMonthlyCost: latest.amount,
          baselineMonthlyCost: earlierMedian,
          estimatedMonthlySavings: increase,
          suggestedAction: plan?.value === "essential" ? "reduce" : "replace",
          evidence: [
            `Latest completed-month cost is ${Math.round((latest.amount / earlierMedian - 1) * 100)}% above its earlier median.`,
            `The comparison uses ${observed.length} completed months for the same purpose and beneficiary.`,
          ],
          income: summary.incomeTotal,
          targetGap,
          plan,
        }));
        continue;
      }
      const kind: EfficiencyOpportunity["kind"] = plan?.value === "questionable"
        ? "questionable_recurring"
        : "recurring_value_check";
      opportunities.push(makeOpportunity({
        kind,
        subject: group.subject,
        subjectLabel: label,
        confidence: "high",
        evidenceMonths: observed.map((item) => item.month),
        currentMonthlyCost: latest.amount,
        baselineMonthlyCost: allMedian,
        estimatedMonthlySavings: kind === "questionable_recurring" ? allMedian : 0,
        suggestedAction: kind === "questionable_recurring" ? "stop" : "keep",
        evidence: [
          `This cost appeared in ${observed.length} of the last ${recurringMonths.length} completed months.`,
          "Monthly amounts stayed within 10% of their median.",
        ],
        income: summary.incomeTotal,
        targetGap,
        plan,
        rankingAmount: allMedian * (kind === "questionable_recurring" ? 1 : 0.2),
      }));
    }
  }

  const trendAllowed = baselineMonths.length >= 3 && (!summary.isCurrentMonth || readiness === "ready");
  if (trendAllowed) {
    const currentFacts = spendFacts.filter((fact) => fact.month === month);
    const subjects = new Map<string, Extract<EfficiencySubject, { type: "category" }>>();
    for (const fact of currentFacts) {
      const subject: Extract<EfficiencySubject, { type: "category" }> = {
        type: "category",
        category: fact.category,
        beneficiary: fact.beneficiary,
      };
      subjects.set(efficiencySubjectFingerprint(subject), subject);
    }
    for (const subject of subjects.values()) {
      const baselineValues = baselineMonths.map((item) => categoryAmount(spendFacts, item, subject.category, subject.beneficiary));
      const baseline = median(baselineValues);
      if (baseline <= 0) continue;
      const actual = categoryAmount(spendFacts, month, subject.category, subject.beneficiary);
      const projected = summary.isCurrentMonth && summary.dayNumber >= 7
        ? (actual / summary.dayNumber) * daysInMonth(month)
        : actual;
      const excess = projected - baseline;
      const materiality = Math.max(baseline * 0.2, summary.ordinaryIncome > 0 ? summary.ordinaryIncome * 0.01 : 0);
      if (excess < materiality) continue;
      const plan = latestPlan(data.efficiencyPlans, subject);
      if (shouldSuppress(plan, month, projected)) continue;
      const category = categoryInfo(subject.category, data.settings.customCategories);
      opportunities.push(makeOpportunity({
        kind: "category_above_baseline",
        subject,
        subjectLabel: `${category.label} · ${beneficiaryLabel(subject.beneficiary, data)}`,
        confidence: summary.isCurrentMonth ? "medium" : "high",
        evidenceMonths: baselineMonths,
        currentMonthlyCost: projected,
        baselineMonthlyCost: baseline,
        estimatedMonthlySavings: excess,
        suggestedAction: "reduce",
        evidence: [
          `${summary.isCurrentMonth ? "Projected" : "Recorded"} spend is at least 20% above the completed-month median.`,
          `Returning to the personal baseline would reduce the month by the estimated excess.`,
        ],
        income: summary.incomeTotal,
        targetGap,
        plan,
      }));
    }
  }

  for (const fixed of summary.endingSoon) {
    const subject: Extract<EfficiencySubject, { type: "fixed_cost" }> = {
      type: "fixed_cost",
      fixedCostId: fixed.id,
      category: fixed.category,
      beneficiary: fixed.beneficiary,
    };
    const plan = latestPlan(data.efficiencyPlans, subject);
    if (shouldSuppress(plan, month, Number(fixed.amount || 0))) continue;
    opportunities.push(makeOpportunity({
      kind: "commitment_ending",
      subject,
      subjectLabel: fixed.label,
      confidence: "high",
      evidenceMonths: fixed.until ? [fixed.until] : [],
      currentMonthlyCost: Number(fixed.amount || 0),
      baselineMonthlyCost: Number(fixed.amount || 0),
      estimatedMonthlySavings: Number(fixed.amount || 0),
      suggestedAction: "stop",
      evidence: [
        `The commitment is configured to end in ${fixed.until}.`,
        "This is money becoming available, not a saving already achieved.",
      ],
      income: summary.incomeTotal,
      targetGap,
      plan,
      rankingAmount: Number(fixed.amount || 0) * 0.4,
    }));
  }

  const awaitingVerification: EfficiencyOpportunity[] = [];
  for (const plan of data.efficiencyPlans.filter((item) => item.state === "planned" && item.targetMonth && item.targetMonth < todayMonth)) {
    const targetHasUnresolvedSpend = data.transactions.some(
      (transaction) => monthOf(transaction.date) === plan.targetMonth && needsClassificationReview(transaction),
    );
    if (targetHasUnresolvedSpend) continue;
    const measurement = planMeasurement(data, spendFacts, plan);
    const observedReduction = Math.max(0, plan.baseline.monthlyAmount - measurement.actual);
    awaitingVerification.push(makeOpportunity({
      kind: "verification_due",
      subject: plan.subject,
      subjectLabel: plan.subjectLabel,
      confidence: "medium",
      evidenceMonths: [...plan.baseline.months, plan.targetMonth!],
      currentMonthlyCost: measurement.actual,
      baselineMonthlyCost: plan.baseline.monthlyAmount,
      estimatedMonthlySavings: plan.targetMonthlySavings,
      suggestedAction: plan.action,
      evidence: [
        `The target month ${plan.targetMonth} has ended.`,
        "Confirm statement coverage before treating the observed reduction as an outcome.",
      ],
      income: summary.incomeTotal,
      targetGap,
      plan,
      rankingAmount: Math.max(plan.targetMonthlySavings, observedReduction) * 2,
      observedMonthlyReduction: observedReduction,
      substitutionWarning: measurement.substitutionWarning,
    }));
  }
  opportunities.push(...awaitingVerification);

  opportunities.sort((left, right) => right.score - left.score || left.fingerprint.localeCompare(right.fingerprint));
  return {
    readiness,
    readinessReason,
    baselineMonths,
    targetGap,
    opportunities,
    topOpportunities: opportunities.slice(0, 3),
    awaitingVerification,
  };
}

/** Build a persisted household decision from a derived opportunity. */
export function createEfficiencyPlan(
  opportunity: EfficiencyOpportunity,
  input: EfficiencyPlanInput,
  contextMonth: string,
  now: string,
  existing?: EfficiencyPlan,
): EfficiencyPlan {
  const keep = input.action === "keep";
  if (!keep && !/^\d{4}-\d{2}$/.test(input.targetMonth ?? "")) {
    throw new Error("Choose a target month for this change.");
  }
  if (!keep && !(Number(input.targetMonthlySavings) > 0)) {
    throw new Error("Enter a positive expected monthly saving.");
  }
  const fingerprint = efficiencySubjectFingerprint(opportunity.subject);
  const baselineAmount = opportunity.baselineMonthlyCost || opportunity.currentMonthlyCost;
  return {
    id: existing?.state === "watching" ? existing.id : `effplan_${stableHash(`${fingerprint}\u0000${now}`)}`,
    fingerprint,
    subject: opportunity.subject,
    subjectLabel: opportunity.subjectLabel,
    value: input.value,
    action: input.action,
    effort: input.effort,
    state: keep ? "watching" : "planned",
    baseline: {
      months: opportunity.evidenceMonths,
      monthlyAmount: baselineAmount,
      measurementScope: opportunity.subject.type === "merchant"
        ? "merchant"
        : opportunity.subject.type === "category" ? "category" : "fixed_cost",
    },
    targetMonthlySavings: keep ? 0 : Math.max(0, Number(input.targetMonthlySavings) || 0),
    ...(keep ? { revisitAfterMonth: addMonths(contextMonth, 6) } : { targetMonth: input.targetMonth }),
    createdAt: existing?.state === "watching" ? existing.createdAt : now,
    updatedAt: now,
  };
}

/** Confirm an observed outcome without changing any ledger total. */
export function confirmEfficiencyOutcome(
  plan: EfficiencyPlan,
  opportunity: EfficiencyOpportunity,
  result: EfficiencyOutcomeResult,
  confirmedAt: string,
): EfficiencyPlan {
  if (opportunity.kind !== "verification_due" || opportunity.planId !== plan.id) {
    throw new Error("This verification no longer matches the selected plan.");
  }
  const month = plan.targetMonth;
  if (!month) throw new Error("This plan has no target month to verify.");
  return {
    ...plan,
    state: "verified",
    updatedAt: confirmedAt,
    revisitAfterMonth: addMonths(month, 6),
    outcome: {
      month,
      observedMonthlyReduction: Math.max(0, opportunity.observedMonthlyReduction ?? 0),
      result,
      confirmedAt,
      dataComplete: true,
      substitutionWarning: Boolean(opportunity.substitutionWarning),
    },
  };
}

/** Close plans whose beneficiary or purpose was removed from household setup. */
export function closeInvalidEfficiencyPlans(
  plans: EfficiencyPlan[],
  validMemberIds: Set<string>,
  validCategoryKeys: Set<string>,
  now: string,
  closedReason: "subject_removed" | "subject_inactive" = "subject_removed",
): EfficiencyPlan[] {
  return plans.map((plan) => {
    if (plan.state === "closed") return plan;
    const beneficiaryValid = plan.subject.beneficiary.type !== "member"
      || validMemberIds.has(plan.subject.beneficiary.memberId);
    const categoryValid = !plan.subject.category.startsWith("custom:")
      || validCategoryKeys.has(plan.subject.category);
    return beneficiaryValid && categoryValid ? plan : {
      ...plan,
      state: "closed",
      closedReason,
      updatedAt: now,
    };
  });
}
