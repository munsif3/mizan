import { describe, expect, it } from "vitest";
import { categoryInfo, spendingCategoryOptions } from "./categories";

describe("fixed categories", () => {
  it("keeps the food key while exposing the groceries, utilities, and dining labels", () => {
    expect(categoryInfo("food", [])).toMatchObject({ label: "Groceries" });
    expect(categoryInfo("utilities", [])).toMatchObject({ label: "Bills & Utilities" });
    expect(categoryInfo("dining", [])).toMatchObject({ label: "Dining" });
  });

  it("orders essentials before dining and lifestyle", () => {
    expect(spendingCategoryOptions([], []).map(({ key }) => key)).toEqual([
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
});
