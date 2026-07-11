import { describe, expect, it } from "vitest";
import { authErrorMessage } from "./authStore";

describe("auth error messages", () => {
  it("turns popup-specific Firebase failures into recoverable user messages", () => {
    expect(authErrorMessage({ code: "auth/popup-blocked" })).toContain("Allow popups");
    expect(authErrorMessage({ code: "auth/popup-closed-by-user" })).toContain("closed");
  });

  it("explains Firebase project setup failures", () => {
    expect(authErrorMessage({ code: "auth/operation-not-allowed" })).toContain("Google sign-in is not enabled");
    expect(authErrorMessage({ code: "auth/configuration-not-found" })).toContain("Google sign-in is not enabled");
    expect(authErrorMessage({ code: "auth/unauthorized-domain" })).toContain("not authorized");
  });

  it("falls back to normal error text", () => {
    expect(authErrorMessage(new Error("network unavailable"))).toBe("network unavailable");
  });
});
