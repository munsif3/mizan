export const CLEAR_TRANSACTIONS_CONFIRMATION = "CLEAR";
export const RESET_CONFIRMATION = "RESET";

export function isClearTransactionsConfirmation(value: string): boolean {
  return value === CLEAR_TRANSACTIONS_CONFIRMATION;
}

export function isResetConfirmation(value: string): boolean {
  return value === RESET_CONFIRMATION;
}
