import type { AuthState } from "../auth/authStore";
import { Button } from "./bits";

export function AuthGate({
  auth,
  notice,
  onSignIn,
}: {
  auth: AuthState;
  notice: string;
  onSignIn: () => void;
}) {
  const checking = auth.status === "loading";
  const unconfigured = auth.status === "unconfigured";

  return (
    <main className="app onboarding">
      <section className="home-hero tight onboard-wide auth-gate">
        <div className="onboard-intro">
          <div className="wordmark"><span className="wordmark-mark">M</span><span>Mizan</span></div>
          <h1>Sign in to continue</h1>
          <p>
            Mizan uses Google sign-in to identify the person accessing the household budget. Once signed in, you can
            create or join a household and sync its shared data.
          </p>
          {notice && <div className="notice" role={/failed|could not|error/i.test(notice) ? "alert" : "status"}>{notice}</div>}
        </div>
        <div className="auth-panel">
          <span className="soft-label">Authentication</span>
          <strong>{checking ? "Checking current session" : unconfigured ? "Firebase setup required" : "Google account required"}</strong>
          <p className="muted">
            Statement files and passwords are still parsed on this device. Household data sync starts only after a
            household is created or joined.
          </p>
          {unconfigured && <p className="muted">{auth.error}</p>}
          <Button variant="primary" disabled={checking || unconfigured} onClick={onSignIn}>
            {checking ? "Checking..." : unconfigured ? "Configure Firebase env vars" : "Sign in with Google"}
          </Button>
        </div>
      </section>
    </main>
  );
}
