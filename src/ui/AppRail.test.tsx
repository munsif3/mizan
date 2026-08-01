import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AppRail } from "./AppRail";

describe("AppRail", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("exposes four destinations and keeps the review badge on Sort", async () => {
    const onChange = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root.render(<AppRail view="balance" sortCount={7} onChange={onChange} />));

    const navigation = container.querySelector('nav[aria-label="Primary"]');
    const buttons = [...navigation!.querySelectorAll("button")];
    expect(buttons.map((button) => button.textContent?.replace(/\d+/g, "").trim())).toEqual([
      "Balance",
      "Sort",
      "Ledger",
      "Trend",
    ]);
    expect(buttons[0]?.getAttribute("aria-current")).toBe("page");
    expect(buttons[1]?.getAttribute("aria-label")).toBe("Sort, 7 merchants need review");
    expect(container.querySelector(".app-rail-badge")?.textContent).toBe("7");

    await act(async () => buttons[2]?.click());
    expect(onChange).toHaveBeenCalledWith("ledger");

    await act(async () => root.render(<AppRail view="sort" sortCount={0} onChange={onChange} />));
    expect(container.querySelector(".app-rail-badge")).toBeNull();
    expect(buttons[0]?.getAttribute("aria-current")).toBeNull();
    expect(buttons[1]?.getAttribute("aria-label")).toBe("Sort");
  });
});
