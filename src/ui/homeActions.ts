export type HomeActionFamily =
  | "account_coverage"
  | "income_currency_review"
  | "missing_exchange_rate"
  | "recent_activity"
  | "classification"
  | "income_confirmation"
  | "weekly_check_in"
  | "contribution_confirmation"
  | "settlement"
  | "fixed_cost_duplicate"
  | "holding_link"
  | "ending_commitment"
  | "save_rate";

export type AppActionTarget =
  | {
      kind: "button";
      label: string;
      onSelect: () => void;
    }
  | {
      kind: "status";
      label: string;
      tone?: "default" | "danger";
    };

export interface HomeAction {
  id: string;
  family: HomeActionFamily;
  priority: number;
  title: string;
  body: string;
  count?: number;
  details?: string[];
  target: AppActionTarget;
}

/**
 * Lower numbers appear first. The gaps are intentional so a family can gain a
 * more specific priority later without changing the broad weekly workflow:
 * forecast integrity, weekly check-in, reconciliation, then planning.
 */
export const HOME_ACTION_PRIORITY: Record<HomeActionFamily, number> = {
  account_coverage: 10,
  income_currency_review: 20,
  missing_exchange_rate: 30,
  recent_activity: 40,
  classification: 50,
  income_confirmation: 60,
  weekly_check_in: 100,
  contribution_confirmation: 200,
  settlement: 210,
  fixed_cost_duplicate: 300,
  holding_link: 310,
  ending_commitment: 320,
  save_rate: 330,
};

export function rankHomeActions(actions: HomeAction[]): HomeAction[] {
  return [...actions].sort(
    (left, right) => left.priority - right.priority || left.id.localeCompare(right.id),
  );
}
