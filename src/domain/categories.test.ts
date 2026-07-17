import { describe, expect, it } from "vitest";
import { categoryInfo, isCategoryKey, spendingCategoryOptions } from "./categories";

describe("fixed categories", () => {
  it("keeps the food key while exposing the groceries, utilities, and dining labels", () => {
    expect(categoryInfo("food")).toMatchObject({ label: "Groceries" });
    expect(categoryInfo("utilities")).toMatchObject({ label: "Bills & Utilities" });
    expect(categoryInfo("dining")).toMatchObject({ label: "Dining" });
  });

  it("orders essentials before dining and lifestyle", () => {
    expect(spendingCategoryOptions().map(({ key }) => key)).toEqual([
      "housing",
      "food",
      "utilities",
      "transport",
      "health",
      "dining",
      "lifestyle",
      "family_support",
      "investments",
    ]);
  });

  it("keeps purpose independent from the beneficiary", () => {
    expect(spendingCategoryOptions().map(({ key }) => key)).not.toContain("personal:sam");
    expect(isCategoryKey("personal:sam")).toBe(false);
    expect(isCategoryKey("custom:education")).toBe(true);
  });

  it("does not accept object prototype properties as category keys", () => {
    expect(isCategoryKey("constructor")).toBe(false);
    expect(isCategoryKey("toString")).toBe(false);
  });
});
