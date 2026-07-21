import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { HouseholdConflict } from "../app/useHouseholdSession";
import type { Transaction } from "../domain/types";
import { emptyData } from "../storage/schema";
import { ConflictRecoveryDialog } from "./ConflictRecoveryDialog";

function withTransactions(count: number): ReturnType<typeof emptyData> {
  const rows = Array.from({ length: count }, (_, index) => ({ id: `txn_${index}` }) as Transaction);
  return { ...emptyData(), transactions: rows };
}

function conflict(localCount: number, remoteCount: number): HouseholdConflict {
  return { local: withTransactions(localCount), remote: withTransactions(remoteCount) };
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === label,
  );
  if (!match) throw new Error(`Could not find the "${label}" button.`);
  return match;
}

describe("ConflictRecoveryDialog", () => {
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

  async function render(onResolve: (choice: "keep-local" | "keep-remote") => void) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<ConflictRecoveryDialog conflict={conflict(5, 8)} onResolve={onResolve} />));
    return container;
  }

  it("shows both versions and routes each choice", async () => {
    const onResolve = vi.fn();
    const view = await render(onResolve);

    expect(view.textContent).toContain("5 transactions");
    expect(view.textContent).toContain("8 transactions");

    await act(async () => button(view, "Keep my changes").click());
    expect(onResolve).toHaveBeenCalledWith("keep-local");

    await act(async () => button(view, "Use the latest version").click());
    expect(onResolve).toHaveBeenCalledWith("keep-remote");
  });

  it("keeps the latest version as the non-destructive default on Escape", async () => {
    const onResolve = vi.fn();
    const view = await render(onResolve);

    await act(async () => {
      view.querySelector('[role="dialog"]')!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith("keep-remote");
  });
});
