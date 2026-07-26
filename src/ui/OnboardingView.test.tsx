import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MEMBER_PALETTE } from "../domain/categories";
import { sync } from "../app/syncState";
import { OnboardingView, type OnboardingResult } from "./OnboardingView";

describe("OnboardingView essentials", () => {
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
    vi.restoreAllMocks();
  });

  function mount(onComplete = vi.fn<(result: OnboardingResult) => void>()) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    return {
      onComplete,
      rendered: act(async () => root?.render(
        <OnboardingView
          sync={{
            auth: { status: "signed-in", user: { uid: "owner", displayName: "Owner", email: "", photoURL: "" }, error: "" },
            mode: "cloud",
            status: sync.idle("Household saved"),
            household: null,
            households: [],
          }}
          onSignIn={() => undefined}
          onOpenSettings={() => undefined}
          onComplete={onComplete}
        />,
      )),
    };
  }

  function inputFor(label: string) {
    const field = [...(container?.querySelectorAll<HTMLLabelElement>("label") ?? [])]
      .find((candidate) => candidate.querySelector("span")?.textContent === label);
    return field?.querySelector<HTMLInputElement>("input") ?? null;
  }

  function setInput(input: HTMLInputElement | null, value: string) {
    if (!input) throw new Error("Expected onboarding input");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("asks only for the four first-run essentials", async () => {
    const mounted = mount();
    await mounted.rendered;

    const labels = [...(container?.querySelectorAll<HTMLLabelElement>("label") ?? [])]
      .map((label) => label.querySelector("span")?.textContent);
    expect(labels).toEqual(["Name", "Monthly take-home", "Currency", "Savings target (%)"]);
    expect(container?.querySelector('input[type="color"]')).toBeNull();
    expect(container?.textContent).not.toContain("Locale");
    expect(container?.textContent).not.toContain("Add member");
    expect(container?.textContent).toContain("Open cloud storage");
  });

  it("derives locale and assigns the first member colour automatically", async () => {
    vi.spyOn(window.navigator, "language", "get").mockReturnValue("si-LK");
    const mounted = mount();
    await mounted.rendered;

    await act(async () => {
      setInput(inputFor("Name"), "  Alex  ");
      setInput(inputFor("Monthly take-home"), "250000");
      setInput(inputFor("Currency"), "lkr");
      setInput(inputFor("Savings target (%)"), "30");
    });

    const finish = [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => button.textContent?.trim() === "Get started");
    expect(finish?.disabled).toBe(false);
    await act(async () => finish?.click());

    expect(mounted.onComplete).toHaveBeenCalledOnce();
    const result = mounted.onComplete.mock.calls[0]![0];
    expect(result).toMatchObject({
      currency: "LKR",
      locale: "si-LK",
      targetSaveRate: 30,
      members: [{
        name: "Alex",
        color: MEMBER_PALETTE[0],
        portions: [{ label: "Monthly income", amount: 250000, currency: "LKR" }],
      }],
    });
  });
});
