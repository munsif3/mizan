import { describe, expect, it } from "vitest";
import { redactDigits, toDiagnosticEvent } from "./diagnostics";

describe("diagnostics", () => {
  it("masks long digit runs that could encode sensitive values", () => {
    expect(redactDigits("account 12345678 balance 4200.55")).toBe("account #### balance ####.55");
    expect(redactDigits("failed after 3 tries")).toBe("failed after 3 tries");
  });

  it("captures error metadata with a redacted message and stack", () => {
    const error = new TypeError("card 4111111111111111 declined");
    error.stack = "TypeError: card 4111111111111111 declined\n    at pay (pay.ts:12:3)";

    const event = toDiagnosticEvent("payment", error);

    expect(event.scope).toBe("payment");
    expect(event.name).toBe("TypeError");
    expect(event.message).toBe("card #### declined");
    expect(event.stack).toBe("TypeError: card #### declined\n    at pay (pay.ts:12:3)");
  });

  it("handles thrown non-Error values without leaking raw digits", () => {
    const event = toDiagnosticEvent("weird", "token 999999");

    expect(event.name).toBe("NonError");
    expect(event.message).toBe("token ####");
    expect(event.stack).toBeUndefined();
  });
});
