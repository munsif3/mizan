import type { MovementKind } from "./types";

/** Movement kinds that count as spend. Spend is always money out. */
export const SPEND_KINDS = new Set<MovementKind>(["expense", "gift_or_handout", "loan_payment"]);

export function isSpendKind(kind: MovementKind): boolean {
  return SPEND_KINDS.has(kind);
}

/** Whether a movement kind is valid for the raw bank-row direction. */
export function kindAllowedFor(kind: MovementKind, direction: "debit" | "credit"): boolean {
  return direction !== "credit" || !isSpendKind(kind);
}

export interface MovementInfo {
  kind: MovementKind;
  label: string;
  /** short tag shown as a badge in the ledger for non-spend movements */
  badge?: string;
}

/** Movement kinds in the order they appear in pickers. */
export const MOVEMENT_OPTIONS: MovementInfo[] = [
  { kind: "expense", label: "Expense" },
  { kind: "loan_payment", label: "Loan / debt payment" },
  { kind: "gift_or_handout", label: "Gift / handout" },
  { kind: "money_lent", label: "Money lent", badge: "Lent" },
  { kind: "repayment_received", label: "Repayment received", badge: "Repaid" },
  { kind: "internal_transfer", label: "Internal transfer", badge: "Transfer" },
  { kind: "investment_transfer", label: "Investment transfer", badge: "Invested" },
  { kind: "account_credit", label: "Account credit", badge: "Credit" },
];

const BY_KIND = new Map(MOVEMENT_OPTIONS.map((info) => [info.kind, info]));

export function movementInfo(kind: MovementKind): MovementInfo {
  return BY_KIND.get(kind) ?? MOVEMENT_OPTIONS[0]!;
}

/** These movements carry a "what for" category; the rest don't. */
const NO_CATEGORY = new Set<MovementKind>(["internal_transfer", "account_credit", "investment_transfer"]);

export function kindNeedsCategory(kind: MovementKind): boolean {
  return !NO_CATEGORY.has(kind);
}

/** These movements involve another person and can carry a counterparty. */
const NEEDS_COUNTERPARTY = new Set<MovementKind>(["money_lent", "repayment_received", "gift_or_handout"]);

export function kindNeedsCounterparty(kind: MovementKind): boolean {
  return NEEDS_COUNTERPARTY.has(kind);
}

/** Money-in movements; the rest move money out. Used to set a manual row's sign. */
const MONEY_IN = new Set<MovementKind>(["account_credit", "repayment_received"]);

export function directionForKind(kind: MovementKind): "debit" | "credit" {
  return MONEY_IN.has(kind) ? "credit" : "debit";
}
