/**
 * Privacy-safe diagnostics sink.
 *
 * Mizan handles financial data, so diagnostics record only error *metadata* —
 * never transaction descriptions, amounts, account identifiers, imported
 * statement content, or any other user data. As a defensive second layer, error
 * messages are passed through a redactor that masks long digit runs (which could
 * encode amounts, account numbers, or dates) before anything is emitted.
 */

export interface DiagnosticEvent {
  scope: string;
  name: string;
  message: string;
  stack?: string;
}

const LONG_DIGIT_RUN = /\d{4,}/g;

/** Mask digit runs of four or more, which could encode sensitive values. */
export function redactDigits(text: string): string {
  return text.replace(LONG_DIGIT_RUN, "####");
}

export function toDiagnosticEvent(scope: string, error: unknown): DiagnosticEvent {
  if (error instanceof Error) {
    return {
      scope,
      name: error.name || "Error",
      message: redactDigits(error.message),
      // Stacks often embed the error message, so redact them too. This masks
      // some line/column numbers, but keeping sensitive digits out wins for a
      // finance app.
      stack: error.stack ? redactDigits(error.stack) : undefined,
    };
  }
  return { scope, name: "NonError", message: redactDigits(String(error)) };
}

/** Record an error's metadata. Safe to call from any environment. */
export function reportDiagnostic(scope: string, error: unknown): void {
  const event = toDiagnosticEvent(scope, error);
  if (import.meta.env.DEV) {
    console.error(`[mizan:${event.scope}] ${event.name}: ${event.message}`, event.stack ?? "");
    return;
  }
  console.error(`[mizan:${event.scope}] ${event.name}: ${event.message}`);
}
