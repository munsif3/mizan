import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./platform/ErrorBoundary";
import { reportDiagnostic } from "./platform/diagnostics";
import "./styles/index.css";

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      // Offline support is best-effort; financial data is stored in Firestore.
      // Surface the failure through diagnostics instead of swallowing it.
      reportDiagnostic("service-worker", error);
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
