import { spendingCategoryOptions } from "../domain/categories";
import { isSpendKind, kindNeedsCategory, kindNeedsCounterparty, MOVEMENT_OPTIONS } from "../domain/movements";
import type { AssetHolding, CategoryKey, Counterparty, CustomCategory, Member, MerchantRule, MovementKind } from "../domain/types";

/** Select value that mirrors a rule beneficiary, including the account-default policy. */
export type RuleBeneficiaryValue = "unassigned" | "account_default" | "household" | `member:${string}`;

export function ruleBeneficiaryValue(beneficiary: MerchantRule["beneficiary"] | undefined): RuleBeneficiaryValue {
  if (!beneficiary) return "unassigned";
  return beneficiary.type === "member" ? `member:${beneficiary.memberId}` : beneficiary.type;
}

function ruleBeneficiaryFromValue(value: Exclude<RuleBeneficiaryValue, "unassigned">): MerchantRule["beneficiary"] {
  return value.startsWith("member:")
    ? { type: "member", memberId: value.slice("member:".length) }
    : { type: value as "account_default" | "household" };
}

/**
 * Build a merchant rule from the editor control values, applying the movement-kind
 * constraints shared by the review queue and settings: non-spend kinds carry no
 * beneficiary, category-less kinds stay uncategorized, and only counterparty kinds
 * keep a person. Single-member households always resolve to the account default.
 */
export function ruleFromControls(
  kind: MovementKind,
  category: CategoryKey,
  beneficiary: RuleBeneficiaryValue,
  counterpartyId: string,
  solo: boolean,
  holdingId = "",
): MerchantRule {
  const spend = isSpendKind(kind);
  return {
    category: kindNeedsCategory(kind) ? category : "uncategorized",
    beneficiary: spend
      ? solo || beneficiary === "unassigned"
        ? { type: "account_default" }
        : ruleBeneficiaryFromValue(beneficiary)
      : { type: "unassigned" },
    kind,
    ...(kindNeedsCounterparty(kind) && counterpartyId ? { counterpartyId } : {}),
    ...(kind === "investment_transfer" && holdingId ? { holdingId } : {}),
  };
}

export interface RuleFieldsProps {
  /** Suffix for each control's aria-label, e.g. the merchant name. */
  context: string;
  kind: MovementKind;
  category: CategoryKey;
  beneficiary: RuleBeneficiaryValue;
  counterpartyId: string;
  members: Member[];
  counterparties: Counterparty[];
  assetHoldings: AssetHolding[];
  customCategories: CustomCategory[];
  /** Single-member households skip the beneficiary question. */
  solo: boolean;
  categoryLabel: string;
  beneficiaryLabel: string;
  onKind: (kind: MovementKind) => void;
  onCategory: (category: CategoryKey) => void;
  onBeneficiary: (beneficiary: RuleBeneficiaryValue) => void;
  onCounterparty: (counterpartyId: string) => void;
  holdingId: string;
  onHolding: (holdingId: string) => void;
}

/**
 * The Movement / purpose / beneficiary / counterparty selects shared by the review
 * queue's merchant card and the settings rule editor. Rendered as a fragment so each
 * caller controls the surrounding layout.
 */
export function RuleFields({
  context, kind, category, beneficiary, counterpartyId, members, counterparties, assetHoldings,
  customCategories, solo, categoryLabel, beneficiaryLabel,
  onKind, onCategory, onBeneficiary, onCounterparty, holdingId, onHolding,
}: RuleFieldsProps) {
  return (
    <>
      <label className="review-field">
        <span>Movement</span>
        <select aria-label={`Movement for ${context}`} value={kind} onChange={(event) => onKind(event.target.value as MovementKind)}>
          {MOVEMENT_OPTIONS.map((option) => <option key={option.kind} value={option.kind}>{option.label}</option>)}
        </select>
      </label>
      {kindNeedsCategory(kind) && (
        <label className="review-field">
          <span>{categoryLabel}</span>
          <select aria-label={`Category for ${context}`} value={category} onChange={(event) => onCategory(event.target.value as CategoryKey)}>
            <option value="uncategorized" disabled>Choose purpose</option>
            {spendingCategoryOptions(customCategories).map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
        </label>
      )}
      {isSpendKind(kind) && !solo && (
        <label className="review-field">
          <span>{beneficiaryLabel}</span>
          <select aria-label={`Who it was for: ${context}`} value={beneficiary} onChange={(event) => onBeneficiary(event.target.value as RuleBeneficiaryValue)}>
            <option value="unassigned" disabled>Choose who it was for</option>
            <option value="account_default">Use account default</option>
            <option value="household">Household</option>
            {members.map((member) => <option key={member.id} value={`member:${member.id}`}>{member.name}</option>)}
          </select>
        </label>
      )}
      {kindNeedsCounterparty(kind) && (
        <label className="review-field">
          <span>Other person</span>
          <select aria-label={`Person for ${context}`} value={counterpartyId} onChange={(event) => onCounterparty(event.target.value)}>
            <option value="">Optional</option>
            {counterparties.map((cp) => <option key={cp.id} value={cp.id}>{cp.name}</option>)}
          </select>
        </label>
      )}
      {kind === "investment_transfer" && (
        <label className="review-field">
          <span>Asset holding</span>
          <select aria-label={`Asset holding for ${context}`} value={holdingId} onChange={(event) => onHolding(event.target.value)}>
            <option value="">Choose holding</option>
            {assetHoldings.filter((holding) => holding.status !== "closed").map((holding) => (
              <option value={holding.id} key={holding.id}>{holding.label}</option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}
