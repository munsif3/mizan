import type { MovementKind } from "./types";

type MovementDirection = "debit" | "credit";

export interface MovementInfo {
  kind: MovementKind;
  label: string;
  /** short tag shown as a badge in the ledger for non-spend movements */
  badge?: string;
  directions: readonly MovementDirection[];
  defaultDirection: MovementDirection;
  spend: boolean;
  needsCategory: boolean;
  needsCounterparty: boolean;
}

const MOVEMENT_DEFINITIONS = {
  expense: { label: "Expense", directions: ["debit"], defaultDirection: "debit", spend: true, needsCategory: true, needsCounterparty: false },
  loan_payment: { label: "Loan / debt payment", directions: ["debit"], defaultDirection: "debit", spend: true, needsCategory: true, needsCounterparty: false },
  gift_or_handout: { label: "Gift / handout", directions: ["debit"], defaultDirection: "debit", spend: true, needsCategory: true, needsCounterparty: true },
  money_lent: { label: "Money lent", badge: "Lent", directions: ["debit"], defaultDirection: "debit", spend: false, needsCategory: true, needsCounterparty: true },
  repayment_received: { label: "Repayment received", badge: "Repaid", directions: ["credit"], defaultDirection: "credit", spend: false, needsCategory: true, needsCounterparty: true },
  internal_transfer: { label: "Internal transfer", badge: "Transfer", directions: ["debit", "credit"], defaultDirection: "debit", spend: false, needsCategory: false, needsCounterparty: false },
  investment_transfer: { label: "Investment transfer", badge: "Invested", directions: ["debit"], defaultDirection: "debit", spend: false, needsCategory: false, needsCounterparty: false },
  account_credit: { label: "Account credit", badge: "Credit", directions: ["credit"], defaultDirection: "credit", spend: false, needsCategory: false, needsCounterparty: false },
} as const satisfies Record<MovementKind, Omit<MovementInfo, "kind">>;

/** Movement kinds in the order they appear in pickers. */
export const MOVEMENT_OPTIONS: readonly MovementInfo[] = (Object.entries(MOVEMENT_DEFINITIONS) as Array<
  [MovementKind, Omit<MovementInfo, "kind">]
>).map(([kind, definition]) => ({ kind, ...definition }));

/** Movement kinds that count as spend. Spend is always money out. */
export const SPEND_KINDS: ReadonlySet<MovementKind> = new Set(
  MOVEMENT_OPTIONS.filter((definition) => definition.spend).map((definition) => definition.kind),
);

export function isSpendKind(kind: MovementKind): boolean {
  return SPEND_KINDS.has(kind);
}

/** Whether a movement kind is valid for the raw bank-row direction. */
export function kindAllowedFor(kind: MovementKind, direction: "debit" | "credit"): boolean {
  return MOVEMENT_DEFINITIONS[kind].directions.includes(direction as never);
}

export function movementInfo(kind: MovementKind): MovementInfo {
  const definition = MOVEMENT_DEFINITIONS[kind] ?? MOVEMENT_DEFINITIONS.expense;
  return { kind, ...definition };
}

export function kindNeedsCategory(kind: MovementKind): boolean {
  return MOVEMENT_DEFINITIONS[kind].needsCategory;
}

export function kindNeedsCounterparty(kind: MovementKind): boolean {
  return MOVEMENT_DEFINITIONS[kind].needsCounterparty;
}

export function directionForKind(kind: MovementKind): "debit" | "credit" {
  return MOVEMENT_DEFINITIONS[kind].defaultDirection;
}
