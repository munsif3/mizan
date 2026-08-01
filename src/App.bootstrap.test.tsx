import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthState } from "./auth/authStore";
import { addMonths, isoDateOf, monthLabel } from "./domain/dates";
import type { AppData } from "./domain/types";
import type { HouseholdMeta, UserProfile } from "./household/types";
import { emptyData } from "./storage/schema";

const bootstrap = vi.hoisted(() => ({
  authState: { status: "signed-out", user: null, error: "" } as unknown,
  loadUserProfile: vi.fn(),
  saveUserProfile: vi.fn(),
  loadUserHouseholds: vi.fn(),
  loadHouseholdMeta: vi.fn(),
  repositoryLoad: vi.fn(),
  repositorySave: vi.fn(),
  repositorySubscribe: vi.fn(),
}));

vi.mock("./auth/authStore", async () => {
  const actual = await vi.importActual<typeof import("./auth/authStore")>("./auth/authStore");
  return { ...actual, useAuthState: () => bootstrap.authState as AuthState };
});

vi.mock("./firebase/client", async () => {
  const actual = await vi.importActual<typeof import("./firebase/client")>("./firebase/client");
  return {
    ...actual,
    getFirebaseServices: () => ({ app: {}, auth: {}, db: {} }),
  };
});

vi.mock("./household/firestoreRepository", async () => {
  const actual = await vi.importActual<typeof import("./household/firestoreRepository")>("./household/firestoreRepository");
  return {
    ...actual,
    loadUserProfile: bootstrap.loadUserProfile,
    saveUserProfile: bootstrap.saveUserProfile,
    loadUserHouseholds: bootstrap.loadUserHouseholds,
    loadHouseholdMeta: bootstrap.loadHouseholdMeta,
    FirestoreHouseholdRepository: class {
      readonly mode = "cloud" as const;
      load = bootstrap.repositoryLoad;
      save = bootstrap.repositorySave;
      subscribe = bootstrap.repositorySubscribe;
    },
  };
});

import App from "./App";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const signedIn: AuthState = {
  status: "signed-in",
  user: { uid: "user-1", displayName: "Ana", email: "ana@example.com", photoURL: "" },
  error: "",
};

const profile: UserProfile = {
  activeHouseholdId: "household-1",
  privacy: false,
  theme: "light",
  lastView: "home",
  lastMonth: "",
  categoryFilter: "all",
  beneficiaryFilter: "all",
  payerFilter: "all",
  lastCheckInByHousehold: {},
  updatedAt: "2026-07-12T00:00:00.000Z",
};

const meta: HouseholdMeta = {
  id: "household-1",
  name: "Ana household",
  ownerUid: "user-1",
  membersByUid: {
    "user-1": { role: "owner", displayName: "Ana", email: "ana@example.com", joinedAt: "2026-07-01T00:00:00.000Z" },
  },
  inviteCode: "invite",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-12T00:00:00.000Z",
};

function householdData(): AppData {
  const data = emptyData();
  data.settings.currency = "LKR";
  data.settings.locale = "en-LK";
  data.settings.members = [{ id: "ana", name: "Ana", color: "#123456", portions: [] }];
  return data;
}

function button(container: HTMLElement, label: string) {
  const match = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
  if (!match) throw new Error(`Could not find the ${label} button.`);
  return match;
}

describe("signed-in startup bootstrap", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/");
    localStorage.clear();
    bootstrap.authState = signedIn;
    bootstrap.saveUserProfile.mockResolvedValue(undefined);
    bootstrap.repositorySave.mockResolvedValue(undefined);
    bootstrap.repositorySubscribe.mockReturnValue(() => undefined);
    vi.spyOn(console, "table").mockImplementation(() => undefined);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
  });

  it("loads the household without waiting for the household list or flashing create controls", async () => {
    const profileRequest = deferred<UserProfile>();
    const listRequest = deferred<never[]>();
    const metaRequest = deferred<HouseholdMeta>();
    const dataRequest = deferred<AppData>();
    bootstrap.loadUserProfile.mockReturnValue(profileRequest.promise);
    bootstrap.loadUserHouseholds.mockReturnValue(listRequest.promise);
    bootstrap.loadHouseholdMeta.mockReturnValue(metaRequest.promise);
    bootstrap.repositoryLoad.mockReturnValue(dataRequest.promise);

    await act(async () => root.render(<App />));
    expect(bootstrap.loadUserProfile).toHaveBeenCalledTimes(1);
    expect(bootstrap.loadUserHouseholds).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Loading cloud profile");
    expect(container.textContent).not.toContain("Create household");

    await act(async () => profileRequest.resolve(profile));
    expect(bootstrap.loadHouseholdMeta).toHaveBeenCalledTimes(1);
    expect(bootstrap.repositoryLoad).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Loading household data");
    expect(container.textContent).not.toContain("Create household");

    await act(async () => {
      metaRequest.resolve(meta);
      dataRequest.resolve(householdData());
    });
    expect(button(container, "Balance").getAttribute("aria-current")).toBe("page");
    expect(bootstrap.saveUserProfile).not.toHaveBeenCalled();
    expect(bootstrap.repositorySubscribe).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), { skipInitial: true });
  });

  it("pushes into The Books and returns cleanly through primary navigation", async () => {
    const data = householdData();
    data.settings.members[0]!.portions = [{
      id: "salary",
      label: "Monthly income",
      amount: 100_000,
      currency: "LKR",
      taxRate: 0,
      taxWithheld: true,
      window: null,
      schedule: { frequency: "monthly" },
      budgetTreatment: "ordinary",
    }];
    bootstrap.loadUserProfile.mockResolvedValue(profile);
    bootstrap.loadUserHouseholds.mockResolvedValue([]);
    bootstrap.loadHouseholdMeta.mockResolvedValue(meta);
    bootstrap.repositoryLoad.mockResolvedValue(data);

    await act(async () => root.render(<App />));
    await vi.waitFor(() => expect(button(container, "Balance").getAttribute("aria-current")).toBe("page"));

    await act(async () => button(container, "Open the books").click());
    expect(container.querySelector(".app-shell")?.classList.contains("books-open")).toBe(true);
    expect(container.textContent).toContain("The Books");

    await act(async () => button(container, "Ledger").click());
    expect(container.querySelector(".app-shell")?.classList.contains("books-open")).toBe(false);
    expect(button(container, "Ledger").getAttribute("aria-current")).toBe("page");

    await act(async () => button(container, "Balance").click());
    expect(container.textContent).toContain("Open the books");
    expect(container.querySelector(".books-view")).toBeNull();
  });

  it("keeps a weekly-close deep link open while the saved view preference loads", async () => {
    window.history.replaceState(null, "", "/#weekly-close/step-1");
    bootstrap.loadUserProfile.mockResolvedValue({ ...profile, lastView: "trend" });
    bootstrap.loadUserHouseholds.mockResolvedValue([]);
    bootstrap.loadHouseholdMeta.mockResolvedValue(meta);
    bootstrap.repositoryLoad.mockResolvedValue(householdData());

    await act(async () => root.render(<App />));
    await vi.waitFor(() => expect(container.querySelector(".weekly-close-view")).not.toBeNull());
    expect(container.querySelector(".weekly-close-progress")).not.toBeNull();
    expect(window.location.hash).toBe("#weekly-close/step-1");
  });

  it("offers a retry and completes startup after a transient profile failure", async () => {
    bootstrap.loadUserProfile
      .mockRejectedValueOnce(new Error("profile unavailable"))
      .mockResolvedValueOnce(profile);
    bootstrap.loadUserHouseholds.mockResolvedValue([]);
    bootstrap.loadHouseholdMeta.mockResolvedValue(meta);
    bootstrap.repositoryLoad.mockResolvedValue(householdData());

    await act(async () => root.render(<App />));
    expect(container.textContent).toContain("We couldn’t open this household");
    expect(container.textContent).toContain("profile unavailable");

    await act(async () => button(container, "Retry household load").click());
    await vi.waitFor(() => expect(button(container, "Balance").getAttribute("aria-current")).toBe("page"));
    expect(bootstrap.loadUserProfile).toHaveBeenCalledTimes(2);
  });

  it("preserves an older saved month until authoritative household data extends the range", async () => {
    const oldMonth = addMonths(isoDateOf(new Date()).slice(0, 7), -36);
    const oldProfile = { ...profile, lastMonth: oldMonth };
    const data = householdData();
    data.transactions = [{
      id: "old-row",
      date: `${oldMonth}-10`,
      description: "OLD PURCHASE",
      amount: 1_000,
      category: "food",
      beneficiary: { type: "household" },
      account: "Cash",
      note: "",
      source: "imported",
      direction: "debit",
      kind: "expense",
    }];
    const dataRequest = deferred<AppData>();
    bootstrap.loadUserProfile.mockResolvedValue(oldProfile);
    bootstrap.loadUserHouseholds.mockResolvedValue([]);
    bootstrap.loadHouseholdMeta.mockResolvedValue(meta);
    bootstrap.repositoryLoad.mockReturnValue(dataRequest.promise);

    await act(async () => root.render(<App />));
    await vi.waitFor(() => expect(bootstrap.repositoryLoad).toHaveBeenCalledTimes(1));
    expect(bootstrap.saveUserProfile).not.toHaveBeenCalled();

    await act(async () => dataRequest.resolve(data));
    await vi.waitFor(() => expect(button(container, "Balance").getAttribute("aria-current")).toBe("page"));

    expect(container.querySelector(".month-trigger")?.textContent).toContain(monthLabel(oldMonth));
    expect(bootstrap.saveUserProfile).not.toHaveBeenCalled();
  });

  it("keeps an empty calendar month global without adding it to Trend", async () => {
    const data = householdData();
    data.settings.members[0]!.portions = [{
      id: "salary",
      label: "Monthly income",
      amount: 100_000,
      currency: "LKR",
      taxRate: 0,
      taxWithheld: true,
      window: null,
      schedule: { frequency: "monthly" },
      budgetTreatment: "ordinary",
    }];
    bootstrap.loadUserProfile.mockResolvedValue(profile);
    bootstrap.loadUserHouseholds.mockResolvedValue([]);
    bootstrap.loadHouseholdMeta.mockResolvedValue(meta);
    bootstrap.repositoryLoad.mockResolvedValue(data);

    await act(async () => root.render(<App />));
    await vi.waitFor(() => expect(button(container, "Balance").getAttribute("aria-current")).toBe("page"));

    const todayMonth = isoDateOf(new Date()).slice(0, 7);
    const previousMonth = addMonths(todayMonth, -1);
    const previousLabel = monthLabel(previousMonth);
    await act(async () => container.querySelector<HTMLButtonElement>(".month-trigger")?.click());
    await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${previousLabel}"]`)?.click());

    expect(container.querySelector(".month-trigger")?.textContent).toContain(previousLabel);
    expect(container.textContent).toContain(previousLabel);

    await act(async () => button(container, "Ledger").click());
    expect(container.querySelector(".month-trigger")?.textContent).toContain(previousLabel);
    expect(container.textContent).toContain(`No activity in ${previousLabel}`);
    expect(container.querySelector(".ledger-table")).toBeNull();

    await act(async () => button(container, "Trend").click());
    // Trend is lazy-loaded, so wait for its chunk to resolve and render.
    await vi.waitFor(() => expect(container.textContent).toContain(`No recorded data for ${previousLabel}.`));
    expect(container.querySelector(".month-trigger")?.textContent).toContain(previousLabel);
  });

  it("ignores an in-flight household result after sign-out", async () => {
    const metaRequest = deferred<HouseholdMeta>();
    const dataRequest = deferred<AppData>();
    bootstrap.loadUserProfile.mockResolvedValue(profile);
    bootstrap.loadUserHouseholds.mockResolvedValue([]);
    bootstrap.loadHouseholdMeta.mockReturnValue(metaRequest.promise);
    bootstrap.repositoryLoad.mockReturnValue(dataRequest.promise);

    await act(async () => root.render(<App />));
    await vi.waitFor(() => expect(bootstrap.repositoryLoad).toHaveBeenCalledTimes(1));
    bootstrap.authState = { status: "signed-out", user: null, error: "" } satisfies AuthState;
    await act(async () => root.render(<App />));
    await act(async () => {
      metaRequest.resolve(meta);
      dataRequest.resolve(householdData());
    });

    expect(container.textContent).toContain("Sign in to continue");
    expect(container.textContent).not.toContain("Balance");
    expect(bootstrap.repositorySubscribe).not.toHaveBeenCalled();
  });
});
