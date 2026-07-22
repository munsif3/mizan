import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from "firebase/app-check";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

export interface FirebaseServices {
  app: FirebaseApp;
  appCheck: AppCheck;
  auth: Auth;
  db: Firestore;
}

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

export function getFirebaseServices(): FirebaseServices | null {
  if (!firebaseConfigured()) return null;
  if (cachedServices) return cachedServices;
  const config = firebaseConfig();
  const app = getApps().length ? getApp() : initializeApp(config);
  const appCheck = initializeFirebaseAppCheck(app, config.appCheckSiteKey);
  cachedServices = { app, appCheck, auth: getAuth(app), db: getFirestore(app) };
  return cachedServices;
}
