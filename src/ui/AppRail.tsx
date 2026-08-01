import { Layers, List, Scale, TrendingUp, type LucideIcon } from "lucide-react";
import type { View } from "../app/useHouseholdSession";

const ITEMS: ReadonlyArray<{ id: View; label: string; icon: LucideIcon }> = [
  { id: "balance", label: "Balance", icon: Scale },
  { id: "sort", label: "Sort", icon: Layers },
  { id: "ledger", label: "Ledger", icon: List },
  { id: "trend", label: "Trend", icon: TrendingUp },
];

export function AppRail({
  view,
  sortCount,
  onChange,
}: {
  view: View;
  sortCount: number;
  onChange: (view: View) => void;
}) {
  return (
    <aside className="app-rail">
      <div className="app-rail-brand" aria-label="Mizan">M</div>
      <nav className="app-rail-nav" aria-label="Primary">
        {ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            className={`app-rail-item ${view === id ? "active" : ""}`}
            aria-current={view === id ? "page" : undefined}
            aria-label={id === "sort" && sortCount > 0
              ? `${label}, ${sortCount} merchant${sortCount === 1 ? "" : "s"} need review`
              : label}
            onClick={() => onChange(id)}
          >
            <Icon size={21} strokeWidth={1.7} aria-hidden="true" />
            <span>{label}</span>
            {id === "sort" && sortCount > 0 && (
              <b className="app-rail-badge" aria-hidden="true">
                {sortCount}
              </b>
            )}
          </button>
        ))}
      </nav>
    </aside>
  );
}
