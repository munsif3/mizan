import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AccountCoverageConfirm } from "./AccountCoverageConfirm";

describe("AccountCoverageConfirm", () => {
  let container: HTMLDivElement | null = null;

  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    container?.remove();
    container = null;
  });

  it("requires an explicit confirmation and lets the user correct the suggested date", async () => {
    const onConfirm = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <AccountCoverageConfirm
        candidates={[{ accountId: "card", label: "Main card", suggestedThroughDate: "2026-07-18" }]}
        onConfirm={onConfirm}
      />,
    ));

    expect(onConfirm).not.toHaveBeenCalled();
    const date = container.querySelector<HTMLInputElement>('input[type="date"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(date, "2026-07-20");
      date.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const button = [...container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.trim() === "Confirm coverage")!;
    await act(async () => button.click());

    expect(onConfirm).toHaveBeenCalledWith([{ accountId: "card", throughDate: "2026-07-20" }]);
    expect(container.textContent).toContain("Coverage confirmed");
    await act(async () => root.unmount());
  });
});
