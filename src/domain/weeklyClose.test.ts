import { describe, expect, it } from "vitest";
import {
  firstIncompleteWeeklyCloseStep,
  normalizeWeeklyClose,
  weeklyCloseSortProgress,
  weeklyCloseIsClosed,
  weeklyCloseStreak,
  weeklyCloseWeekIso,
} from "./weeklyClose";
import type { WeeklyClose } from "./types";

function close(weekIso: string, stepsCompleted: WeeklyClose["stepsCompleted"] = ["catch-up", "sort", "read", "decide"]): WeeklyClose {
  return {
    id: `close_${weekIso}`,
    householdId: "household",
    uid: "owner",
    weekIso,
    closedAt: "2026-07-31T00:00:00.000Z",
    stepsCompleted,
    sortedCount: 0,
  };
}

describe("weekly close semantics", () => {
  it("uses the ISO week and keeps all four answers explicit", () => {
    expect(weeklyCloseWeekIso(new Date("2026-07-31T00:00:00.000Z"))).toBe("2026-W31");
    expect(firstIncompleteWeeklyCloseStep({ stepsCompleted: ["catch-up", "sort"] })).toBe(2);
    expect(weeklyCloseIsClosed(close("2026-W31"))).toBe(true);
    expect(weeklyCloseIsClosed(close("2026-W31", ["catch-up", "sort", "read"]))).toBe(false);
    expect(weeklyCloseIsClosed({ ...close("2026-W31"), closedAt: "" })).toBe(false);
  });

  it("does not carry a streak across an ignored week", () => {
    expect(weeklyCloseStreak([close("2026-W29"), close("2026-W30")], "2026-W31")).toBe(2);
    expect(weeklyCloseStreak([close("2026-W28")], "2026-W31")).toBe(0);
    expect(weeklyCloseStreak([close("2026-W30"), close("2026-W31")], "2026-W31")).toBe(2);
  });

  it("normalizes malformed cloud records without allowing render-time failures", () => {
    expect(normalizeWeeklyClose({
      householdId: "household",
      uid: "user",
      weekIso: "2026-W31",
      stepsCompleted: ["catch-up", "unknown", null],
      sortedCount: -4.8,
      closedAt: 123,
    }, "doc-1")).toEqual({
      id: "doc-1",
      householdId: "household",
      uid: "user",
      weekIso: "2026-W31",
      closedAt: "",
      stepsCompleted: ["catch-up"],
      sortedCount: 0,
    });
    expect(normalizeWeeklyClose({ stepsCompleted: "sort" }, "doc-2")).toBeNull();
    expect(firstIncompleteWeeklyCloseStep({ stepsCompleted: undefined as never })).toBe(0);
  });

  it("reports the rows and amount actually sorted during a close", () => {
    expect(weeklyCloseSortProgress(
      [{ count: 4, total: 1_000 }, { count: 2, total: 500 }],
      [{ count: 1, total: 250 }],
      3,
    )).toEqual({ count: 8, amount: 1_250 });
    expect(weeklyCloseSortProgress([{ count: 1, total: 10 }], [{ count: 3, total: 40 }])).toEqual({ count: 0, amount: 0 });
  });
});
