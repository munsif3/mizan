import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { computeMonthSummary, type MonthSummary } from "../domain/summary";
import { emptyData } from "../storage/schema";
import {
  BALANCE_INSTRUMENT_GEOMETRY,
  BalanceInstrument,
  balanceInstrumentFits,
  balanceInstrumentTilt,
  minimumBalanceInstrumentWidth,
} from "./BalanceInstrument";

function summaryFixture(): MonthSummary {
  const data = emptyData();
  data.settings.currency = "LKR";
  data.settings.locale = "en-LK";
  data.settings.members = [{
    id: "alex",
    name: "Alex",
    color: "#14483a",
    portions: [{
      id: "income",
      label: "Income",
      amount: 600_000,
      currency: "LKR",
      taxRate: 0,
      taxWithheld: true,
      window: null,
      schedule: { frequency: "monthly" },
      budgetTreatment: "ordinary",
    }],
  }];
  data.transactions = [{
    id: "groceries",
    date: "2026-07-10",
    description: "GROCERIES",
    amount: 20_000,
    category: "food",
    beneficiary: { type: "member", memberId: "alex" },
    account: "Alex Card",
    note: "",
    source: "imported",
    direction: "debit",
    kind: "expense",
  }];
  return computeMonthSummary(data, "2026-07", new Date(2026, 6, 15));
}

describe("BalanceInstrument", () => {
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

  it("uses the exact saved-versus-promised tilt formula and clamps at seven degrees", () => {
    expect(balanceInstrumentTilt(178_400, 223_000)).toBeCloseTo(4);
    expect(balanceInstrumentTilt(0, 223_000)).toBe(7);
    expect(balanceInstrumentTilt(500_000, 223_000)).toBe(-7);
    expect(balanceInstrumentTilt(50_000, 0)).toBe(0);
  });

  it("keeps the pans within the desktop and mobile card insets", () => {
    expect(BALANCE_INSTRUMENT_GEOMETRY.desktop).toEqual({
      beamWidth: 250,
      panWidth: 120,
      containerHeight: 206,
      cardInset: 26,
    });
    expect(BALANCE_INSTRUMENT_GEOMETRY.mobile).toEqual({
      beamWidth: 190,
      panWidth: 104,
      containerHeight: 168,
      cardInset: 26,
    });

    expect(minimumBalanceInstrumentWidth(BALANCE_INSTRUMENT_GEOMETRY.desktop)).toBe(422);
    expect(minimumBalanceInstrumentWidth(BALANCE_INSTRUMENT_GEOMETRY.mobile)).toBe(346);
    expect(balanceInstrumentFits(566, BALANCE_INSTRUMENT_GEOMETRY.desktop)).toBe(true);
    expect(balanceInstrumentFits(688, BALANCE_INSTRUMENT_GEOMETRY.mobile)).toBe(true);
    expect(balanceInstrumentFits(358, BALANCE_INSTRUMENT_GEOMETRY.mobile)).toBe(true);
    expect(balanceInstrumentFits(345, BALANCE_INSTRUMENT_GEOMETRY.mobile)).toBe(false);
  });

  it("renders saved against promised, settles the beam, and derives the history clause and bars", async () => {
    const base = summaryFixture();
    const summary = {
      ...base,
      projectedSaved: 120_000,
      projectedSaveRate: 20,
      targetSaveRate: 25,
    };
    const history = [
      { ...base, month: "2026-04", saveRate: 30 },
      { ...base, month: "2026-05", saveRate: 25 },
      { ...base, month: "2026-06", saveRate: 22 },
    ];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(
      <BalanceInstrument
        summary={summary}
        history={history}
        money={(value) => `LKR ${value.toLocaleString("en")}`}
        percent={(value) => `${value.toFixed(0)}%`}
        financialValuesHidden={false}
      />,
    ));

    expect(container.textContent).toContain("Actually savedLKR 120,000");
    expect(container.textContent).toContain("You promisedLKR 150,000");
    expect(container.textContent).toContain("The beam is off by LKR 30,000 — a fifth of the way tipped.");
    expect(container.textContent).toContain("It sat level in April and May.");
    expect(container.querySelector<HTMLElement>(".balance-instrument-beam")?.style.getPropertyValue("--balance-tilt")).toBe("4deg");
    expect(container.querySelector<HTMLElement>(".balance-instrument-beam")?.style.getPropertyValue("--balance-counter-tilt")).toBe("-4deg");
    expect([...container.querySelectorAll(".balance-instrument-month")].map((item) => item.textContent)).toEqual([
      "Apr",
      "May",
      "Jun",
      "Jul",
    ]);
    expect(container.querySelectorAll('.balance-instrument-month[data-status="met"]')).toHaveLength(2);
    expect(container.querySelectorAll('.balance-instrument-month[data-status="near"]')).toHaveLength(1);
    expect(container.querySelectorAll('.balance-instrument-month[data-status="below"]')).toHaveLength(1);
  });
});
