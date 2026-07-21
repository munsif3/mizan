import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportDiagnostic } from "./diagnostics";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional replacement for the built-in fallback screen. */
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Catches render-time errors anywhere below it so a single component fault shows
 * a recoverable screen instead of a blank page. Faults are reported through the
 * privacy-safe diagnostics sink — no user data leaves the boundary.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    reportDiagnostic("render", error);
    // The component stack points at the failing subtree without exposing data.
    if (import.meta.env.DEV && info.componentStack) console.error(info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;

    return (
      <div
        role="alert"
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--ql-space-4)",
          padding: "var(--ql-space-8)",
          textAlign: "center",
          background: "var(--ql-canvas)",
          color: "var(--ql-text)",
        }}
      >
        <div style={{ maxWidth: "34rem", display: "flex", flexDirection: "column", gap: "var(--ql-space-3)" }}>
          <h1 style={{ fontSize: "1.25rem", margin: 0 }}>Something went wrong</h1>
          <p style={{ margin: 0, color: "var(--ql-muted)" }}>
            Mizan hit an unexpected error while rendering this screen. Your data is stored safely in the
            cloud and was not affected. Reloading usually clears the problem.
          </p>
        </div>
        <button
          type="button"
          onClick={this.handleReload}
          style={{
            minHeight: "44px",
            padding: "0 var(--ql-space-6)",
            borderRadius: "var(--ql-radius-control)",
            border: "1px solid transparent",
            background: "var(--ql-brand)",
            color: "var(--ql-on-brand)",
            fontSize: "1rem",
            cursor: "pointer",
          }}
        >
          Reload Mizan
        </button>
      </div>
    );
  }
}
