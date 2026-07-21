import { describe, expect, it } from "vitest";
import {
  isSyncProblem,
  sync,
  syncBadgeLabel,
  syncBadgeTone,
  syncChipLabel,
  type SyncState,
} from "./syncState";

const cases: { state: SyncState; chip: string; tone: string; badge: string; problem: boolean }[] = [
  { state: sync.idle("Signed out"), chip: "Firestore", tone: "success", badge: "Saved", problem: false },
  { state: sync.syncing("Saving to Firestore"), chip: "Syncing", tone: "warning", badge: "Saving", problem: false },
  { state: sync.synced("Synced to Firestore"), chip: "Synced", tone: "success", badge: "Saved", problem: false },
  { state: sync.conflict("Your edit conflicts"), chip: "Conflict", tone: "danger", badge: "Conflict", problem: true },
  { state: sync.error("Save failed: offline"), chip: "Sync issue", tone: "danger", badge: "Sync issue", problem: true },
];

describe("syncState", () => {
  it("derives chip label, badge tone/label, and problem flag from the kind", () => {
    for (const { state, chip, tone, badge, problem } of cases) {
      expect(syncChipLabel(state)).toBe(chip);
      expect(syncBadgeTone(state)).toBe(tone);
      expect(syncBadgeLabel(state)).toBe(badge);
      expect(isSyncProblem(state)).toBe(problem);
    }
  });

  it("preserves the human message for tooltips and detail text", () => {
    expect(sync.error("Save failed: offline").message).toBe("Save failed: offline");
    expect(sync.synced("Synced with Shared budget").kind).toBe("synced");
  });
});
