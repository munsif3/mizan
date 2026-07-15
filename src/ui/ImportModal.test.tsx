import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ImportModal, type ImportResult } from "./ImportModal";

function button(container: HTMLElement, label: string) {
  const match = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
  if (!match) throw new Error(`Could not find the ${label} button.`);
  return match;
}

describe("ImportModal retries", () => {
  let container: HTMLDivElement | null = null;

  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    container?.remove();
    container = null;
  });

  it("allows another attempt in the same modal after a password failure", async () => {
    const failed: ImportResult = {
      imported: 0,
      duplicates: 0,
      needsReview: 0,
      failures: ["statement.pdf: Incorrect password."],
    };
    const succeeded: ImportResult = { imported: 3, duplicates: 0, needsReview: 0, failures: [] };
    const onImport = vi.fn().mockResolvedValueOnce(failed).mockResolvedValueOnce(succeeded);
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ImportModal onImport={onImport} onCsv={() => {}} onReview={() => {}} onClose={() => {}} />,
      );
    });
    expect(button(container, "Cancel").disabled).toBe(false);

    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [new File(["statement"], "statement.pdf", { type: "application/pdf" })],
    });
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
    await act(async () => button(container!, "Import 1 statement").click());

    expect(container.textContent).toContain("Incorrect password");
    expect(button(container, "Retry import").disabled).toBe(false);
    expect(button(container, "Close").disabled).toBe(false);
    expect(container.textContent).not.toContain("Cancel");

    await act(async () => button(container!, "Retry import").click());

    expect(onImport).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Imported 3");
    expect(container.textContent).not.toContain("Retry import");
    expect(button(container, "Close").disabled).toBe(false);
    expect([...container.querySelectorAll("button")].filter((candidate) => candidate.textContent?.trim() === "Close")).toHaveLength(1);
    expect(container.textContent).not.toContain("Done");

    await act(async () => root.unmount());
  });
});
