import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { monthLabel } from "../domain/dates";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const ISO_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export interface MonthNavigatorProps {
  value: string;
  months: string[];
  todayMonth: string;
  onChange: (month: string) => void;
}

function yearOf(month: string): number | undefined {
  const match = ISO_MONTH_PATTERN.exec(month);
  return match ? Number(match[1]) : undefined;
}

function isoMonth(year: number, monthIndex: number): string {
  return `${String(year).padStart(4, "0")}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function clampYear(year: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(year, minimum), maximum);
}

export function MonthNavigator({ value, months, todayMonth, onChange }: MonthNavigatorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const pendingFocusRef = useRef<string | null>(null);
  const popoverId = useId();
  const hasValidToday = ISO_MONTH_PATTERN.test(todayMonth);
  const selectableMonths = useMemo(
    () => [...new Set(months.filter((month) => ISO_MONTH_PATTERN.test(month)))]
      .filter((month) => !hasValidToday || month <= todayMonth)
      .sort(),
    [hasValidToday, months, todayMonth],
  );
  const selectableSet = useMemo(() => new Set(selectableMonths), [selectableMonths]);
  const fallbackYear = yearOf(todayMonth) ?? new Date().getFullYear();
  const minimumYear = yearOf(selectableMonths[0] ?? "") ?? fallbackYear;
  const maximumYear = yearOf(selectableMonths[selectableMonths.length - 1] ?? "") ?? fallbackYear;
  const initialYear = clampYear(yearOf(value) ?? fallbackYear, minimumYear, maximumYear);
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(initialYear);
  const selectedIndex = selectableMonths.indexOf(value);

  const findMonthButton = useCallback((month: string) => (
    [...(gridRef.current?.querySelectorAll<HTMLButtonElement>("button[data-month]") ?? [])]
      .find((button) => button.dataset.month === month)
  ), []);

  const closePopover = useCallback((restoreFocus: boolean) => {
    pendingFocusRef.current = null;
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const focusGridMonth = (month: string) => {
    const targetYear = yearOf(month);
    if (targetYear === undefined) return;
    if (targetYear === viewYear) {
      findMonthButton(month)?.focus();
      return;
    }
    pendingFocusRef.current = month;
    setViewYear(targetYear);
  };

  const openPopover = () => {
    const focusMonth = selectableSet.has(value)
      ? value
      : selectableSet.has(todayMonth)
        ? todayMonth
        : selectableMonths[selectableMonths.length - 1];
    const nextYear = clampYear(yearOf(focusMonth ?? value) ?? fallbackYear, minimumYear, maximumYear);
    pendingFocusRef.current = focusMonth ?? null;
    setViewYear(nextYear);
    setOpen(true);
  };

  useEffect(() => {
    setViewYear((current) => clampYear(current, minimumYear, maximumYear));
  }, [maximumYear, minimumYear]);

  useLayoutEffect(() => {
    if (!open) return;
    const pendingMonth = pendingFocusRef.current;
    if (pendingMonth && yearOf(pendingMonth) === viewYear) {
      pendingFocusRef.current = null;
      findMonthButton(pendingMonth)?.focus();
      return;
    }
    if (!pendingMonth && document.activeElement === triggerRef.current) {
      popoverRef.current?.focus();
    }
  }, [findMonthButton, open, viewYear]);

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) closePopover(true);
    };
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closePopover(true);
    };
    document.addEventListener("click", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("click", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [closePopover, open]);

  const moveGridFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const currentMonth = event.target instanceof HTMLElement ? event.target.dataset.month : undefined;
    if (!currentMonth) return;
    const offsets: Partial<Record<string, number>> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -3,
      ArrowDown: 3,
      PageUp: -12,
      PageDown: 12,
    };
    const offset = offsets[event.key];
    if (offset === undefined) return;
    event.preventDefault();
    const currentIndex = selectableMonths.indexOf(currentMonth);
    const targetMonth = currentIndex >= 0 ? selectableMonths[currentIndex + offset] : undefined;
    if (targetMonth) focusGridMonth(targetMonth);
  };

  const yearMonths = MONTH_NAMES.map((_, monthIndex) => isoMonth(viewYear, monthIndex));
  const firstEnabledInYear = yearMonths.find((month) => selectableSet.has(month));
  const gridTabStop = selectableSet.has(value) && yearOf(value) === viewYear ? value : firstEnabledInYear;
  const previousMonth = selectedIndex > 0 ? selectableMonths[selectedIndex - 1] : undefined;
  const nextMonth = selectedIndex >= 0 && selectedIndex < selectableMonths.length - 1
    ? selectableMonths[selectedIndex + 1]
    : undefined;
  const stepToMonth = (month: string | undefined) => {
    if (!month) return;
    closePopover(false);
    onChange(month);
  };

  return (
    <div className="month-nav" ref={rootRef}>
      <button
        type="button"
        className="icon-btn"
        aria-label="Previous month"
        title="Previous month"
        disabled={!previousMonth}
        onClick={() => stepToMonth(previousMonth)}
      >
        <ChevronLeft size={17} strokeWidth={2.2} aria-hidden="true" />
      </button>

      <div className="month-picker">
        <button
          type="button"
          ref={triggerRef}
          className="month-trigger"
          aria-label={`Choose month, ${monthLabel(value)}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={popoverId}
          onClick={() => open ? closePopover(true) : openPopover()}
        >
          <CalendarDays size={17} strokeWidth={2.2} aria-hidden="true" />
          <span>{monthLabel(value)}</span>
        </button>

        {open && (
          <div
            id={popoverId}
            ref={popoverRef}
            className="month-popover"
            role="dialog"
            aria-modal="false"
            aria-label="Choose month"
            tabIndex={-1}
          >
            <div className="month-popover-header">
              <button
                type="button"
                className="icon-btn"
                aria-label="Previous year"
                title="Previous year"
                disabled={viewYear <= minimumYear}
                onClick={() => setViewYear((current) => Math.max(minimumYear, current - 1))}
              >
                <ChevronLeft size={17} strokeWidth={2.2} aria-hidden="true" />
              </button>
              <strong aria-live="polite">{viewYear}</strong>
              <button
                type="button"
                className="icon-btn"
                aria-label="Next year"
                title="Next year"
                disabled={viewYear >= maximumYear}
                onClick={() => setViewYear((current) => Math.min(maximumYear, current + 1))}
              >
                <ChevronRight size={17} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </div>

            <div
              ref={gridRef}
              className="month-grid"
              role="group"
              aria-label={`Months in ${viewYear}`}
              onKeyDown={moveGridFocus}
            >
              {yearMonths.map((month, monthIndex) => {
                const selectable = selectableSet.has(month);
                const selected = month === value;
                const current = month === todayMonth;
                return (
                  <button
                    type="button"
                    key={month}
                    className={`month-option${selected ? " selected" : ""}${current ? " current" : ""}`}
                    data-month={month}
                    aria-label={monthLabel(month)}
                    aria-pressed={selected}
                    aria-current={current ? "date" : undefined}
                    disabled={!selectable}
                    tabIndex={selectable && month === gridTabStop ? 0 : -1}
                    onClick={() => {
                      closePopover(true);
                      onChange(month);
                    }}
                  >
                    {MONTH_NAMES[monthIndex]}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        className="icon-btn"
        aria-label="Next month"
        title="Next month"
        disabled={!nextMonth}
        onClick={() => stepToMonth(nextMonth)}
      >
        <ChevronRight size={17} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </div>
  );
}
