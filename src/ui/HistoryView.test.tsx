import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { HistoryRow } from "../domain/summary";
import { HistoryView } from "./HistoryView";

const rows: HistoryRow[] = [
  { month: "2026-06", income: 100_000, spend: 80_000, saved: 20_000, rate: 20 },
  { month: "2026-07", income: 100_000, spend: 90_000, saved: 10_000, rate: 10 },
];

describe("HistoryView selected month", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  async function render(currentMonth: string) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <HistoryView
          rows={rows}
          currentMonth={currentMonth}
          targetSaveRate={15}
          money={(value) => `LKR ${value}`}
        />,
      );
    });
  }

  it("shows the selected populated month", async () => {
    await render("2026-06");

    expect(container?.textContent).toContain("Selected month");
    expect(container?.textContent).toContain("Jun 2026 save rate");
    expect(container?.textContent).toContain("20.0%");
  });

  it("does not fall back to the latest row for an empty selectable month", async () => {
    await render("2026-05");

    expect(container?.textContent).toContain("No data");
    expect(container?.textContent).toContain("No recorded data for May 2026.");
    expect(container?.textContent).not.toContain("Jul 2026 save rate");
    expect(container?.textContent).toContain("Average");
    expect(container?.textContent).toContain("15.0%");
  });
});
