import { WEEKLY_CLOSE_STEP_IDS, type WeeklyClose, type WeeklyCloseStep } from "./types";

export { WEEKLY_CLOSE_STEP_IDS };

function utcDayOfWeek(date: Date): number {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

/** Return the ISO week key for a date without depending on the browser locale. */
export function weeklyCloseWeekIso(date = new Date()): string {
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 4 - utcDayOfWeek(thursday));
  const year = thursday.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function weeklyCloseWeekNumber(weekIso: string): number {
  const match = /^\d{4}-W(\d{2})$/.exec(weekIso);
  return match ? Number(match[1]) : 0;
}

export function weeklyCloseId(uid: string, weekIso: string): string {
  return `weekly_close_${uid}_${weekIso}`;
}

export interface WeeklyCloseQueueItem {
  count: number;
  total: number;
}

function isWeeklyCloseStep(value: unknown): value is WeeklyCloseStep {
  return typeof value === "string" && (WEEKLY_CLOSE_STEP_IDS as readonly string[]).includes(value);
}

/**
 * Validate the small, user-scoped document before it reaches presentation code.
 * Firestore data is runtime input even when the TypeScript model is trusted.
 */
export function normalizeWeeklyClose(value: unknown, fallbackId = ""): WeeklyClose | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" && raw.id ? raw.id : fallbackId;
  const householdId = typeof raw.householdId === "string" ? raw.householdId : "";
  const uid = typeof raw.uid === "string" ? raw.uid : "";
  const weekIso = typeof raw.weekIso === "string" ? raw.weekIso : "";
  if (!id || !householdId || !uid || !/^\d{4}-W\d{2}$/.test(weekIso)) return null;
  const stepsCompleted = Array.isArray(raw.stepsCompleted)
    ? raw.stepsCompleted.filter(isWeeklyCloseStep)
    : [];
  const sortedCount = typeof raw.sortedCount === "number" && Number.isFinite(raw.sortedCount)
    ? Math.max(0, Math.floor(raw.sortedCount))
    : 0;
  return {
    id,
    householdId,
    uid,
    weekIso,
    closedAt: typeof raw.closedAt === "string" ? raw.closedAt : "",
    stepsCompleted,
    sortedCount,
    ...(typeof raw.committedPlanId === "string" && raw.committedPlanId
      ? { committedPlanId: raw.committedPlanId }
      : {}),
  };
}

/** Report only the rows and amount actually removed from the sort queue. */
export function weeklyCloseSortProgress(
  initialQueue: readonly WeeklyCloseQueueItem[],
  remainingQueue: readonly WeeklyCloseQueueItem[],
  startingSortedCount = 0,
): { count: number; amount: number } {
  const initialCount = initialQueue.reduce((sum, item) => sum + Math.max(0, item.count), 0);
  const remainingCount = remainingQueue.reduce((sum, item) => sum + Math.max(0, item.count), 0);
  const initialAmount = initialQueue.reduce((sum, item) => sum + Math.max(0, item.total), 0);
  const remainingAmount = remainingQueue.reduce((sum, item) => sum + Math.max(0, item.total), 0);
  return {
    count: Math.max(0, startingSortedCount) + Math.max(0, initialCount - remainingCount),
    amount: Math.max(0, initialAmount - remainingAmount),
  };
}

export function weeklyCloseIsClosed(record: Pick<WeeklyClose, "stepsCompleted" | "closedAt"> | null | undefined): boolean {
  if (!record?.closedAt) return false;
  const stepsCompleted = Array.isArray(record.stepsCompleted) ? record.stepsCompleted : [];
  return WEEKLY_CLOSE_STEP_IDS.every((step) => stepsCompleted.includes(step));
}

export function firstIncompleteWeeklyCloseStep(record: Pick<WeeklyClose, "stepsCompleted"> | null | undefined): number {
  const completed = Array.isArray(record?.stepsCompleted) ? record.stepsCompleted : [];
  return WEEKLY_CLOSE_STEP_IDS.findIndex((step) => !completed.includes(step));
}

function previousWeek(weekIso: string): string {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekIso);
  if (!match) return "";
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - utcDayOfWeek(jan4) + 1 + (week - 1) * 7 - 7);
  return weeklyCloseWeekIso(monday);
}

/** Count the honest contiguous streak, excluding an unfinished current week. */
export function weeklyCloseStreak(records: WeeklyClose[], currentWeekIso = weeklyCloseWeekIso()): number {
  const closed = new Set(records.filter(weeklyCloseIsClosed).map((record) => record.weekIso));
  let cursor = closed.has(currentWeekIso) ? currentWeekIso : previousWeek(currentWeekIso);
  let count = 0;
  while (cursor && closed.has(cursor)) {
    count += 1;
    cursor = previousWeek(cursor);
  }
  return count;
}
