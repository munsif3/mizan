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
