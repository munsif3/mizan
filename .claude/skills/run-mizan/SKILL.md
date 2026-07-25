---
name: run-mizan
description: Launch Mizan in a real browser and drive it, including past Google sign-in via the Firebase Auth emulator. Use when asked to run, start, or screenshot the app, or to confirm a change works in the real app rather than only in tests.
---

# Running Mizan

Everything below was executed successfully on Windows 11 on 2026-07-26.
Do not substitute steps — the flags matter, and the failure modes are noted.

## Which mode do you need?

| Goal | Mode | Auth |
| --- | --- | --- |
| Check a screen renders, catch console/CSP errors | **unauthenticated** | none |
| Anything past the sign-in gate — cloud sync, households, transactions | **emulator** | fake Google identity |
| Confirm what production is serving | **production** | none |

The app gates *everything* behind Google sign-in. If the change you are
validating lives past that gate, you need emulator mode — an unauthenticated
screenshot will not exercise it.

## Unauthenticated: build, serve, screenshot

```bash
npm run build
npx vite preview --port 4173 --strictPort   # background
node scripts/drive-app.mjs --url http://localhost:4173 \
  --expect "Sign in to continue" --screenshot /tmp/signedout.png
```

Exit 0 with `found expected text` means it rendered. **Look at the screenshot** —
a blank frame is a failed launch even when the text check passes.

## Emulator: driving the app signed in

Two background processes, then the driver. Both must be up first.

```bash
npm run emulators      # background — auth :9099, firestore :8080, UI :4000
npm run dev:emulator   # background — vite on :5173, loads .env.emulator
```

Wait for both to answer before driving; they take a second or two:

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:9099/   # expect 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/   # expect 200
```

Then sign in and drive:

```bash
node scripts/drive-app.mjs --url http://localhost:5173 \
  --sign-in tester@example.com \
  --expect "Choose a Firestore household" \
  --screenshot /tmp/signedin.png
```

That lands on the household chooser with a real `google.com` provider identity,
which is what `hasVerifiedGoogleIdentity()` in `firestore.rules` requires.

**Sign-in needs a settle window.** Immediately after `--sign-in` the app shows
"Getting Mizan ready" while it queries Firestore. Always pass `--expect` with
text from the screen you actually want; the driver polls rendered text rather
than sleeping a fixed interval. Screenshotting without `--expect` will catch the
loading skeleton.

### How the fake sign-in works

`src/firebase/client.ts` exposes `globalThis.__mizanEmulatorSignIn(email)` when
— and only when — `import.meta.env.DEV` **and**
`VITE_FIREBASE_USE_EMULATORS=true`. It hands the Auth emulator an unsigned JSON
payload where a signed Google ID token would go, which the emulator accepts.
That is the only way to a genuine Google provider identity without driving an
interactive popup.

The guard is a **module-level `const`, not a function** — that detail is load
bearing. A production build substitutes `import.meta.env.DEV` with `false` and
folds the const, dropping the branch and its imports. Behind a function call the
bundler cannot prove the branch dead and **the sign-in hook ships to
production**; that was measured, not assumed. If you touch that guard, re-verify:

```bash
npm run build
grep -rc "__mizanEmulatorSignIn" dist/assets/   # must be 0
```

(`connectFirestoreEmulator` legitimately appears once in the firebase vendor
chunk — that is the SDK's own export, present on an unmodified checkout too.)

If the driver reports `__mizanEmulatorSignIn missing`, the app is not running
under `--mode emulator`.

## Production

```bash
node scripts/drive-app.mjs --url https://mizan-the-balance.web.app \
  --expect "Sign in to continue" --screenshot /tmp/prod.png
```

To prove production matches a commit, build locally at that commit and compare
screenshots — identical SHA-256 means identical render:

```bash
sha256sum /tmp/prod.png /tmp/local.png
```

## The driver

`scripts/drive-app.mjs` — no dependencies. Node 22's global `fetch` and
`WebSocket` are enough to speak Chrome DevTools Protocol, which is why there is
no Playwright here. It finds Chrome or Edge automatically; override with
`CHROME_PATH`.

| Flag | Purpose |
| --- | --- |
| `--url` | required |
| `--screenshot <path>` | PNG output |
| `--sign-in <email>` | emulator-mode fake Google sign-in |
| `--expect <text>` | poll rendered text, up to 25s; sets exit code |

Reports the page title, whether the expected text appeared, and any console
errors or uncaught exceptions.

## Known-benign noise

- **`Failed to execute 'open' on 'CacheStorage'`** from `sw.js` — headless
  Chrome with a throwaway profile. Production throws the identical error. Not a
  regression.
- **`AccountReconcilor`, `Certificate Error Assistant`, extension load errors** —
  Chrome internals, not the app.

## Gotchas that cost time

- **`--headless=new` writes no screenshot file** and exits 0. Use `--headless`.
  The driver already does.
- **An explicit `--user-data-dir` is required.** Without it Chrome may attach to
  your existing browser session ("Opening in existing browser session") and
  never screenshot. The driver generates a fresh profile per run.
- **`.env.emulator` is committed on purpose** and `.gitignore` has an explicit
  `!.env.emulator` exception. The `demo-` project prefix makes the emulator
  refuse to contact production, so a misconfigured run fails closed rather than
  touching `mizan-the-balance`.
- **Killing the npm parent does not reap its children.** This bites twice: the
  Firestore emulator's Java child keeps holding 8080, and vite's node child
  keeps holding 5173. Both then serve a **zombie that answers HTTP 200**, so a
  port check alone will tell you things are fine while you drive a stale
  server. `npm run dev:emulator` failing with `Port 5173 is already in use`
  while `curl localhost:5173` returns 200 is exactly this.

  Always reap by port, and confirm the port is free before restarting:

  ```powershell
  foreach ($p in 5173,8080,9099,4000,4400,4500) {
    Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue |
      ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
  }
  ```

  Confirm vite is really fresh by looking for the `emulator` mode badge in its
  startup banner, not by probing the port.

- **`npm run test:rules` cannot share the emulator suite** — it starts its own.
  Shut the interactive emulators down first.

## Not covered

Creating a household and importing transactions has not been driven end to end.
The chooser screen is as far as this recipe is verified. Extending past it means
clicking through `Create household` — the driver has no click helper yet.
