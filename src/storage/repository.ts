import type { AppData } from "../domain/types";

export type RepositoryMode = "cloud" | "none";

export interface DataRepository {
  mode: "cloud";
  load(): Promise<AppData>;
  save(data: AppData): Promise<void>;
  subscribe?(onData: (data: AppData) => void, onError: (message: string) => void): () => void;
}
