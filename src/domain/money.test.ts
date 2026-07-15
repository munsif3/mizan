import { describe, expect, it } from "vitest";
import { normalizeCurrency, resolveIncomeCurrency } from "./money";

describe("central currency resolution", () => {
  it("normalizes codes and falls back explicitly", () => {
    expect(normalizeCurrency(" usd ")).toBe("USD");
    expect(normalizeCurrency("", "lkr")).toBe("LKR");
  });

  it("recognizes a native USD amount despite a legacy LKR account", () => {
    expect(resolveIncomeCurrency({
      accountCurrency: "LKR",
      portionCurrency: "USD",
      householdCurrency: "LKR",
      statementAmount: 2109.8,
      portionAmount: 2200,
      fxRate: 332,
    })).toEqual({ currency: "USD", conflict: true, source: "portion-match" });
  });

  it("keeps an actual converted LKR credit in LKR", () => {
    expect(resolveIncomeCurrency({
      accountCurrency: "LKR",
      portionCurrency: "USD",
      householdCurrency: "LKR",
      statementAmount: 730400,
      portionAmount: 2200,
      fxRate: 332,
    })).toEqual({ currency: "LKR", conflict: true, source: "account" });
  });

  it("preserves a conflicting foreign account when its conversion is unknown", () => {
    expect(resolveIncomeCurrency({
      accountCurrency: "EUR",
      portionCurrency: "USD",
      householdCurrency: "LKR",
      statementAmount: 2100,
      portionAmount: 2200,
      fxRate: 332,
    })).toEqual({ currency: "EUR", conflict: true, source: "account" });
  });
});
