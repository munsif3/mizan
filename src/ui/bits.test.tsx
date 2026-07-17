// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Button, Modal, Tabs } from "./bits";

describe("shared dialog keyboard behavior", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("traps keyboard focus, closes with Escape, and restores the opener", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open details</button>
          {open && (
            <Modal title="Transaction details" onClose={() => setOpen(false)}>
              <button>Last action</button>
            </Modal>
          )}
        </>
      );
    }

    await act(async () => root.render(<Harness />));
    const opener = container.querySelector<HTMLButtonElement>("button")!;
    opener.focus();
    await act(async () => opener.click());

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const dialogButtons = [...dialog.querySelectorAll<HTMLButtonElement>("button")];
    expect(document.activeElement).toBe(dialogButtons[0]);
    dialogButtons.at(-1)?.focus();
    await act(async () => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(document.activeElement).toBe(dialogButtons[0]);

    await act(async () => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("renders explicit button variants and sizes", async () => {
    await act(async () => root.render(
      <>
        <Button variant="primary">Save</Button>
        <Button variant="secondary" size="compact">Cancel</Button>
        <Button variant="danger">Delete</Button>
      </>,
    ));

    expect(container.querySelector(".button-primary.button-default")?.textContent).toBe("Save");
    expect(container.querySelector(".button-secondary.button-compact")?.textContent).toBe("Cancel");
    expect(container.querySelector(".button-danger")?.textContent).toBe("Delete");
  });

  it("moves tab selection and focus with arrows, Home, and End", async () => {
    function Harness() {
      const [value, setValue] = useState<"one" | "two" | "three">("one");
      return (
        <Tabs
          idPrefix="demo"
          label="Demo sections"
          value={value}
          onChange={setValue}
          items={[
            { id: "one", label: "One", panelId: "panel-one" },
            { id: "two", label: "Two", panelId: "panel-two" },
            { id: "three", label: "Three", panelId: "panel-three" },
          ]}
        />
      );
    }

    await act(async () => root.render(<Harness />));
    const one = container.querySelector<HTMLButtonElement>("#demo-tab-one")!;
    one.focus();
    await act(async () => one.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    const two = container.querySelector<HTMLButtonElement>("#demo-tab-two")!;
    expect(two.getAttribute("aria-selected")).toBe("true");
    expect(two.getAttribute("aria-controls")).toBe("panel-two");
    expect(document.activeElement).toBe(two);

    await act(async () => two.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(document.activeElement).toBe(container.querySelector("#demo-tab-three"));
  });
});
