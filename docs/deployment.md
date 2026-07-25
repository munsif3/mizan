# Deployment

Mizan deploys to Firebase project **`mizan-the-balance`** (Hosting +
Firestore rules) automatically whenever CI passes on `main`. There are no manual
`firebase deploy` steps and no PR preview channels — previews would hit the
production Firebase backend, so they are deliberately omitted.

## The CI/CD contract

The single workflow [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
has two jobs:

| Trigger | `check` job | `deploy` job |
| --- | --- | --- |
| Pull request | runs | skipped |
| Push to a non-`main` branch | runs | skipped |
| Push to `main` | runs | runs after `check` succeeds |
| `workflow_dispatch` from `main` | runs | runs after `check` succeeds |

The `deploy` job:

1. **Skips stale commits** — if `main` has already advanced past the commit that
   triggered the run, the deploy is skipped so an older tree is never published
   on top of a newer one.
2. **Serializes releases** via a `production-deploy` concurrency group with
   `cancel-in-progress: false`, so an in-flight Firebase deploy is never killed.
3. Installs locked dependencies (`npm ci`), **validates required build
   variables** (`npm run check:deploy-env`), runs the **production build**,
   authenticates through **OIDC / Workload Identity Federation**, and runs the
   locked Firebase CLI:
   `firebase deploy --only firestore:rules,hosting --project mizan-the-balance --non-interactive`.
4. **Verifies the live release** byte-for-byte (`npm run verify:production`).

A failed `check`, missing configuration, auth error, stale commit, Firebase
error, or live-content mismatch all fail the run. **A red run is never a
release** — verification failure does *not* auto-roll-back; it preserves
evidence for an intentional decision (see [Rollback](#rollback)).

## GitHub `production` environment

Create a repository environment named **`production`**, restricted to the
`main` branch, with **no required reviewers** (deployment is automatic). The
environment records deployment history and scopes the variables below.

Store these as environment **variables** (not secrets — none of these values are
secret; the `VITE_FIREBASE_*` values are public client config that already ships
in the bundle, and the WIF identifiers are non-sensitive):

| Variable | Value |
| --- | --- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/976909179784/locations/global/workloadIdentityPools/github-actions/providers/mizan` |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | `mizan-github-deployer@mizan-the-balance.iam.gserviceaccount.com` |
| `VITE_FIREBASE_API_KEY` | from `.env.local` |
| `VITE_FIREBASE_AUTH_DOMAIN` | from `.env.local` |
| `VITE_FIREBASE_PROJECT_ID` | `mizan-the-balance` |
| `VITE_FIREBASE_APP_ID` | from `.env.local` |
| `VITE_FIREBASE_APPCHECK_SITE_KEY` | from `.env.local` |

> **Never** set `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN` in CI. It bypasses App
> Check attestation and is local-dev-only. `check:deploy-env` fails the build if
> it is ever present.

## Keyless IAM setup (one-time, project-owner access)

Uses [Workload Identity Federation](https://github.com/google-github-actions/auth)
so no service-account JSON key is ever created or stored.

Project number `976909179784`, repository ID `1294534848`, owner ID `21264671`.

```bash
PROJECT=mizan-the-balance
PROJECT_NUMBER=976909179784
SA=mizan-github-deployer@${PROJECT}.iam.gserviceaccount.com

# 0. Authenticate as a project Owner and enable the APIs the OIDC exchange needs.
#    (Manual `firebase deploy` never uses STS or SA impersonation, so these two
#    APIs may still be disabled even though Hosting/rules deploys work today.)
gcloud auth login
gcloud config set project "$PROJECT"
gcloud services enable \
  iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  --project="$PROJECT"

# 1. Deployer service account
gcloud iam service-accounts create mizan-github-deployer \
  --project="$PROJECT" --display-name="GitHub Actions deployer"

# 2. Least-privilege roles for Hosting + Firestore rules
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA" --role="roles/firebasehosting.admin"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA" --role="roles/firebaserules.admin"

# 3. Workload Identity pool + provider, trusting ONLY this repo on main
gcloud iam workload-identity-pools create github-actions \
  --project="$PROJECT" --location=global --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc mizan \
  --project="$PROJECT" --location=global \
  --workload-identity-pool=github-actions \
  --display-name="Mizan repo, main only" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository_id=='1294534848' && assertion.repository_owner_id=='21264671' && assertion.ref=='refs/heads/main'"

# 4. Let that federated identity impersonate the deployer SA
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --project="$PROJECT" --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-actions/attribute.repository_id/1294534848"
```

> **Note on roles.** `firebasehosting.admin` + `firebaserules.admin` are the
> minimum for this deploy. The original plan listed
> `roles/serviceusage.apiKeysViewer`; that grants reading API keys, which this
> pipeline never does, so it is omitted. If the first deploy fails with a
> `serviceusage.services.use` permission error, grant
> `roles/serviceusage.serviceUsageConsumer` (not `apiKeysViewer`) and retry.

## Manual rerun

From the GitHub **Actions** tab, open the CI workflow and choose **Run
workflow** on the `main` branch (`workflow_dispatch`). This re-runs `check` and,
if green, performs exactly one production deploy through the same path. The
stale-commit guard still applies: if `main` has advanced, the run no-ops.

## Rollback

Deployment failures are **not** rolled back automatically — a red run leaves the
previous release live and preserves the failed run's logs and the
`verify:production` diff as evidence. To intentionally roll back Firebase
Hosting to a prior release:

```bash
# List recent Hosting releases and their versions
firebase hosting:releases:list --project mizan-the-balance

# Roll back to the immediately previous release
firebase hosting:rollback --project mizan-the-balance
```

Firestore rules are versioned in Git; to revert them, revert the offending
commit on `main` and let CI redeploy, or run
`firebase deploy --only firestore:rules --project mizan-the-balance` from a known
-good checkout.

## Verification scripts

- `npm run check:deploy-env` — fails if any required `VITE_FIREBASE_*` variable
  is missing or if the forbidden App Check debug token is set. Reports variable
  **names** only, never values.
- `npm run verify:production` — retries briefly for Hosting propagation, then
  compares every local `dist` file byte-for-byte against production (requesting
  `identity` encoding so compression can't corrupt the comparison), explicitly
  checks `index.html`, `manifest.webmanifest`, and `sw.js`, and asserts the CSP
  and security headers configured in [`firebase.json`](../firebase.json). On any
  mismatch it fails the run and prints the offending path and status. Override
  the target with `PRODUCTION_BASE_URL`.
