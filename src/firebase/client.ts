import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from "firebase/app-check";
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
  type Auth,
} from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";

export interface FirebaseServices {
  app: FirebaseApp;
  /** Null only when running against the emulator suite, which has no App Check. */
  appCheck: AppCheck | null;
  auth: Auth;
  db: Firestore;
}

const EMULATOR_HOST = "127.0.0.1";
const AUTH_EMULATOR_PORT = 9099;
const FIRESTORE_EMULATOR_PORT = 8080;

/**
 * True only for `vite --mode emulator`.
 *
 * Deliberately a module-level const rather than a function: a production build
 * substitutes `import.meta.env.DEV` with `false`, folds this to `false`, and
 * then drops every `if (USING_EMULATORS)` branch along with the emulator-only
 * imports they reach. Behind a function call the bundler cannot prove the
 * branch is dead, and the sign-in hook ships to production.
 */
const USING_EMULATORS =
  import.meta.env.DEV && import.meta.env.VITE_FIREBASE_USE_EMULATORS === "true";

let cachedServices: FirebaseServices | null = null;

function firebaseConfig() {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    appCheckSiteKey: import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY,
  };
}

function configureAppCheckDebugToken(): void {
  if (!import.meta.env.DEV) return;
  const configuredToken = import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN;
  if (!configuredToken) return;
  const debugGlobal = globalThis as typeof globalThis & {
    FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string;
  };
  debugGlobal.FIREBASE_APPCHECK_DEBUG_TOKEN = configuredToken === "true" ? true : configuredToken;
}

function initializeFirebaseAppCheck(app: FirebaseApp, siteKey: string): AppCheck {
  configureAppCheckDebugToken();
  return initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export function firebaseConfigured(): boolean {
  const config = firebaseConfig();
  return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId && config.appCheckSiteKey);
}

/**
 * Headless sign-in hook, emulator only.
 *
 * The Auth emulator accepts an unsigned JSON payload where a real Google ID
 * token would go. That is the only way to reach a genuine `google.com` provider
 * identity — the one `hasVerifiedGoogleIdentity()` in firestore.rules checks —
 * without driving an interactive popup. Exposed on `globalThis` so an
 * out-of-process browser driver can call it.
 */
function exposeEmulatorSignIn(auth: Auth): void {
  const target = globalThis as typeof globalThis & {
    __mizanEmulatorSignIn?: (email: string, sub?: string) => Promise<void>;
  };
  target.__mizanEmulatorSignIn = async (email, sub = email) => {
    const credential = GoogleAuthProvider.credential(
      JSON.stringify({ sub, email, email_verified: true }),
    );
    await signInWithCredential(auth, credential);
  };
}

function connectToEmulators(auth: Auth, db: Firestore): void {
  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${AUTH_EMULATOR_PORT}`, {
    disableWarnings: true,
  });
  connectFirestoreEmulator(db, EMULATOR_HOST, FIRESTORE_EMULATOR_PORT);
  exposeEmulatorSignIn(auth);
}

export function getFirebaseServices(): FirebaseServices | null {
  if (!firebaseConfigured()) return null;
  if (cachedServices) return cachedServices;
  const config = firebaseConfig();
  const app = getApps().length ? getApp() : initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);

  // App Check cannot attest a demo project, so the emulator path skips it.
  let appCheck: AppCheck | null = null;
  if (USING_EMULATORS) {
    connectToEmulators(auth, db);
  } else {
    appCheck = initializeFirebaseAppCheck(app, config.appCheckSiteKey);
  }

  cachedServices = { app, appCheck, auth, db };
  return cachedServices;
}
