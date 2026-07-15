import { describe, expect, it } from "vitest";
import { applyRules, withRule } from "./rules";
import type { Account, Member, MerchantRule, Transaction } from "./types";

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "txn",
    date: "2026-07-01",
    description: "CORNER SHOP",
    amount: 1_000,
    category: "uncategorized",
    beneficiary: { type: "unassigned" },
    account: "Cash",
    note: "",
    source: "imported",
    direction: "debit",
    kind: "expense",
    ...overrides,
  };
}

const householdFoodRule: MerchantRule = {
  category: "food",
  beneficiary: { type: "household" },
  kind: "expense",
};

describe("merchant-rule classification", () => {
  it("applies purpose and beneficiary together to every matching unlocked row", () => {
    const rules = withRule({}, "corner shop", householdFoodRule);
    const result = applyRules([
      transaction({ id: "past" }),
      transaction({ id: "future", description: "CORNER SHOP COLOMBO" }),
    ], rules);

    expect(result.map(({ category, beneficiary }) => ({ category, beneficiary }))).toEqual([
      { category: "food", beneficiary: { type: "household" } },
      { category: "food", beneficiary: { type: "household" } },
    ]);
  });

  it("does not replace a ledger-only classification override", () => {
    const locked = transaction({
      category: "transport",
      beneficiary: { type: "member", memberId: "sam" },
      classificationLocked: true,
    });
    const [result] = applyRules([locked], withRule({}, "corner shop", householdFoodRule));

    expect(result).toBe(locked);
    expect(result).toMatchObject({
      category: "transport",
      beneficiary: { type: "member", memberId: "sam" },
      classificationLocked: true,
    });
  });

  it("inherits each row's account default instead of hard-coding one cardholder", () => {
    const members: Member[] = [
      { id: "sara", name: "Sara", color: "#5b8cff", portions: [] },
      { id: "munsif", name: "Munsif", color: "#ff80b5", portions: [] },
    ];
    const accounts: Account[] = [
      { id: "sara", label: "Sara Card", owner: "sara", beneficiaryDefault: "owner", match: [] },
      { id: "munsif", label: "Munsif Card", owner: "munsif", beneficiaryDefault: "owner", match: [] },
    ];
    const rules = withRule({}, "cool planet", {
      category: "lifestyle",
      beneficiary: { type: "account_default" },
      kind: "expense",
    });
    const result = applyRules([
      transaction({ id: "sara-row", description: "COOL PLANET", account: "stale", accountId: "sara" }),
      transaction({ id: "munsif-row", description: "COOL PLANET", account: "Munsif Card", accountId: "munsif" }),
    ], rules, accounts, members);
    expect(result.map((row) => row.beneficiary)).toEqual([
      { type: "member", memberId: "sara" },
      { type: "member", memberId: "munsif" },
    ]);
    expect(result.every((row) => row.beneficiarySource === "account_default")).toBe(true);
  });

  it("lets an explicit household merchant rule override and clear an inferred beneficiary", () => {
    const accounts: Account[] = [{ id: "m", label: "Munsif Card", owner: "munsif", beneficiaryDefault: "owner", match: [] }];
    const members: Member[] = [{ id: "munsif", name: "Munsif", color: "#5b8cff", portions: [] }];
    const [result] = applyRules([
      transaction({
        description: "GROCERIES",
        account: "Munsif Card",
        accountId: "m",
        beneficiary: { type: "member", memberId: "munsif" },
        beneficiarySource: "account_default",
      }),
    ], withRule({}, "groceries", householdFoodRule), accounts, members);
    expect(result?.beneficiary).toEqual({ type: "household" });
    expect(result?.beneficiarySource).toBeUndefined();
  });

  it("retrieves a legacy rule even when its stored key was not canonicalized", () => {
    const rules = { " keells ": householdFoodRule };
    expect(applyRules([transaction({ description: "KEELLS SUPER" })], rules)[0]?.category).toBe("food");
  });
});
