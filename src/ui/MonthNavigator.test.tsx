import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MonthNavigator, type MonthNavigatorProps } from "./MonthNavigator";

function addMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const total = year! * 12 + monthNumber!;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function monthRange(first: string, last: string): string[] {
  const result: string[] = [];
  for (let month = first; month <= last; month = addMonth(month)) result.push(month);
  return result;
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const match = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!match) throw new Error(`Could not find the ${label} button.`);
  return match;
}

describe("MonthNavigator", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  async function render(props: MonthNavigatorProps) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<MonthNavigator {...props} />));
    return container;
  }

  it("exposes a non-modal month grid with selected, current, and range boundaries", async () => {
    const onChange = vi.fn();
    const view = await render({
      value: "2026-07",
      months: monthRange("2024-08", "2026-08"),
      todayMonth: "2026-07",
      onChange,
    });
    const trigger = button(view, "Choose month, Jul 2026");

    expect(trigger.textContent).toContain("Jul 2026");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(button(view, "Next month").disabled).toBe(true);
    await act(async () => button(view, "Previous month").click());
    expect(onChange).toHaveBeenCalledWith("2026-06");
    onChange.mockClear();

    await act(async () => trigger.click());

    const dialog = view.querySelector<HTMLElement>('[role="dialog"]')!;
    const selected = button(view, "Jul 2026");
    expect(dialog.getAttribute("aria-modal")).toBe("false");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    expect(selected.getAttribute("aria-current")).toBe("date");
    expect(selected.classList.contains("selected")).toBe(true);
    expect(selected.classList.contains("current")).toBe(true);
    expect(document.activeElement).toBe(selected);
    expect(button(view, "Aug 2026").disabled).toBe(true);

    await act(async () => button(view, "Previous year").click());
    await act(async () => button(view, "Previous year").click());

    expect(view.querySelector(".month-popover-header strong")?.textContent).toBe("2024");
    expect(button(view, "Jan 2024").disabled).toBe(true);
    expect(button(view, "Aug 2024").disabled).toBe(false);
    expect(button(view, "Previous year").disabled).toBe(true);

    await act(async () => button(view, "Aug 2024").click());
    expect(onChange).toHaveBeenCalledWith("2024-08");
    expect(view.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("moves focus through the three-column grid and across year boundaries", async () => {
    const view = await render({
      value: "2025-12",
      months: monthRange("2025-11", "2026-07"),
      todayMonth: "2026-07",
      onChange: vi.fn(),
    });
    const trigger = button(view, "Choose month, Dec 2025");
    await act(async () => trigger.click());
    const december = button(view, "Dec 2025");
    expect(document.activeElement).toBe(december);

    await act(async () => {
      december.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });

    const january = button(view, "Jan 2026");
    expect(view.querySelector(".month-popover-header strong")?.textContent).toBe("2026");
    expect(document.activeElement).toBe(january);

    await act(async () => {
      january.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(document.activeElement).toBe(button(view, "Apr 2026"));

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(view.querySelector('[role="dialog"]')).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("closes the popover when an outer step crosses into another year", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    function Harness() {
      const [value, setValue] = useState("2025-12");
      return (
        <MonthNavigator
          value={value}
          months={monthRange("2025-01", "2026-07")}
          todayMonth="2026-07"
          onChange={setValue}
        />
      );
    }
    await act(async () => root?.render(<Harness />));

    await act(async () => button(container!, "Choose month, Dec 2025").click());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    const nextButton = button(container!, "Next month");
    nextButton.focus();
    await act(async () => nextButton.click());

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(button(container!, "Choose month, Jan 2026").getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button(container!, "Next month"));
  });

  it("closes when interaction moves outside the non-modal popover", async () => {
    const view = await render({
      value: "2026-03",
      months: monthRange("2025-01", "2026-07"),
      todayMonth: "2026-07",
      onChange: vi.fn(),
    });
    const trigger = button(view, "Choose month, Mar 2026");
    await act(async () => trigger.click());
    expect(view.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => document.body.click());

    expect(view.querySelector('[role="dialog"]')).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });
});
