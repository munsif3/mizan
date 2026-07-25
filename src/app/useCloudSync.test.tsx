import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppData, Transaction } from "../domain/types";
import type { DataRepository, RepositorySubscriptionOptions } from "../storage/repository";
import { emptyData } from "../storage/schema";
import { useCloudSync } from "./useCloudSync";

type SyncApi = ReturnType<typeof useCloudSync>;

interface SubscribeHooks {
  onData?: (data: AppData) => void;
  onError?: (message: string) => void;
}

function dataWith(id: string): AppData {
  return { ...emptyData(), transactions: [{ id } as Transaction] };
}

function fakeRepository(overrides: Partial<DataRepository>, hooks?: SubscribeHooks): DataRepository {
  return {
    mode: "cloud",
    load: vi.fn().mockResolvedValue(emptyData()),
    save: vi.fn().mockResolvedValue(undefined),
    subscribe: (onData, onError, _options?: RepositorySubscriptionOptions) => {
      if (hooks) {
        hooks.onData = onData;
        hooks.onError = onError;
      }
      return () => undefined;
    },
    ...overrides,
  } as DataRepository;
}

let api: SyncApi;
let setData: (data: AppData) => void;
let accessRemoved: number;

function Harness({ repository }: { repository: DataRepository | null }) {
  const [data, setDataState] = useState<AppData>(() => emptyData());
  setData = setDataState;
  api = useCloudSync({
    repository,
    data,
    setData: setDataState,
    clearUndo: () => undefined,
    setSyncStatus: () => undefined,
    onAccessRemoved: () => { accessRemoved += 1; },
  });
  return null;
}

describe("useCloudSync", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.useFakeTimers();
    accessRemoved = 0;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  // Mimic real activation: seed data without saving (skipNextSave), then attach
  // the repository, so no spurious mount save fires.
  async function activate(repository: DataRepository, seedId = "seed") {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<Harness repository={null} />));
    await act(async () => api.adoptLoadedData(dataWith(seedId)));
    await act(async () => root.render(<Harness repository={repository} />));
  }

  it("debounces a data change into a single save", async () => {
    const repo = fakeRepository({});
    await activate(repo);

    await act(async () => setData(dataWith("a")));
    await act(async () => setData(dataWith("b")));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });

    expect(repo.save).toHaveBeenCalledTimes(1);
    expect((vi.mocked(repo.save).mock.calls[0]![0]).transactions[0]!.id).toBe("b");
  });

  it("does not save data it just adopted", async () => {
    const repo = fakeRepository({});
    await activate(repo);
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it("raises a conflict when a save is rejected by a newer revision", async () => {
    const remote = dataWith("remote");
    const repo = fakeRepository({
      save: vi.fn().mockRejectedValue(new Error("This household changed on another device.")),
      load: vi.fn().mockResolvedValue(remote),
    });
    await activate(repo);

    await act(async () => setData(dataWith("mine")));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });

    expect(repo.load).toHaveBeenCalled();
    expect(api.conflict?.local.transactions[0]!.id).toBe("mine");
    expect(api.conflict?.remote.transactions[0]!.id).toBe("remote");
  });

  it("keeps the local edit by re-saving it on resolve", async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error("This household changed on another device."))
      .mockResolvedValue(undefined);
    const repo = fakeRepository({ save, load: vi.fn().mockResolvedValue(dataWith("remote")) });
    await activate(repo);

    await act(async () => setData(dataWith("mine")));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(api.conflict).not.toBeNull();

    await act(async () => api.resolveConflict("keep-local"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(api.conflict).toBeNull();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0].transactions[0]!.id).toBe("mine");
  });

  it("clears the conflict without re-saving when keeping the remote version", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("This household changed on another device."));
    const repo = fakeRepository({ save, load: vi.fn().mockResolvedValue(dataWith("remote")) });
    await activate(repo);

    await act(async () => setData(dataWith("mine")));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(api.conflict).not.toBeNull();

    await act(async () => api.resolveConflict("keep-remote"));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });

    expect(api.conflict).toBeNull();
    expect(save).toHaveBeenCalledTimes(1); // only the original failed attempt
  });

  it("tears down the household when the subscription reports lost access", async () => {
    const hooks: SubscribeHooks = {};
    const repo = fakeRepository({}, hooks);
    await activate(repo);

    await act(async () => hooks.onError?.("Missing or insufficient permissions."));

    expect(accessRemoved).toBe(1);
  });
});
