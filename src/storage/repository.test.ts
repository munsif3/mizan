import { describe, expect, it } from "vitest";
import { clearLegacyLocalData, hasLegacyLocalData, loadLegacyLocalData, STORAGE_KEY } from "./localStore";
import { emptyData } from "./schema";

describe("legacy local data migration helpers", () => {
  it("detects, loads, and clears the old browser financial payload", () => {
    clearLegacyLocalData();
    expect(hasLegacyLocalData()).toBe(false);
    expect(loadLegacyLocalData()).toBeNull();

    const data = emptyData();
    data.settings.members = [{ id: "owner", name: "Owner", color: "#5b8cff", portions: [{ id: "por_owner", label: "Monthly income", amount: 1000, currency: "USD", taxRate: 0, taxWithheld: true, window: null }] }];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

    expect(hasLegacyLocalData()).toBe(true);
    expect(loadLegacyLocalData()).toEqual(data);

    clearLegacyLocalData();
    expect(hasLegacyLocalData()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
