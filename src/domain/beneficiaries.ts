import type { MerchantRule, SpendBeneficiary } from "./types";

type BeneficiaryLike = SpendBeneficiary | MerchantRule["beneficiary"] | undefined;

/** Semantic equality for concrete and rule-level beneficiary values. */
export function beneficiaryEquals(left: BeneficiaryLike, right: BeneficiaryLike): boolean {
  if (left?.type !== right?.type) return false;
  return left?.type !== "member" || (right?.type === "member" && left.memberId === right.memberId);
}
