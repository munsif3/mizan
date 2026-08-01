import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import {
  HomeBooksContent,
  useHomeViewModel,
  type HomeBooksSection,
  type HomeViewProps,
} from "./HomeView";

const FILTERS: ReadonlyArray<{ id: HomeBooksSection; label: string }> = [
  { id: "purpose", label: "Purpose" },
  { id: "settlement", label: "Settle-up" },
  { id: "coverage", label: "Coverage" },
  { id: "fixed", label: "Fixed" },
  { id: "assets", label: "Assets" },
  { id: "efficiency", label: "Efficiency" },
  { id: "waiting", label: "Also waiting" },
];

export function BooksView({ onBack, ...props }: HomeViewProps & { onBack: () => void }) {
  const model = useHomeViewModel(props);
  const [section, setSection] = useState<HomeBooksSection>("purpose");
  const filters = model.solo ? FILTERS.filter((item) => item.id !== "settlement") : FILTERS;
  const activeSection = model.solo && section === "settlement" ? "purpose" : section;

  return (
    <div className="books-view">
      <header className="books-header">
        <button type="button" className="books-back" onClick={onBack}>
          <ChevronLeft size={18} strokeWidth={1.8} aria-hidden="true" />
          Balance
        </button>
        <div>
          <span className="mz-eyebrow">Household detail</span>
          <h1 className="mz-display-l">The Books</h1>
          <p className="mz-body-l">
            The full record, kept intact and grouped by the question you came here to answer.
          </p>
        </div>
      </header>

      <nav className="books-filter-row" aria-label="The Books sections">
        {filters.map((item) => (
          <button
            type="button"
            className="books-filter"
            aria-pressed={activeSection === item.id}
            key={item.id}
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="books-content" data-section={activeSection} key={activeSection}>
        <HomeBooksContent model={model} section={activeSection} />
      </div>
    </div>
  );
}
