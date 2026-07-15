import type { AppData } from "../domain/types";

export type RepositoryMode = "cloud" | "none";

export interface RepositorySubscriptionOptions {
  /** Skip the first snapshot only when it represents the data returned by load(). */
  skipInitial?: boolean;
}

export interface DataRepository {
  mode: "cloud";
  load(): Promise<AppData>;
  save(data: AppData): Promise<void>;
  subscribe?(
    onData: (data: AppData) => void,
    onError: (message: string) => void,
    options?: RepositorySubscriptionOptions,
  ): () => void;
}

/**
 * Serialize a destructive snapshot after the current save and publish only a
 * server-confirmed state. Callers must cancel any not-yet-queued debounce first.
 */
export async function saveAuthoritativeData(
  repository: DataRepository,
  pendingSave: Promise<void>,
  nextData: AppData,
  acceptSnapshot: (data: AppData) => void,
): Promise<void> {
  await pendingSave.catch(() => undefined);
  try {
    await repository.save(nextData);
    acceptSnapshot(nextData);
  } catch (error) {
    try {
      acceptSnapshot(await repository.load());
    } catch {
      // Keep the caller's local state if Firestore cannot provide a recovery snapshot.
    }
    throw error;
  }
}
