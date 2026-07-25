import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectDistFiles,
  expectedHeadersFromConfig,
  fetchBytes,
  verifyHeaders,
  verifyProduction,
} from "./verify-production.mjs";

let distDir;
const baseUrl = "https://mizan-the-balance.web.app";

/** Build a fake dist directory with index.html + the two PWA-critical files. */
async function seedDist(files) {
  distDir = await mkdtemp(join(tmpdir(), "mizan-dist-"));
  for (const [relPath, content] of Object.entries(files)) {
    const abs = join(distDir, relPath);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content);
  }
  return distDir;
}

const defaultFiles = {
  "index.html": "<!doctype html><title>Mizan</title>",
  "manifest.webmanifest": "{\"name\":\"Mizan\"}",
  "sw.js": "self.addEventListener('install', () => {});",
  "assets/app.js": "console.log('app');",
};

/** A Response-like object backed by an in-memory byte map. */
function makeFetch(bytesByPath, { headers = {}, status = 200 } = {}) {
  return vi.fn(async (url) => {
    const path = new URL(url).pathname;
    const body = bytesByPath[path];
    if (body === undefined) {
      return { ok: false, status: 404, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) };
    }
    const buffer = Buffer.from(body);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(headers),
      arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    };
  });
}

function liveBytesFrom(files) {
  const map = {};
  for (const [rel, content] of Object.entries(files)) {
    map["/" + rel] = content;
  }
  return map;
}

const noSleep = async () => {};

afterEach(async () => {
  if (distDir) {
    await rm(distDir, { recursive: true, force: true });
    distDir = undefined;
  }
});

describe("collectDistFiles", () => {
  it("lists every file with its served URL path, sorted", async () => {
    const dir = await seedDist(defaultFiles);
    const files = await collectDistFiles(dir);
    expect(files.map((f) => f.urlPath)).toEqual([
      "/assets/app.js",
      "/index.html",
      "/manifest.webmanifest",
      "/sw.js",
    ]);
  });
});

describe("verifyHeaders", () => {
  it("returns no mismatches when all expected headers match", () => {
    const response = { headers: new Headers({ "content-security-policy": "default-src 'self'" }) };
    expect(verifyHeaders(response, { "content-security-policy": "default-src 'self'" })).toEqual([]);
  });

  it("reports missing or differing headers", () => {
    const response = { headers: new Headers({ "x-frame-options": "SAMEORIGIN" }) };
    const mismatches = verifyHeaders(response, { "x-frame-options": "DENY", "x-content-type-options": "nosniff" });
    expect(mismatches).toEqual([
      { key: "x-frame-options", expected: "DENY", actual: "SAMEORIGIN" },
      { key: "x-content-type-options", expected: "nosniff", actual: null },
    ]);
  });
});

describe("expectedHeadersFromConfig", () => {
  it("flattens firebase.json header rules into a lower-cased map", () => {
    const config = {
      hosting: {
        headers: [
          { source: "**", headers: [{ key: "X-Frame-Options", value: "DENY" }, { key: "X-Content-Type-Options", value: "nosniff" }] },
        ],
      },
    };
    expect(expectedHeadersFromConfig(config)).toEqual({
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
    });
  });
});

describe("fetchBytes", () => {
  it("requests identity encoding and returns bytes on success", async () => {
    const fetchImpl = makeFetch({ "/index.html": "hello" });
    const result = await fetchBytes(fetchImpl, `${baseUrl}/index.html`);
    expect(result.ok).toBe(true);
    expect(result.bytes.toString()).toBe("hello");
    expect(fetchImpl.mock.calls[0][1].headers["Accept-Encoding"]).toBe("identity");
  });

  it("reports the status on an HTTP error without bytes", async () => {
    const fetchImpl = makeFetch({});
    const result = await fetchBytes(fetchImpl, `${baseUrl}/missing`);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.bytes).toBeNull();
  });
});

describe("verifyProduction", () => {
  it("succeeds when production matches the local build byte-for-byte", async () => {
    const dir = await seedDist(defaultFiles);
    const fetchImpl = makeFetch(liveBytesFrom(defaultFiles));
    const result = await verifyProduction({ distDir: dir, baseUrl, fetchImpl, sleep: noSleep });
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(4);
    expect(result.mismatches).toEqual([]);
  });

  it("reports the mismatched path when live content differs", async () => {
    const dir = await seedDist(defaultFiles);
    const live = liveBytesFrom(defaultFiles);
    live["/assets/app.js"] = "console.log('STALE');";
    const fetchImpl = makeFetch(live);
    const result = await verifyProduction({ distDir: dir, baseUrl, fetchImpl, sleep: noSleep });
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([
      { path: "/assets/app.js", status: 200, reason: "content-mismatch" },
    ]);
  });

  it("fails when a PWA-critical file is absent from the local build", async () => {
    const { ["sw.js"]: _omitted, ...withoutSw } = defaultFiles;
    const dir = await seedDist(withoutSw);
    const fetchImpl = makeFetch(liveBytesFrom(withoutSw));
    const result = await verifyProduction({ distDir: dir, baseUrl, fetchImpl, sleep: noSleep });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing-critical-file");
    expect(result.missingCritical).toEqual(["/sw.js"]);
  });

  it("retries while index.html propagates, then succeeds", async () => {
    const dir = await seedDist(defaultFiles);
    const live = liveBytesFrom(defaultFiles);
    let indexHits = 0;
    const fetchImpl = vi.fn(async (url) => {
      const path = new URL(url).pathname;
      let body = live[path];
      if (path === "/index.html") {
        indexHits += 1;
        if (indexHits < 3) body = "OLD CONTENT"; // stale for first two polls
      }
      const buffer = Buffer.from(body ?? "");
      return {
        ok: body !== undefined,
        status: body !== undefined ? 200 : 404,
        headers: new Headers(),
        arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      };
    });
    const sleep = vi.fn(async () => {});
    const result = await verifyProduction({ distDir: dir, baseUrl, fetchImpl, sleep, retries: 5, retryDelayMs: 10 });
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("fails when index.html never propagates within the retry budget", async () => {
    const dir = await seedDist(defaultFiles);
    const live = { ...liveBytesFrom(defaultFiles), "/index.html": "PERMANENTLY STALE" };
    const fetchImpl = makeFetch(live);
    const result = await verifyProduction({ distDir: dir, baseUrl, fetchImpl, sleep: noSleep, retries: 3, retryDelayMs: 1 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("propagation-timeout");
    expect(result.attempts).toBe(3);
  });

  it("reports an HTTP error on a hashed asset as a mismatch", async () => {
    const dir = await seedDist(defaultFiles);
    const live = liveBytesFrom(defaultFiles);
    delete live["/assets/app.js"]; // 404 on the live asset
    const fetchImpl = makeFetch(live);
    const result = await verifyProduction({ distDir: dir, baseUrl, fetchImpl, sleep: noSleep });
    expect(result.ok).toBe(false);
    expect(result.mismatches).toContainEqual({ path: "/assets/app.js", status: 404, reason: "http-error" });
  });

  it("reports a security-header mismatch even when content matches", async () => {
    const dir = await seedDist(defaultFiles);
    const fetchImpl = makeFetch(liveBytesFrom(defaultFiles));
    const result = await verifyProduction({
      distDir: dir,
      baseUrl,
      fetchImpl,
      sleep: noSleep,
      expectedHeaders: { "x-frame-options": "DENY" },
    });
    expect(result.ok).toBe(false);
    expect(result.headerMismatches).toEqual([
      { key: "x-frame-options", expected: "DENY", actual: null },
    ]);
  });
});
