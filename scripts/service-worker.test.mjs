// @vitest-environment node

import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

describe("service worker fallback", () => {
  it("serves the cached app shell when an offline navigation cannot be fetched", async () => {
    const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
    let fetchHandler;
    const cachedShell = new Response("<main>Mizan offline</main>", {
      headers: { "content-type": "text/html" },
    });
    const caches = {
      open: vi.fn(async () => ({ addAll: vi.fn(), put: vi.fn() })),
      keys: vi.fn(async () => []),
      delete: vi.fn(async () => true),
      match: vi.fn(async (request) =>
        request === "/index.html" ? cachedShell.clone() : undefined),
    };
    const serviceWorker = {
      location: { origin: "https://mizan.test" },
      clients: { claim: vi.fn() },
      skipWaiting: vi.fn(),
      addEventListener: (type, handler) => {
        if (type === "fetch") fetchHandler = handler;
      },
    };

    runInNewContext(source, {
      self: serviceWorker,
      caches,
      fetch: vi.fn(async () => { throw new Error("offline"); }),
      URL,
      Response,
      Promise,
    });

    let responsePromise;
    fetchHandler({
      request: { method: "GET", mode: "navigate", url: "https://mizan.test/history" },
      respondWith: (response) => { responsePromise = response; },
    });

    expect(await (await responsePromise).text()).toContain("Mizan offline");
    expect(caches.match).toHaveBeenCalledWith("/index.html");
  });
});
