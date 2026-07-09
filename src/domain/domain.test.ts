import { describe, expect, it } from "vitest";
import { addMonths, daysInMonth, monthLabel, monthOf, toISODate, toISODateOrdered } from "./dates";
import { filterNew, transactionSignature } from "./dedupe";
import { formatMoney, parseAmount } from "./money";
import { applyRules, cleanMerchant, matchRule, withRule } from "./rules";
import type { MerchantRules, Transaction } from "./types";

function txn(overrides: Partial<Transaction>): Transaction {
  return {
    id: "t1",
    date: "2026-07-01",
    description: "KEELLS SUPER",
    amount: 1000,
    category: "uncategorized",
    account: "Everyday Visa",
    note: "",
    source: "imported",
    direction: "debit",
    ...overrides,
  };
}

describe("money", () => {
  it("formats rounded amounts with the currency code and locale grouping", () => {
    // Intl separates the code from the number with a (narrow) no-break space; \s normalizes it.
    const fmt = (v: number, currency: string, locale: string) =>
      formatMoney(v, { currency, locale }).replace(/\s/g, " ");
    expect(fmt(120000.4, "USD", "en-US")).toBe("USD 120,000");
    expect(fmt(NaN, "LKR", "en-LK")).toBe("LKR 0");
    // Unknown/empty currency code degrades to a readable string rather than throwing.
    expect(fmt(1000, "", "")).toBe("1,000");
  });

  it("parses statement amounts including CR/parenthesis negatives", () => {
    expect(parseAmount("1,250.50")).toBe(1250.5);
    expect(parseAmount("(300.00)")).toBe(-300);
    expect(parseAmount("450.00 CR")).toBe(-450);
    expect(parseAmount("600.00-")).toBe(-600);
    expect(parseAmount("garbage")).toBe(0);
  });
});

describe("dates", () => {
  it("converts statement date formats to ISO", () => {
    expect(toISODate("14/07/2026")).toBe("2026-07-14");
    expect(toISODate("5-3-26")).toBe("2026-03-05");
    expect(toISODate("2026-7-4")).toBe("2026-07-04");
    expect(toISODate("not a date")).toBe("");
  });

  it("parses dates with an explicit component order for CSV imports", () => {
    expect(toISODateOrdered("13/07/2026", "dmy")).toBe("2026-07-13");
    expect(toISODateOrdered("07/13/2026", "mdy")).toBe("2026-07-13");
    expect(toISODateOrdered("2026-07-13", "dmy")).toBe("2026-07-13"); // ISO always wins
    expect(toISODateOrdered("13.07.26", "dmy")).toBe("2026-07-13");
    expect(toISODateOrdered("31/31/2026", "dmy")).toBe(""); // invalid month
    expect(toISODateOrdered("not a date", "dmy")).toBe("");
  });

  it("does month arithmetic across year boundaries", () => {
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthOf("2026-07-14")).toBe("2026-07");
    expect(monthLabel("2026-09")).toBe("Sep 2026");
    expect(daysInMonth("2026-02")).toBe(28);
  });
});

describe("rules engine", () => {
  const rules: MerchantRules = withRule(
    withRule(withRule({}, "KEELLS", "food"), "KEELLS PHARMACY", "lifestyle"),
    "UBER", "transport",
  );

  it("prefers exact match, then longest substring", () => {
    expect(matchRule("KEELLS", rules)).toBe("food");
    expect(matchRule("KEELLS PHARMACY COLOMBO", rules)).toBe("lifestyle");
    expect(matchRule("KEELLS SUPER WATTALA", rules)).toBe("food");
    expect(matchRule("UBER *TRIP", rules)).toBe("transport");
    expect(matchRule("UNKNOWN SHOP", rules)).toBeNull();
  });

  it("is order-independent (deterministic)", () => {
    const forward = withRule(withRule({}, "ABC", "food"), "ABC XYZ", "transport");
    const reversed = withRule(withRule({}, "ABC XYZ", "transport"), "ABC", "food");
    expect(matchRule("ABC XYZ STORE", forward)).toBe("transport");
    expect(matchRule("ABC XYZ STORE", reversed)).toBe("transport");
  });

  it("normalizes merchants and re-applies across transactions", () => {
    expect(cleanMerchant("  keells   super ")).toBe("KEELLS SUPER");
    const result = applyRules([txn({}), txn({ id: "t2", description: "PickMe Ride" })], rules);
    expect(result[0]!.category).toBe("food");
    expect(result[1]!.category).toBe("uncategorized");
  });
});

describe("dedupe", () => {
  it("skips transactions already imported and duplicates within a batch", () => {
    const existing = [txn({})];
    const incoming = [
      txn({ id: "other-id" }), // same signature as existing
      txn({ id: "t3", amount: 999 }),
      txn({ id: "t4", amount: 999 }), // duplicate within batch
    ];
    const fresh = filterNew(existing, incoming);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]!.amount).toBe(999);
  });

  it("signature ignores id and note but not amount, account, or direction", () => {
    expect(transactionSignature(txn({ id: "a", note: "x" }))).toBe(transactionSignature(txn({ id: "b" })));
    expect(transactionSignature(txn({ account: "Weekend Visa" }))).not.toBe(transactionSignature(txn({})));
    expect(transactionSignature(txn({ direction: "credit" }))).not.toBe(transactionSignature(txn({})));
  });
});
