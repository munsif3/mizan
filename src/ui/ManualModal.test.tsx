import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ManualModal } from "./ManualModal";

describe("ManualModal beneficiary classification", () => {
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

  it("stores purpose and member beneficiary independently", async () => {
    const onAdd = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(
      <ManualModal
        accounts={[{ id: "alex-card", label: "Alex Card", owner: "alex", beneficiaryDefault: "review", match: [] }]}
        members={[
          { id: "alex", name: "Alex", color: "#5b8cff", portions: [] },
          { id: "sam", name: "Sam", color: "#ff80b5", portions: [] },
        ]}
        customCategories={[]}
        counterparties={[]}
        onAdd={onAdd}
        onClose={() => {}}
      />,
    ));

    const setValue = async (selector: string, value: string) => {
      const field = container?.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
      await act(async () => {
        if (!field) return;
        if (field instanceof HTMLInputElement) {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, value);
          field.dispatchEvent(new Event("input", { bubbles: true }));
        } else {
          field.value = value;
          field.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    };
    await setValue('input[aria-label="Amount"]', "4500");
    await setValue('input[aria-label="Description"]', "TRAIN PASS");
    await setValue('select[aria-label="Category"]', "transport");
    const beneficiary = container?.querySelector<HTMLSelectElement>('select[aria-label="Beneficiary"]');
    await act(async () => {
      if (!beneficiary) return;
      beneficiary.value = "member:sam";
      beneficiary.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await act(async () => container?.querySelector<HTMLFormElement>("form")?.requestSubmit());
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      description: "TRAIN PASS",
      amount: 4500,
      category: "transport",
      beneficiary: { type: "member", memberId: "sam" },
      kind: "expense",
    }));
  });

  it("uses the selected account default until the beneficiary is explicitly changed", async () => {
    const onAdd = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(
      <ManualModal
        accounts={[{ id: "sara-card", label: "Sara Card", owner: "sara", beneficiaryDefault: "owner", match: [] }]}
        members={[{ id: "sara", name: "Sara", color: "#5b8cff", portions: [] }]}
        customCategories={[]}
        counterparties={[]}
        onAdd={onAdd}
        onClose={() => {}}
      />,
    ));

    const setInput = async (label: string, value: string) => {
      const field = container?.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
      await act(async () => {
        if (!field) return;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await setInput("Amount", "1090");
    await setInput("Description", "COOL PLANET");
    expect(container?.querySelector<HTMLSelectElement>('select[aria-label="Beneficiary"]')?.value).toBe("member:sara");
    await act(async () => container?.querySelector<HTMLFormElement>("form")?.requestSubmit());
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      account: "Sara Card",
      accountId: "sara-card",
      beneficiary: { type: "member", memberId: "sara" },
      beneficiarySource: "account_default",
    }));
  });

  it("switches registered accounts by stable id and adopts the new default", async () => {
    const onAdd = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(
      <ManualModal
        accounts={[
          { id: "sara-card", label: "Sara Card", owner: "sara", beneficiaryDefault: "owner", match: [] },
          { id: "home-card", label: "Home Card", owner: "sara", beneficiaryDefault: "household", match: [] },
        ]}
        members={[{ id: "sara", name: "Sara", color: "#5b8cff", portions: [] }]}
        customCategories={[]}
        counterparties={[]}
        onAdd={onAdd}
        onClose={() => {}}
      />,
    ));

    const setInput = async (label: string, value: string) => {
      const field = container?.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, value);
        field?.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await setInput("Amount", "3200");
    await setInput("Description", "GROCERIES");
    const account = container?.querySelector<HTMLSelectElement>('select[aria-label="Account"]');
    await act(async () => {
      if (!account) return;
      account.value = "home-card";
      account.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container?.querySelector<HTMLSelectElement>('select[aria-label="Beneficiary"]')?.value).toBe("household");

    await act(async () => container?.querySelector<HTMLFormElement>("form")?.requestSubmit());
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      account: "Home Card",
      accountId: "home-card",
      beneficiary: { type: "household" },
      beneficiarySource: "account_default",
    }));
  });

  it("preserves an explicit beneficiary across account changes", async () => {
    const onAdd = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(
      <ManualModal
        accounts={[
          { id: "sara-card", label: "Sara Card", owner: "sara", beneficiaryDefault: "owner", match: [] },
          { id: "sam-card", label: "Sam Card", owner: "sam", beneficiaryDefault: "owner", match: [] },
        ]}
        members={[
          { id: "sara", name: "Sara", color: "#5b8cff", portions: [] },
          { id: "sam", name: "Sam", color: "#ff80b5", portions: [] },
        ]}
        customCategories={[]}
        counterparties={[]}
        onAdd={onAdd}
        onClose={() => {}}
      />,
    ));

    const setInput = async (label: string, value: string) => {
      const field = container?.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, value);
        field?.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await setInput("Amount", "4500");
    await setInput("Description", "FAMILY DINNER");
    const beneficiary = container?.querySelector<HTMLSelectElement>('select[aria-label="Beneficiary"]');
    await act(async () => {
      if (!beneficiary) return;
      beneficiary.value = "household";
      beneficiary.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const account = container?.querySelector<HTMLSelectElement>('select[aria-label="Account"]');
    await act(async () => {
      if (!account) return;
      account.value = "sam-card";
      account.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(beneficiary?.value).toBe("household");

    await act(async () => container?.querySelector<HTMLFormElement>("form")?.requestSubmit());
    const entry = onAdd.mock.calls[0]?.[0];
    expect(entry).toMatchObject({ account: "Sam Card", accountId: "sam-card", beneficiary: { type: "household" } });
    expect(entry).not.toHaveProperty("beneficiarySource");
  });

  it("supports an unregistered Cash account when no accounts are configured", async () => {
    const onAdd = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(
      <ManualModal
        accounts={[]}
        members={[{ id: "sara", name: "Sara", color: "#5b8cff", portions: [] }]}
        customCategories={[]}
        counterparties={[]}
        onAdd={onAdd}
        onClose={() => {}}
      />,
    ));

    expect(container?.querySelector<HTMLSelectElement>('select[aria-label="Account"]')?.value).toBe("__other__");
    expect(container?.querySelector<HTMLInputElement>('input[aria-label="Account name"]')?.value).toBe("Cash");
    const setInput = async (label: string, value: string) => {
      const field = container?.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, value);
        field?.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await setInput("Amount", "500");
    await setInput("Description", "CASH PURCHASE");
    const beneficiary = container?.querySelector<HTMLSelectElement>('select[aria-label="Beneficiary"]');
    await act(async () => {
      if (!beneficiary) return;
      beneficiary.value = "household";
      beneficiary.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => container?.querySelector<HTMLFormElement>("form")?.requestSubmit());
    const entry = onAdd.mock.calls[0]?.[0];
    expect(entry).toMatchObject({ account: "Cash", beneficiary: { type: "household" } });
    expect(entry).not.toHaveProperty("accountId");
    expect(entry).not.toHaveProperty("beneficiarySource");
  });
});
