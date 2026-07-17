import type { AppData } from "../domain/types";
import { migrate } from "../storage/schema";
import type { CloudSettings } from "./types";

/**
 * Read-only adapter for households created before snapshot manifests existed.
 *
 * Removal criteria: production telemetry/support evidence must show that every
 * active household has a snapshotManifest/current document, and the oldest
 * supported backup/import path must no longer create a manifestless household.
 * Writes must never be added here; the repository always writes snapshots.
 */
export async function loadLegacyManifestlessHousehold(
  readSettings: () => Promise<CloudSettings | null>,
  readCollections: (settings: CloudSettings) => Promise<AppData>,
): Promise<AppData> {
  const settings = await readSettings();
  return settings ? readCollections(settings) : migrate(null);
}
