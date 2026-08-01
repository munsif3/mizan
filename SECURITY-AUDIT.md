# Security Audit — 2026-07-30

Full-app security audit ahead of a possible public launch. Supersedes the
diff-scoped `/security-review` run the same day, which only covered the
`schemaVersion` 10 → 11 bump and found nothing.

**Verdict: no exploitable vulnerabilities found in application code.** The
remaining risk is Firebase Console configuration, which cannot be verified
from the repository. Nothing below is a known-exploitable bug; the open items
are unverified settings and product decisions.

---

## Blocking items before public launch

Console settings that code cannot prove. Each was unverifiable from this repo.

- [ ] **App Check is *enforced* for Firestore.** `src/firebase/client.ts:123`
      initializes reCAPTCHA Enterprise attestation, but enforcement is a
      server-side toggle. If Firestore is still "unenforced," the client-side
      init is decorative and the API is reachable directly with any valid ID
      token. → Console → App Check → Firestore → Enforce.
- [ ] **Deployed rules match `firestore.rules` in this repo.** Every rules
      finding below is void if production runs an older ruleset. Note the v11
      bump was still uncommitted/undeployed at audit time.
      → Console → Firestore → Rules.
- [ ] **Authorized domains contain only the real domain + localhost.**
      Stale entries are a phishing surface. → Auth → Settings → Authorized domains.
- [ ] **Google is the only enabled sign-in provider.** An enabled
      Email/Password or Anonymous provider bypasses `hasVerifiedGoogleIdentity()`
      in `firestore.rules:140`, which requires a `google.com` identity with
      `email_verified == true`. → Auth → Sign-in method.
- [ ] **Browser API key has an HTTP-referrer restriction.**
      → Google Cloud Console → Credentials.

## Product decisions to settle (not bugs)

- **Every household member can read and write all household financial data.**
  Owner vs. member differs only for meta updates, deletion, and link
  management. Correct for a family; reconsider if strangers can be invited.
- **Invite codes never expire and are not single-use.** 64 bits of
  `crypto.randomUUID` entropy (`src/household/households.ts:24`), so they are
  not guessable, but anyone who ever sees one can join silently until rotated.
  The `joinRequests` collection is already the natural hook for owner approval.
- **Storing financial PII for the public** brings privacy-policy and
  data-deletion obligations independent of security.

---

## Verified clean

| Area | Finding |
|---|---|
| XSS sinks | None. No `innerHTML`, `dangerouslySetInnerHTML`, `eval`, `new Function` in production code |
| CSP | Strict — no `unsafe-inline` on `script-src`, `object-src 'none'`, `frame-ancestors 'none'` (`firebase.json`) |
| Security headers | HSTS, `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy |
| Dependencies | `npm audit --omit=dev` → 0 vulnerabilities |
| Network surface | No `fetch`/XHR anywhere in `src/`. Firebase SDK only. FX rates are user-entered, not fetched |
| Backup crypto | AES-256-GCM + PBKDF2-SHA-256 @ 600k iterations, random salt/IV, AAD-bound, 12-char password floor (`src/storage/backup.ts`) |
| Secrets | No API-key literals in tracked files; `.env*` gitignored except example/emulator |
| CSV injection | Not applicable — no CSV export path exists |
| Statement parsing | `src/import/ntbAmexHtml.ts` extracts JSON by string scanning; never DOM-evaluated |
| CI | `permissions: contents: read`, no secrets in workflow |

### Firestore rules strengths worth preserving

- Deny-by-default catch-all (`firestore.rules:329`)
- `allow list: if false` on meta — no household enumeration
- Identity bound to the verified token, not client-supplied fields
  (`firestore.rules:147`) — a member cannot forge another's name or email on join
- Exact `hasOnly` key allowlists plus `updatedBy == request.auth.uid` author binding
- Compare-and-swap on the snapshot manifest via `getAfter` version tokens

### Load-bearing detail — do not "clean up"

`src/firebase/client.ts:88` exposes `__mizanEmulatorSignIn` on `globalThis`,
which is a full auth bypass if it ever ships. It is correctly stripped from
`dist/` (verified by grep). This depends on `USING_EMULATORS` being a
**module-level `const`** so the bundler can fold it to `false` and drop the
branch. Behind a function call the bundler cannot prove the branch is dead and
the hook ships to production. The existing comment explains this — keep it.

### Non-findings, recorded so they aren't re-raised

- `src/import/ntbCrypto.ts` uses PBKDF2-SHA1 / 15k iterations / AES-128-CBC.
  Weak by modern standards, but those parameters are dictated by the bank's own
  statement format. It decrypts a file the user already holds; it does not
  protect Mizan data.
- The Firebase web API key is present in the built bundle. This is normal and
  expected for Firebase web apps; it is an identifier, not a secret.

---

## Method / coverage

Read in full: `firestore.rules`, `src/firebase/client.ts`, `src/auth/authStore.ts`,
`src/storage/backup.ts`, `src/security/resourceLimits.ts`, `src/import/ntbCrypto.ts`,
`firebase.json`, `.gitignore`, `.github/workflows/ci.yml`. Grepped all 153
`src/**/*.{ts,tsx}` files for XSS sinks, network calls, crypto usage, and
secret literals. Ran `npm audit`. Inspected `dist/` for the emulator hook.

**Not covered:** UI component logic beyond sink grepping, `src/domain` business
logic, and anything requiring Firebase Console access.
