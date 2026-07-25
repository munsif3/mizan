import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_BASE_URL = "https://mizan-the-balance.web.app";
const DEFAULT_DIST_DIR = "dist";
const CRITICAL_FILES = ["/index.html", "/manifest.webmanifest", "/sw.js"];

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Recursively list every file in `distDir`, returning each with the URL path it
 * is served under. Sorted for stable, reproducible output.
 */
export async function collectDistFiles(distDir) {
  const files = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        files.push(abs);
      }
    }
  }
  await walk(distDir);
  return files
    .map((absPath) => ({
      absPath,
      urlPath: "/" + relative(distDir, absPath).split(sep).join("/"),
    }))
    .sort((a, b) => a.urlPath.localeCompare(b.urlPath));
}

/**
 * Fetch a URL as raw, uncompressed, uncached bytes. Requesting `identity`
 * encoding is what makes byte-for-byte comparison against local `dist` files
 * reliable — otherwise Firebase Hosting would gzip/brotli the response.
 */
export async function fetchBytes(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: { "Accept-Encoding": "identity" },
    cache: "no-store",
    redirect: "manual",
  });
  if (!response.ok) {
    return { ok: false, status: response.status, bytes: null, response };
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return { ok: true, status: response.status, bytes, response };
}

/** Flatten firebase.json hosting header rules into a lower-cased key/value map. */
export function expectedHeadersFromConfig(firebaseConfig) {
  const rules = firebaseConfig?.hosting?.headers ?? [];
  const map = {};
  for (const rule of rules) {
    for (const header of rule.headers ?? []) {
      map[header.key.toLowerCase()] = header.value;
    }
  }
  return map;
}

export function verifyHeaders(response, expected) {
  const mismatches = [];
  for (const [key, value] of Object.entries(expected)) {
    const actual = response.headers.get(key);
    if (actual !== value) {
      mismatches.push({ key, expected: value, actual });
    }
  }
  return mismatches;
}

/**
 * Poll the live index.html until its bytes match the locally built copy, giving
 * Firebase Hosting's edge cache a brief window to propagate the new release.
 */
async function waitForPropagation({ fetchImpl, sleep, baseUrl, indexFile, retries, retryDelayMs, log }) {
  const expected = await readFile(indexFile.absPath);
  const url = new URL(indexFile.urlPath, baseUrl).toString();
  let last = { ok: false, status: 0, bytes: null, response: null };
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    last = await fetchBytes(fetchImpl, url);
    if (last.ok && last.bytes.equals(expected)) {
      return { ok: true, response: last.response, attempts: attempt };
    }
    if (attempt < retries) {
      log(`index.html not yet propagated (attempt ${attempt}/${retries}); retrying...`);
      await sleep(retryDelayMs);
    }
  }
  return { ok: false, response: last.response, status: last.status, attempts: retries };
}

/**
 * Verify that the live production site byte-for-byte matches the local build,
 * that the PWA-critical files are present, and that the configured security
 * headers are served. Resolves to a result object; never throws for a plain
 * content/header mismatch (the CLI wrapper decides the exit code).
 */
export async function verifyProduction({
  distDir = DEFAULT_DIST_DIR,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = fetch,
  sleep = defaultSleep,
  retries = 5,
  retryDelayMs = 3000,
  expectedHeaders = {},
  criticalFiles = CRITICAL_FILES,
  log = () => {},
}) {
  const files = await collectDistFiles(distDir);
  const indexFile = files.find((file) => file.urlPath === "/index.html");
  if (!indexFile) {
    return { ok: false, reason: "missing-local-index", mismatches: [], headerMismatches: [] };
  }

  const missingCritical = criticalFiles.filter(
    (path) => !files.some((file) => file.urlPath === path),
  );
  if (missingCritical.length > 0) {
    return { ok: false, reason: "missing-critical-file", missingCritical, mismatches: [], headerMismatches: [] };
  }

  const propagation = await waitForPropagation({
    fetchImpl,
    sleep,
    baseUrl,
    indexFile,
    retries,
    retryDelayMs,
    log,
  });
  if (!propagation.ok) {
    return {
      ok: false,
      reason: "propagation-timeout",
      attempts: propagation.attempts,
      status: propagation.status,
      mismatches: [{ path: indexFile.urlPath, status: propagation.status ?? 0 }],
      headerMismatches: [],
    };
  }

  const headerMismatches = verifyHeaders(propagation.response, expectedHeaders);

  const mismatches = [];
  for (const file of files) {
    const expected = await readFile(file.absPath);
    const url = new URL(file.urlPath, baseUrl).toString();
    const result = await fetchBytes(fetchImpl, url);
    if (!result.ok) {
      mismatches.push({ path: file.urlPath, status: result.status, reason: "http-error" });
      continue;
    }
    if (!result.bytes.equals(expected)) {
      mismatches.push({ path: file.urlPath, status: result.status, reason: "content-mismatch" });
    }
  }

  return {
    ok: mismatches.length === 0 && headerMismatches.length === 0,
    reason: mismatches.length === 0 && headerMismatches.length === 0 ? "verified" : "mismatch",
    checked: files.length,
    attempts: propagation.attempts,
    mismatches,
    headerMismatches,
  };
}

function formatResult(result) {
  const lines = [];
  if (result.reason === "missing-local-index") {
    lines.push("No dist/index.html found; did the production build run?");
  }
  for (const path of result.missingCritical ?? []) {
    lines.push(`Critical file missing from local build: ${path}`);
  }
  if (result.reason === "propagation-timeout") {
    lines.push(
      `index.html did not match production after ${result.attempts} attempts (last status ${result.status ?? "unknown"}).`,
    );
  }
  for (const mismatch of result.mismatches ?? []) {
    lines.push(`Production mismatch at ${mismatch.path} (status ${mismatch.status}, ${mismatch.reason}).`);
  }
  for (const mismatch of result.headerMismatches ?? []) {
    lines.push(
      `Header mismatch for "${mismatch.key}": expected "${mismatch.expected}", got "${mismatch.actual ?? "(absent)"}".`,
    );
  }
  return lines;
}

async function main() {
  const distDir = process.env.DIST_DIR || DEFAULT_DIST_DIR;
  const baseUrl = process.env.PRODUCTION_BASE_URL || DEFAULT_BASE_URL;
  const firebaseConfig = JSON.parse(
    await readFile(new URL("../firebase.json", import.meta.url), "utf8"),
  );
  const expectedHeaders = expectedHeadersFromConfig(firebaseConfig);

  const result = await verifyProduction({
    distDir,
    baseUrl,
    expectedHeaders,
    log: (message) => console.log(message),
  });

  if (result.ok) {
    console.log(`Verified ${result.checked} files byte-for-byte against ${baseUrl} (after ${result.attempts} propagation attempt(s)).`);
    return;
  }
  for (const line of formatResult(result)) {
    console.error(line);
  }
  process.exit(1);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
