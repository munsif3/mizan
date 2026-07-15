// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { OneOffIncomeModal } from "./OneOffIncomeModal";

describe("OneOffIncomeModal", () => {
  it("creates a protected one-off source for the chosen month", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onSave = vi.fn();
    await act(async () => {
      root.render(
        <OneOffIncomeModal
          members={[{ id: "owner", name: "Owner", color: "#5b8cff", portions: [] }]}
          month="2026-07"
          householdCurrency="LKR"
          onSave={onSave}
          onClose={() => {}}
        />,
      );
    });

    const amount = [...container.querySelectorAll<HTMLInputElement>('input[type="number"]')][0]!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(amount, "250000");
      amount.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [...container.querySelectorAll("button")].find((button) => button.textContent === "Add planned income")!;
    expect(save.disabled).toBe(false);
    await act(async () => save.click());

    expect(onSave).toHaveBeenCalledWith("owner", expect.objectContaining({
      label: "Annual bonus",
      amount: 250000,
      currency: "LKR",
      schedule: { frequency: "one_off", month: "2026-07" },
      budgetTreatment: "protected",
    }));
    await act(async () => root.unmount());
    container.remove();
  });
});
