import { describe, expect, it } from "vitest";
import { emptyData } from "../storage/schema";
import { computeAssetSnapshot } from "./assets";

describe("computeAssetSnapshot", () => {
  it("keeps explicit value separate from transaction-derived cost basis", () => {
    const data = emptyData();
    data.settings.currency = "LKR";
    data.assetHoldings = [
      {
        id: "property",
        label: "Family property",
        type: "property",
        currency: "LKR",
        owner: "joint",
        status: "active",
        valuations: [{ id: "v1", date: "2026-06-30", amount: 25_000_000 }],
      },
      {
        id: "fd",
        label: "One-year FD",
        type: "fixed_deposit",
        currency: "LKR",
        owner: "unassigned",
        status: "active",
        valuations: [],
      },
    ];
    data.transactions = [{
      id: "contribution",
      date: "2026-07-01",
      description: "FD PLACEMENT",
      amount: 500_000,
      category: "uncategorized",
      beneficiary: { type: "unassigned" },
      account: "Savings",
      note: "",
      source: "imported",
      direction: "debit",
      kind: "investment_transfer",
      holdingId: "fd",
    }];

    const snapshot = computeAssetSnapshot(data, "2026-07");
    expect(snapshot.totalValue).toBe(25_000_000);
    expect(snapshot.contributed).toBe(500_000);
    expect(snapshot.unvaluedCount).toBe(1);
    expect(snapshot.rows.find((row) => row.holding.id === "fd")).toMatchObject({
      contributed: 500_000,
      nativeValue: null,
      value: null,
    });
  });

  it("uses dated valuations and requires an FX rate for foreign holdings", () => {
    const data = emptyData();
    data.settings.currency = "LKR";
    data.settings.fxRates = { USD: 300 };
    data.assetHoldings = [{
      id: "cash",
      label: "USD cash",
      type: "cash",
      currency: "USD",
      owner: "unassigned",
      status: "active",
      valuations: [
        { id: "old", date: "2026-06-30", amount: 1_000 },
        { id: "future", date: "2026-08-01", amount: 2_000 },
      ],
    }];
    expect(computeAssetSnapshot(data, "2026-07").totalValue).toBe(300_000);
    data.settings.fxRates = {};
    expect(computeAssetSnapshot(data, "2026-07")).toMatchObject({ totalValue: 0, unvaluedCount: 1 });
  });
});
