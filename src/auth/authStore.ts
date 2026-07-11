import { useEffect, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { firebaseConfigured, getFirebaseServices } from "../firebase/client";

export interface AuthUser {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
}

export type AuthState =
  | { status: "loading"; user: null; error: "" }
  | { status: "unconfigured"; user: null; error: string }
  | { status: "signed-out"; user: null; error: "" }
  | { status: "signed-in"; user: AuthUser; error: "" };

const UNCONFIGURED: AuthState = {
  status: "unconfigured",
  user: null,
  error: "Firebase is not configured. Add the Vite Firebase environment variables to enable Google sign-in.",
};

function toAuthUser(user: User): AuthUser {
  return {
    uid: user.uid,
    displayName: user.displayName ?? user.email ?? "Google user",
    email: user.email ?? "",
    photoURL: user.photoURL ?? "",
  };
}

export function authErrorMessage(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  if (code === "auth/popup-blocked") return "Google sign-in was blocked. Allow popups for this site and try again.";
  if (code === "auth/popup-closed-by-user") return "Google sign-in was closed before it completed.";
  if (code === "auth/operation-not-allowed" || code === "auth/configuration-not-found") {
    return "Google sign-in is not enabled for this Firebase project. Enable Authentication > Sign-in method > Google in Firebase Console.";
  }
  if (code === "auth/unauthorized-domain") {
    return "This domain is not authorized for Firebase Authentication. Add it under Authentication > Settings > Authorized domains.";
  }
  return error instanceof Error ? error.message : "Google sign-in failed. Try again.";
}

export function subscribeAuthState(onState: (state: AuthState) => void): () => void {
  const services = getFirebaseServices();
  if (!services) {
    onState(UNCONFIGURED);
    return () => {};
  }
  onState({ status: "loading", user: null, error: "" });
  return onAuthStateChanged(services.auth, (user) => {
    onState(user ? { status: "signed-in", user: toAuthUser(user), error: "" } : { status: "signed-out", user: null, error: "" });
  });
}

export function useAuthState(): AuthState {
  const [state, setState] = useState<AuthState>(
    firebaseConfigured() ? { status: "loading", user: null, error: "" } : UNCONFIGURED,
  );
  useEffect(() => subscribeAuthState(setState), []);
  return state;
}

export async function signInWithGoogle(): Promise<void> {
  const services = getFirebaseServices();
  if (!services) throw new Error(UNCONFIGURED.error);
  await signInWithPopup(services.auth, new GoogleAuthProvider());
}

export async function signOutUser(): Promise<void> {
  const services = getFirebaseServices();
  if (!services) return;
  await signOut(services.auth);
}
