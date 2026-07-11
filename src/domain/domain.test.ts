import { describe, expect, it } from "vitest";
import { addMonths, daysInMonth, dominantMonth, monthLabel, monthOf, toISODate, toISODateOrdered } from "./dates";
import { filterNew, transactionSignature } from "./dedupe";
import { formatMoney, parseAmount } from "./money";
import { applyRules, cleanMerchant, matchRule, withRule } from "./rules";
import type { CategoryKey, MerchantRule, MerchantRules, Transaction } from "./types";

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
    kind: "expense",
    ...overrides,
  };
}

/** A plain expense rule for the given category — the common test shape. */
function rule(category: CategoryKey, extra: Partial<MerchantRule> = {}): MerchantRule {
  return { category, kind: "expense", ...extra };
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

  it("picks the month holding most of a statement's rows", () => {
    // A 07 Jun - 06 Jul statement: the bulk is June, so June is where to land.
    // The last row printed is a July one — row order must not sway this.
    const statement = [
      { date: "2026-06-15" },
      { date: "2026-06-22" },
      { date: "2026-06-27" },
      { date: "2026-07-02" },
    ];
    expect(dominantMonth(statement)).toBe("2026-06");
  });

  it("breaks a dominant-month tie toward the later month", () => {
    expect(dominantMonth([{ date: "2026-06-30" }, { date: "2026-07-01" }])).toBe("2026-07");
    expect(dominantMonth([])).toBe("");
    expect(dominantMonth([{ date: "" }])).toBe("");
  });
});

describe("rules engine", () => {
  const rules: MerchantRules = withRule(
    withRule(withRule({}, "KEELLS", rule("food")), "KEELLS PHARMACY", rule("lifestyle")),
    "UBER", rule("transport"),
  );

  it("prefers exact match, then longest substring", () => {
    expect(matchRule("KEELLS", rules)?.category).toBe("food");
    expect(matchRule("KEELLS PHARMACY COLOMBO", rules)?.category).toBe("lifestyle");
    expect(matchRule("KEELLS SUPER WATTALA", rules)?.category).toBe("food");
    expect(matchRule("UBER *TRIP", rules)?.category).toBe("transport");
    expect(matchRule("UNKNOWN SHOP", rules)).toBeNull();
  });

  it("is order-independent (deterministic)", () => {
    const forward = withRule(withRule({}, "ABC", rule("food")), "ABC XYZ", rule("transport"));
    const reversed = withRule(withRule({}, "ABC XYZ", rule("transport")), "ABC", rule("food"));
    expect(matchRule("ABC XYZ STORE", forward)?.category).toBe("transport");
    expect(matchRule("ABC XYZ STORE", reversed)?.category).toBe("transport");
  });

  it("normalizes merchants and re-applies across transactions", () => {
    expect(cleanMerchant("  keells   super ")).toBe("KEELLS SUPER");
    const result = applyRules([txn({}), txn({ id: "t2", description: "PickMe Ride" })], rules);
    expect(result[0]!.category).toBe("food");
    expect(result[1]!.category).toBe("uncategorized");
  });

  it("applies a rule's movement kind and counterparty, not just its category", () => {
    const lendRules = withRule({}, "CASH TO SAM", rule("uncategorized", { kind: "money_lent", counterpartyId: "sam" }));
    const [result] = applyRules([txn({ description: "CASH TO SAM" })], lendRules);
    expect(result!.kind).toBe("money_lent");
    expect(result!.counterpartyId).toBe("sam");
  });

  it("never applies a spend-kind rule to a credit, but still applies transfer rules", () => {
    const expenseRules = withRule({}, "AMAZON MKTPLACE", rule("lifestyle", { kind: "expense" }));
    const debit = txn({ id: "debit", description: "AMAZON MKTPLACE", direction: "debit", kind: "expense" });
    const refund = txn({ id: "refund", description: "AMAZON MKTPLACE REFUND", direction: "credit", kind: "account_credit" });
    const result = applyRules([debit, refund], expenseRules);
    expect(result[0]?.category).toBe("lifestyle");
    expect(result[1]?.kind).toBe("account_credit");
    expect(result[1]?.category).toBe("uncategorized");

    const transferRules = withRule({}, "AMAZON MKTPLACE", rule("uncategorized", { kind: "internal_transfer" }));
    expect(applyRules([refund], transferRules)[0]?.kind).toBe("internal_transfer");
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
