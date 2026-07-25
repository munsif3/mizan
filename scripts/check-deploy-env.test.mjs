import { describe, expect, it } from "vitest";
import { checkDeployEnv, formatResult, REQUIRED_VARS } from "./check-deploy-env.mjs";

const validEnv = {
  VITE_FIREBASE_API_KEY: "api-key",
  VITE_FIREBASE_AUTH_DOMAIN: "mizan-the-balance.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "mizan-the-balance",
  VITE_FIREBASE_APP_ID: "1:976909179784:web:abc",
  VITE_FIREBASE_APPCHECK_SITE_KEY: "site-key",
};

describe("checkDeployEnv", () => {
  it("passes when every required variable is present and none are forbidden", () => {
    const result = checkDeployEnv({ ...validEnv });
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.forbidden).toEqual([]);
  });

  it("reports each missing required variable", () => {
    const result = checkDeployEnv({});
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(REQUIRED_VARS);
  });

  it("treats blank/whitespace values as missing", () => {
    const result = checkDeployEnv({ ...validEnv, VITE_FIREBASE_API_KEY: "   " });
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["VITE_FIREBASE_API_KEY"]);
  });

  it("rejects the App Check debug token in production", () => {
    const result = checkDeployEnv({ ...validEnv, VITE_FIREBASE_APPCHECK_DEBUG_TOKEN: "debug-token" });
    expect(result.ok).toBe(false);
    expect(result.forbidden).toEqual(["VITE_FIREBASE_APPCHECK_DEBUG_TOKEN"]);
  });

  it("never echoes variable values in its messages", () => {
    const secret = "super-secret-value";
    const result = checkDeployEnv({
      ...validEnv,
      VITE_FIREBASE_API_KEY: "",
      VITE_FIREBASE_APPCHECK_DEBUG_TOKEN: secret,
    });
    const output = formatResult(result).join("\n");
    expect(output).not.toContain(secret);
    expect(output).toContain("VITE_FIREBASE_APPCHECK_DEBUG_TOKEN");
    expect(output).toContain("VITE_FIREBASE_API_KEY");
  });
});
