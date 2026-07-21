import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom(): never {
  throw new Error("render exploded 12345678");
}

describe("ErrorBoundary", () => {
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

  it("renders children when nothing throws", async () => {
    const view = await render(
      <ErrorBoundary>
        <p>All good</p>
      </ErrorBoundary>,
    );
    expect(view.textContent).toContain("All good");
    expect(view.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows a recoverable fallback and reports the fault without leaking data", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const view = await render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    const alert = view.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("Something went wrong");
    expect(view.querySelector("button")?.textContent).toContain("Reload");

    // React logs the raw fault itself in dev; assert only that our own
    // diagnostic line is present and carries no unredacted sensitive digits.
    const diagnostic = consoleError.mock.calls
      .map((call) => call.join(" "))
      .find((line) => line.includes("[mizan:render]"));
    expect(diagnostic).toBeDefined();
    expect(diagnostic).toContain("render exploded ####");
    expect(diagnostic).not.toContain("12345678");

    consoleError.mockRestore();
  });

  it("prefers a caller-supplied fallback", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const view = await render(
      <ErrorBoundary fallback={<p>Custom fallback</p>}>
        <Boom />
      </ErrorBoundary>,
    );

    expect(view.textContent).toContain("Custom fallback");
    expect(view.querySelector('[role="alert"]')).toBeNull();

    vi.restoreAllMocks();
  });
});
