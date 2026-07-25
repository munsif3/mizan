# Plan — isolated GitHub → Firebase deployment branch

**Status:** not started. Draft implementation exists as uncommitted work on
`refactor/decompose-session-sync`; nothing has been branched, pushed, or deployed.
**Written:** 2026-07-25.
**Working file — do not transplant this document to the deploy branch.** It is a
rollout plan, not product documentation. The shipped doc is
[`docs/deployment.md`](../deployment.md).

---

## INPUTS (frozen — do not re-decide)

- Firebase project `mizan-the-balance`; Hosting + Firestore rules.
- Deploy automatically after green CI on `main`. No PR preview channels
  (previews would hit the production backend).
- Branch `ci/github-firebase-deploy`, cut from `origin/main`, built in a
  **separate git worktree** so `refactor/decompose-session-sync` and its
  uncommitted work stay untouched.
- A failed verification is **never** auto-rolled-back. Red run, evidence
  preserved, rollback is an intentional human decision.

## Where the draft currently lives

Uncommitted / untracked on `refactor/decompose-session-sync`:

| File | State |
| --- | --- |
| `.github/workflows/ci.yml` | modified — `deploy` job appended |
| `package.json` | modified — 2 new scripts |
| `scripts/check-deploy-env.mjs` + `.test.mjs` | untracked |
| `scripts/verify-production.mjs` + `.test.mjs` | untracked |
| `docs/deployment.md` | untracked |

---

## PRECONDITIONS (human-executed, outside this repo)

Commands are already written out in
[`docs/deployment.md`](../deployment.md) under "Keyless IAM setup". They are
**not** part of the code change. Run them separately; verify each.

| Step | Verify with |
| --- | --- |
| Enable `iam`, `iamcredentials`, `sts` APIs | `gcloud services list --enabled \| grep -E 'iamcredentials\|sts'` |
| Create `mizan-github-deployer` SA | `gcloud iam service-accounts describe $SA` |
| Grant `firebasehosting.admin` + `firebaserules.admin` | `gcloud projects get-iam-policy $PROJECT --flatten=bindings --filter="bindings.members:$SA"` |
| Create WIF pool `github-actions` + provider `mizan` | `gcloud iam workload-identity-pools providers describe mizan --location=global --workload-identity-pool=github-actions` |
| Bind `roles/iam.workloadIdentityUser` to the federated principal | `gcloud iam service-accounts get-iam-policy $SA` |
| GitHub environment `production` — main-only, **no** required reviewers, 7 variables | GitHub → Settings → Environments |

The 7 environment variables are listed in
[`docs/deployment.md`](../deployment.md#github-production-environment).
`VITE_FIREBASE_APPCHECK_DEBUG_TOKEN` must **never** be set there;
`check:deploy-env` fails the build if it is.

---

## STEPS (each with an exit check)

### 1. Create the worktree

```bash
git fetch origin
git worktree add <scratch>/deploy-ci -b ci/github-firebase-deploy origin/main
```

**Exit:** `git status --short` in the original tree is byte-identical to before.

### 2. Transplant whole files

`scripts/check-deploy-env.mjs`, `scripts/verify-production.mjs`, both
`.test.mjs` files, `docs/deployment.md`.

**Exit:** `git status --short` in the worktree shows exactly 5 new files.

### 3. Transplant partially — the risky step

Both modified files carry unrelated changes and must **not** be copied wholesale.

- `.github/workflows/ci.yml` — append only the `deploy` job to `origin/main`'s version.
- `package.json` — add only `check:deploy-env` and `verify:production`.

**Exit:** `git diff origin/main -- package.json` shows exactly +2 lines;
`git diff origin/main -- .github/workflows/ci.yml` shows no change to the
`check` job.

### 4. Apply the three corrections that survived review

1. `.gitignore` += `gha-creds-*.json` — `google-github-actions/auth` writes this
   credential file into the workspace.
2. `docs/deployment.md` — the line reading "…stale commit… **fail the run**"
   contradicts the workflow, which skips *successfully*. Rewrite as a green no-op.
3. `docs/deployment.md` "Rollback" — replace both fabricated CLI commands
   (see Verified findings below) with the Firebase Console procedure:
   **Hosting → release history → ⋮ → Rollback**. Keep the Firestore-rules-revert
   paragraph; that part is accurate.

### 5. Local gates

`npm ci` · `npm run check` · `npm run check:deadcode` · the two new test files ·
`git diff --check` · YAML parse of the workflow.

Watch `check:deadcode`: `knip.json` only ignores `public/sw.js`, so the new
`scripts/*.mjs` may be flagged. (`scripts/style-system.test.mjs` already exists
un-ignored, so it will probably pass — confirm, don't assume.)

**Exit:** all green.

### 6. Push and open the PR

**Exit:** PR CI runs `check` including the Firestore emulator suite, and the
`deploy` job shows as skipped.

---

## UNVERIFIED — resolve before merging, do not guess

- **`google-github-actions/auth` version.** The draft pins `@v2`, which is
  known-good. An earlier plan proposed `@v3`; that was never confirmed to exist.
  Check the action's releases page. If v3 is real and stable, bump — otherwise
  v2 stands.
- **Whether `firebasehosting.admin` + `firebaserules.admin` suffice.** The
  draft's reasoning is sound but untested against a real deploy. If the first
  deploy fails on `serviceusage.services.use`, grant
  `roles/serviceusage.serviceUsageConsumer` — **not** `apiKeysViewer`.

## GATE

**Do not merge until every PRECONDITIONS row is verified.** The branch may be
pushed and reviewed before then.

---

## Post-merge verification

- Exactly one deploy runs, at the merge SHA.
- OIDC exchange succeeds with short-lived credentials (no SA JSON key anywhere).
- Hosting + Firestore rules deploy cleanly.
- `verify:production` passes: every `dist` file byte-for-byte, `index.html` /
  `manifest.webmanifest` / `sw.js` present, and all six security headers from
  `firebase.json` served as configured.
- The GitHub deployment record points at `https://mizan-the-balance.web.app`.

---

## Verified findings (2026-07-25) — evidence, so this isn't re-litigated

**Confirmed bug in the draft docs.** `firebase hosting:rollback` and
`firebase hosting:releases:list` **do not exist**. Running each against the
locked CLI (`firebase-tools ^15.24.0`) prints root help rather than subcommand
help. `firebase hosting --help` lists only `hosting:clone`, `hosting:disable`,
`hosting:channel`, `hosting:sites`. Console rollback is genuinely the only path.
→ Fixed by step 4.3.

**Rejected: adding `roles/serviceusage.apiKeysViewer`.** An earlier plan listed
it as required. `docs/deployment.md` already considered it, rejected it with
reasoning (the pipeline never reads API keys), and named `serviceUsageConsumer`
as the correct fallback. Re-adding it would undo a decision the draft got right.

**Rejected: bumping `auth@v2` → `@v3` unverified.** See UNVERIFIED above.

**Resolved non-issues.**
- `public/` contains `sw.js` and `manifest.webmanifest`, so Vite copies them to
  `dist/` and `verify-production`'s hard requirement on those files is satisfied.
- `firebase-tools` is a devDependency, so `npx --no-install firebase` works
  after `npm ci`.
- `.firebaserc` is gitignored, but the workflow passes `--project` explicitly,
  so CI does not need it.

## Assumptions

- The `refactor/decompose-session-sync` worktree keeps its duplicated
  uncommitted deployment files. Cleaning them up is a separate, later decision.
- If `main` advances before merge, rebase so the PR diff stays deployment-only.
