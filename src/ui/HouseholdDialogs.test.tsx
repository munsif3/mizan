import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CreateHouseholdDialog, JoinHouseholdDialog } from "./HouseholdDialogs";

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent?.trim() === label,
  );
  if (!match) throw new Error(`Could not find the "${label}" button.`);
  return match;
}

function setInput(container: HTMLElement, value: string) {
  const input = container.querySelector<HTMLInputElement>("input")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("household dialogs", () => {
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

  async function render(node: React.ReactNode) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(node));
    return container;
  }

  it("creates with a trimmed name and shows the migration note when relevant", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const view = await render(
      <CreateHouseholdDialog suggestion="Home" willMigrateLegacyData onCreate={onCreate} onClose={onClose} />,
    );

    expect(view.textContent).toContain("older Mizan data");

    setInput(view, "  Shared budget  ");
    await act(async () => button(view, "Create household").click());

    expect(onCreate).toHaveBeenCalledWith("Shared budget");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("omits the migration note and disables submit when the name is blank", async () => {
    const view = await render(
      <CreateHouseholdDialog suggestion="" willMigrateLegacyData={false} onCreate={vi.fn()} onClose={vi.fn()} />,
    );
    expect(view.textContent).not.toContain("older Mizan data");
    expect(button(view, "Create household").disabled).toBe(true);
  });

  it("keeps the join dialog open and shows the error when joining fails", async () => {
    const onJoin = vi.fn().mockRejectedValue(new Error("That invite code is not valid."));
    const onClose = vi.fn();
    const view = await render(<JoinHouseholdDialog onJoin={onJoin} onClose={onClose} />);

    setInput(view, "hh_1_invite");
    await act(async () => button(view, "Join household").click());

    expect(onJoin).toHaveBeenCalledWith("hh_1_invite");
    expect(onClose).not.toHaveBeenCalled();
    expect(view.querySelector('[role="alert"]')?.textContent).toContain("not valid");
  });
});
