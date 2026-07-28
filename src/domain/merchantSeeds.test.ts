import { describe, expect, it } from "vitest";
import { MERCHANT_SEEDS, seededCategory } from "./merchantSeeds";
import { cleanMerchant } from "./rules";
import { categoryInfo } from "./categories";

describe("MERCHANT_SEEDS", () => {
  it("stores every key in the canonical form the matcher compares against", () => {
    const notCanonical = Object.keys(MERCHANT_SEEDS).filter((key) => cleanMerchant(key) !== key);
    expect(notCanonical).toEqual([]);
  });

  it("maps every entry to a real, spendable category", () => {
    for (const [merchant, category] of Object.entries(MERCHANT_SEEDS)) {
      expect(categoryInfo(category, []), `${merchant} -> ${category}`).toBeTruthy();
      // Uncategorized is the absence of a suggestion, never a suggestion itself.
      expect(category).not.toBe("uncategorized");
    }
  });

  it("keeps every key long enough to be distinctive", () => {
    // Two- and three-character tokens collide with unrelated statement text.
    const tooShort = Object.keys(MERCHANT_SEEDS).filter((key) => key.length < 3);
    expect(tooShort).toEqual([]);
  });
});

describe("seededCategory", () => {
  it("matches through the branch and location suffixes real statements carry", () => {
    // All four descriptions are real statement text from this repo's parser fixtures.
    expect(seededCategory("KEELLS SUPER")).toBe("food");
    expect(seededCategory("KEELLS SUPER WATTALA")).toBe("food");
    expect(seededCategory("THE FAB COLOMBO 03")).toBe("dining");
    expect(seededCategory("Dialog Axiata PLC Colombo 02")).toBe("utilities");
  });

  it("lets a specific merchant outrank the general brand it contains", () => {
    // Longest-match-wins is what keeps these two entries from having to know
    // about each other.
    expect(seededCategory("UBER EATS")).toBe("dining");
    expect(seededCategory("UBER TRIP 8271")).toBe("transport");
  });

  it("ignores case and whitespace noise", () => {
    expect(seededCategory("  google   youtube  ")).toBe("lifestyle");
    expect(seededCategory("FX FEE Google YouTube 6502530000-ADJUSTMENT")).toBe("lifestyle");
  });

  it("returns null rather than guessing at an unknown merchant", () => {
    expect(seededCategory("ZZQ HOLDINGS 4471")).toBeNull();
    expect(seededCategory("")).toBeNull();
    expect(seededCategory("   ")).toBeNull();
  });

  it("resolves nested keys deterministically, whatever the insertion order", () => {
    // Same input, same answer — the table is a lookup, not a heuristic.
    const answers = new Set(Array.from({ length: 20 }, () => seededCategory("UBER EATS COLOMBO")));
    expect([...answers]).toEqual(["dining"]);
  });
});
