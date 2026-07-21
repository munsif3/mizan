import { describe, expect, it } from "vitest";
import { memberParticipatesInMonth, memberStatusOn, normalizedMemberLifecycle } from "./memberLifecycle";
import type { Member } from "./types";

const member: Member = {
  id: "sam",
  name: "Sam",
  color: "#fff",
  portions: [],
  lifecycle: {
    activeFrom: "2026-01-01",
    inactiveFrom: "2026-08-01",
    inactiveReason: "deceased",
    awayPeriods: [{ id: "trip", from: "2026-07-10", resumeOn: "2026-07-20" }],
  },
};

describe("member lifecycle", () => {
  it("derives not-started, away, active, and deceased states by date", () => {
    expect(memberStatusOn(member, "2025-12-31")).toBe("not_started");
    expect(memberStatusOn(member, "2026-07-15")).toBe("away");
    expect(memberStatusOn(member, "2026-07-20")).toBe("active");
    expect(memberStatusOn(member, "2026-08-01")).toBe("deceased");
  });

  it("keeps a month participating when at least one day is active", () => {
    expect(memberParticipatesInMonth(member, "2026-07")).toBe(true);
    expect(memberParticipatesInMonth(member, "2026-08")).toBe(false);
  });

  it("drops malformed dates and normalizes absence order", () => {
    expect(normalizedMemberLifecycle({
      activeFrom: "bad",
      awayPeriods: [{ from: "2026-07-20" }, { from: "2026-07-10", resumeOn: "2026-07-09" }],
    })).toEqual({
      awayPeriods: [
        { id: "away_1_2026-07-10", from: "2026-07-10" },
        { id: "away_0_2026-07-20", from: "2026-07-20" },
      ],
    });
    expect(normalizedMemberLifecycle({ inactiveReason: "left", awayPeriods: [] })).toBeUndefined();
    expect(normalizedMemberLifecycle({
      activeFrom: "2026-08-01",
      inactiveFrom: "2026-07-01",
      inactiveReason: "left",
      awayPeriods: [],
    })).toEqual({ activeFrom: "2026-08-01", awayPeriods: [] });
  });
});
