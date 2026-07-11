import { describe, expect, it } from "vitest";
import { normalizeFxTransaction, parseFxConversion } from "./fx";
import type { Transaction } from "./types";

function txn(amount: number): Transaction {
  return {
    id: "fx",
    date: "2026-06-25",
    description: "FUND TRANSFER USD 1900 @332",
    amount,
    category: "uncategorized",
    account: "NTB PFC",
    note: "",
    source: "imported",
    direction: "debit",
    kind: "expense",
  };
}

describe("foreign exchange normalization", () => {
  it("reads the explicit currency, original amount, and rate", () => {
    expect(parseFxConversion("FUND TRANSFER USD 1,900 @332")).toEqual({
      originalCurrency: "USD",
      originalAmount: 1900,
      rate: 332,
      convertedAmount: 630800,
    });
  });

  it("converts a foreign-account row into the household currency", () => {
    expect(normalizeFxTransaction(txn(1900), "LKR")).toMatchObject({
      amount: 630800,
      note: "FX conversion: USD 1,900 at 332 = LKR 630,800",
    });
  });

  it("keeps an already-converted savings leg at its booked value", () => {
    expect(normalizeFxTransaction(txn(630800), "LKR")).toMatchObject({ amount: 630800 });
  });
});
