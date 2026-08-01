import { describe, expect, it } from "vitest";
import { migrateView } from "./localConvenience";

describe("migrateView", () => {
  it.each([
    ["home", "balance"],
    ["transactions", "ledger"],
    ["history", "trend"],
    ["balance", "balance"],
    ["sort", "sort"],
    ["ledger", "ledger"],
    ["trend", "trend"],
    ["", "balance"],
    ["unknown", "balance"],
  ])("maps %s to %s", (value, expected) => {
    expect(migrateView(value)).toBe(expected);
  });
});
