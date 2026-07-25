/**
 * Headless browser driver for Mizan.
 *
 * Deliberately dependency-free: Node 22 ships global `fetch` and `WebSocket`,
 * which is everything the Chrome DevTools Protocol needs. Adding Playwright
 * would pull ~150 MB of browser binaries to do what ~200 lines does here.
 *
 * Usage:
 *   node scripts/drive-app.mjs --url http://localhost:5173 --screenshot out.png
 *   node scripts/drive-app.mjs --url http://localhost:5173 --sign-in me@example.com \
 *     --expect "Sign out" --screenshot signed-in.png
 */
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

export function findChrome() {
  const found = CHROME_CANDIDATES.find((path) => path && existsSync(path));
  if (!found) throw new Error("No Chrome/Edge found. Set CHROME_PATH.");
  return found;
}

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    args[key] = next && !next.startsWith("--") ? (i += 1, next) : true;
  }
  return args;
}

/** Minimal flat-session CDP client: one socket, many sessions, promise per id. */
class CDP {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const entry = this.pending.get(message.id);
        if (!entry) return;
        this.pending.delete(message.id);
        message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
        return;
      }
      for (const listener of this.listeners) listener(message);
    });
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener("open", () => resolve(new CDP(socket)));
      socket.addEventListener("error", () => reject(new Error(`CDP connect failed: ${url}`)));
    });
  }

  send(method, params = {}, sessionId) {
    const id = (this.nextId += 1);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(listener) {
    this.listeners.push(listener);
  }

  close() {
    this.socket.close();
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Chrome needs a moment before the debugging endpoint answers. */
async function waitForDevTools(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch {
      // Not listening yet.
    }
    await sleep(200);
  }
  throw new Error(`DevTools endpoint never came up on port ${port}`);
}

/** Poll the rendered text instead of guessing at a fixed delay. */
async function waitForText(cdp, sessionId, text, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { result } = await cdp.send(
      "Runtime.evaluate",
      { expression: "document.body ? document.body.innerText : ''", returnByValue: true },
      sessionId,
    );
    if (typeof result.value === "string" && result.value.includes(text)) return true;
    await sleep(250);
  }
  return false;
}

export async function drive({ url, screenshot, signIn, expect, port = 9333, keepOpen = false }) {
  const chrome = findChrome();
  const profile = `${process.env.TEMP || "/tmp"}/mizan-drive-${Date.now()}`;
  const child = spawn(chrome, [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--window-size=1440,900",
    "about:blank",
  ]);

  const consoleErrors = [];
  let cdp;
  try {
    cdp = await CDP.connect(await waitForDevTools(port));
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });

    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    cdp.on((message) => {
      if (message.sessionId !== sessionId) return;
      if (message.method === "Runtime.exceptionThrown") {
        consoleErrors.push(message.params.exceptionDetails.text ?? "exception");
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        consoleErrors.push(message.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
      }
    });

    await cdp.send("Page.navigate", { url }, sessionId);
    await waitForText(cdp, sessionId, "Mizan", 20000);

    if (signIn) {
      // The hook only exists under `vite --mode emulator`; see src/firebase/client.ts.
      const { result, exceptionDetails } = await cdp.send(
        "Runtime.evaluate",
        {
          expression: `(async () => {
            if (typeof globalThis.__mizanEmulatorSignIn !== "function") {
              return "NO_HOOK";
            }
            await globalThis.__mizanEmulatorSignIn(${JSON.stringify(signIn)});
            return "OK";
          })()`,
          awaitPromise: true,
          returnByValue: true,
        },
        sessionId,
      );
      if (exceptionDetails) throw new Error(`sign-in threw: ${exceptionDetails.text}`);
      if (result.value === "NO_HOOK") {
        throw new Error("__mizanEmulatorSignIn missing — is the app running with --mode emulator?");
      }
    }

    const matched = expect ? await waitForText(cdp, sessionId, expect, 25000) : true;

    if (screenshot) {
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
      await writeFile(screenshot, Buffer.from(data, "base64"));
    }

    const { result: title } = await cdp.send(
      "Runtime.evaluate",
      { expression: "document.title", returnByValue: true },
      sessionId,
    );

    return { ok: matched, matched, title: title.value, consoleErrors };
  } finally {
    cdp?.close();
    if (!keepOpen) child.kill();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) {
    console.error("Usage: node scripts/drive-app.mjs --url <url> [--screenshot f.png] [--sign-in email] [--expect text]");
    process.exit(2);
  }

  const result = await drive({
    url: args.url,
    screenshot: args.screenshot === true ? undefined : args.screenshot,
    signIn: args["sign-in"] === true ? undefined : args["sign-in"],
    expect: args.expect === true ? undefined : args.expect,
  });

  console.log(`title: ${result.title}`);
  if (args.expect) {
    console.log(result.matched ? `found expected text: "${args.expect}"` : `MISSING expected text: "${args.expect}"`);
  }
  console.log(
    result.consoleErrors.length === 0
      ? "console: no errors"
      : `console errors (${result.consoleErrors.length}):\n  ${result.consoleErrors.join("\n  ")}`,
  );
  if (!result.ok) process.exit(1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
