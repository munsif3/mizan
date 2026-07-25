import { fileURLToPath } from "node:url";

/**
 * Build-time environment variables the production bundle needs in order to talk
 * to the real Firebase backend. Mirrors `firebaseConfigured()` in
 * src/firebase/client.ts.
 */
export const REQUIRED_VARS = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_APP_ID",
  "VITE_FIREBASE_APPCHECK_SITE_KEY",
];

/**
 * Variables that must never be present in a production build. The App Check
 * debug token bypasses attestation and is only ever meant for local dev.
 */
const FORBIDDEN_VARS = ["VITE_FIREBASE_APPCHECK_DEBUG_TOKEN"];

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === "";
}

export function checkDeployEnv(env) {
  const missing = REQUIRED_VARS.filter((name) => isBlank(env[name]));
  const forbidden = FORBIDDEN_VARS.filter((name) => !isBlank(env[name]));
  return { ok: missing.length === 0 && forbidden.length === 0, missing, forbidden };
}

/**
 * Human-readable problem lines. Deliberately reports variable *names* only,
 * never their values, so secrets are never echoed into CI logs.
 */
export function formatResult(result) {
  const lines = [];
  for (const name of result.missing) {
    lines.push(`Missing required build variable: ${name}`);
  }
  for (const name of result.forbidden) {
    lines.push(`Forbidden build variable must not be set in production: ${name}`);
  }
  return lines;
}

function main() {
  const result = checkDeployEnv(process.env);
  if (result.ok) {
    console.log("All required production build variables are present; no forbidden variables set.");
    return;
  }
  for (const line of formatResult(result)) {
    console.error(line);
  }
  process.exit(1);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
