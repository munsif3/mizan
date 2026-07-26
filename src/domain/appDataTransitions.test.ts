import { describe, expect, it } from "vitest";
import {
  transitionConfirmTransfer,
  transitionDeleteRules,
  transitionRejectTransfer,
  transitionUnlinkCommitment,
} from "./appDataTransitions";
import { emptyData } from "../storage/schema";
import type { AppData, Transaction } from "./types";

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "txn",
    date: "2026-07-01",
    description: "KEELLS SUPER",
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

function ruledData(): AppData {
  const data = emptyData();
  data.settings.members = [{ id: "owner", name: "Owner", color: "#5b8cff", portions: [] }];
  data.merchantRules = {
    keells: { category: "food", beneficiary: { type: "household" }, kind: "expense" },
    uber: { category: "transport", beneficiary: { type: "household" }, kind: "expense" },
    netflix: { category: "lifestyle", beneficiary: { type: "household" }, kind: "expense" },
  };
  data.transactions = [
    transaction({ id: "food", description: "KEELLS SUPER", category: "food", beneficiary: { type: "household" } }),
    transaction({ id: "ride", description: "UBER TRIP", category: "transport", beneficiary: { type: "household" } }),
    transaction({ id: "show", description: "NETFLIX", category: "lifestyle", beneficiary: { type: "household" } }),
  ];
  return data;
}

describe("transitionDeleteRules", () => {
  it("removes every selected rule and returns only their rows to review", () => {
    const result = transitionDeleteRules(ruledData(), ["keells", "netflix"]);

    expect(Object.keys(result.merchantRules)).toEqual(["uber"]);
    expect(result.transactions.map(({ id, category }) => ({ id, category }))).toEqual([
      { id: "food", category: "uncategorized" },
      { id: "ride", category: "transport" },
      { id: "show", category: "uncategorized" },
    ]);
  });

  it("keeps a locked one-row override when its rule is deleted", () => {
    const data = ruledData();
    data.transactions = [transaction({ id: "food", description: "KEELLS SUPER", category: "lifestyle", classificationLocked: true })];
    const result = transitionDeleteRules(data, ["keells"]);

    expect(result.transactions[0]).toMatchObject({ category: "lifestyle", classificationLocked: true });
  });

  it("falls back to the next matching rule instead of review", () => {
    const data = ruledData();
    data.merchantRules["keells super colombo"] = { category: "food", beneficiary: { type: "household" }, kind: "expense" };
    data.transactions = [transaction({ id: "food", description: "KEELLS SUPER COLOMBO", category: "food", beneficiary: { type: "household" } })];
    const result = transitionDeleteRules(data, ["keells super colombo"]);

    expect(result.transactions[0]).toMatchObject({ category: "food" });
  });
});

describe("durable transfer decisions", () => {
  it("links both confirmed legs and clears spend classification", () => {
    const data = emptyData();
    data.transactions = [
      transaction({ id: "debit", category: "food", beneficiary: { type: "household" }, holdingId: "asset" }),
      transaction({ id: "credit", direction: "credit", kind: "account_credit", amount: 1_000 }),
    ];
    const result = transitionConfirmTransfer(data, "debit", "credit");
    expect(result.transactions[0]).toMatchObject({
      kind: "internal_transfer",
      category: "uncategorized",
      beneficiary: { type: "unassigned" },
      linkedTransferId: "credit",
    });
    expect(result.transactions[0]?.holdingId).toBeUndefined();
    expect(result.transactions[1]).toMatchObject({ kind: "internal_transfer", linkedTransferId: "debit" });
  });

  it("persists a rejected counterpart on both legs", () => {
    const data = emptyData();
    data.transactions = [
      transaction({ id: "debit" }),
      transaction({ id: "credit", direction: "credit", kind: "account_credit" }),
    ];
    const result = transitionRejectTransfer(data, "debit", "credit");
    expect(result.transactions[0]?.rejectedTransferIds).toEqual(["credit"]);
    expect(result.transactions[1]?.rejectedTransferIds).toEqual(["debit"]);
  });
});

describe("commitment links", () => {
  it("unlinks an incorrect match and locks the row against immediate re-matching", () => {
    const data = emptyData();
    data.settings.members = [{ id: "owner", name: "Owner", color: "#5b8cff", portions: [] }];
    data.fixedCosts = [{
      id: "loan",
      label: "Car loan",
      amount: 1_000,
      kind: "loan_payment",
      category: "transport",
      beneficiary: { type: "household" },
      merchantMatch: ["BANK LOAN"],
    }];
    data.transactions = [transaction({
      description: "BANK LOAN",
      commitmentId: "loan",
      kind: "loan_payment",
      category: "transport",
      beneficiary: { type: "household" },
    })];

    const result = transitionUnlinkCommitment(data, "txn");

    expect(result.transactions[0]).toMatchObject({
      kind: "expense",
      category: "uncategorized",
      classificationLocked: true,
    });
    expect(result.transactions[0]?.commitmentId).toBeUndefined();
    expect(result.transactions[0]?.holdingId).toBeUndefined();
    expect(result.transactions[0]?.investmentAmount).toBeUndefined();
  });
});
