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
        <ImportModal onImport={onImport} onCsv={() => {}} onMapStatement={() => {}} onReview={() => {}} onClose={() => {}} />,
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

  it("offers manual column mapping for an unrecognized format but not a wrong password", async () => {
    const unrecognized: ImportResult = {
      imported: 0,
      duplicates: 0,
      needsReview: 0,
      failures: ["mystery.pdf: Not a statement layout Mizan recognizes yet."],
    };
    const wrongPassword: ImportResult = {
      imported: 0,
      duplicates: 0,
      needsReview: 0,
      failures: ["mystery.pdf: Incorrect password."],
    };
    const onMapStatement = vi.fn();
    const onImport = vi.fn().mockResolvedValueOnce(wrongPassword).mockResolvedValueOnce(unrecognized);
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ImportModal onImport={onImport} onCsv={() => {}} onMapStatement={onMapStatement} onReview={() => {}} onClose={() => {}} />,
      );
    });

    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [new File(["statement"], "mystery.pdf", { type: "application/pdf" })],
    });
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));

    // A wrong password is not a format problem: reading the table needs it too.
    await act(async () => button(container!, "Import 1 statement").click());
    expect(container.textContent).not.toContain("Map mystery.pdf myself");

    // An unrecognized layout is a dead end without manual mapping.
    await act(async () => button(container!, "Retry import").click());
    expect(container.textContent).toContain("No verified parser recognized");
    await act(async () => button(container!, "Map mystery.pdf myself").click());
    expect(onMapStatement).toHaveBeenCalledTimes(1);
    expect(onMapStatement.mock.calls[0]![0]).toMatchObject({ name: "mystery.pdf" });

    await act(async () => root.unmount());
  });

  it("passes the Catch up account scope through the import handler", async () => {
    const result: ImportResult = { imported: 1, duplicates: 0, needsReview: 0, failures: [] };
    const onImport = vi.fn().mockResolvedValue(result);
    container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(
      <ImportModal
        onImport={onImport}
        onCsv={() => {}}
        onMapStatement={() => {}}
        onReview={() => {}}
        onClose={() => {}}
        scopedAccountId="card"
        scopedAccountLabel="Sam card"
      />,
    ));
    expect(container.textContent).toContain("Importing statement activity for Sam card");
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [new File(["statement"], "statement.pdf", { type: "application/pdf" })],
    });
    await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
    await act(async () => button(container!, "Import 1 statement").click());
    expect(onImport.mock.calls[0]?.[3]).toBe("card");
    await act(async () => root.unmount());
  });
});
