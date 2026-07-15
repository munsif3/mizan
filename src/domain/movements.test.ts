import { describe, expect, it } from "vitest";
import { directionForKind, isSpendKind, kindAllowedFor, MOVEMENT_OPTIONS } from "./movements";

describe("movement registry", () => {
  it.each(MOVEMENT_OPTIONS)("keeps $kind direction and spend semantics consistent", (definition) => {
    expect(kindAllowedFor(definition.kind, "debit")).toBe(definition.directions.includes("debit"));
    expect(kindAllowedFor(definition.kind, "credit")).toBe(definition.directions.includes("credit"));
    expect(definition.directions).toContain(directionForKind(definition.kind));
    expect(isSpendKind(definition.kind)).toBe(definition.spend);
  });

  it("rejects the previously accepted direction contradictions", () => {
    expect(kindAllowedFor("money_lent", "credit")).toBe(false);
    expect(kindAllowedFor("repayment_received", "debit")).toBe(false);
    expect(kindAllowedFor("account_credit", "debit")).toBe(false);
  });
});
