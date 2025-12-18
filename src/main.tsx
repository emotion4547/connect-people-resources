import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// DEV-only diagnostics for "String contains non ISO-8859-1 code point".
// Identifies which header/value contains non-Latin1 characters (without leaking secrets).
if (import.meta.env.DEV && typeof window !== "undefined") {
  const hasNonLatin1 = (value: string) => {
    for (let i = 0; i < value.length; i++) {
      if (value.charCodeAt(i) > 255) return true;
    }
    return false;
  };

  const redact = (name: string, value: string) => {
    const n = name.toLowerCase();
    if (n.includes("authorization") || n.includes("apikey") || n.includes("api-key") || n.includes("token")) {
      return value ? `${value.slice(0, 10)}…[redacted]` : value;
    }
    return value.length > 180 ? `${value.slice(0, 180)}…` : value;
  };

  const emit = (header: string, value: string) => {
    if (!hasNonLatin1(value)) return;
    const detail = { header, value: redact(header, value) };
    // eslint-disable-next-line no-console
    console.warn("Non-Latin1 header detected:", detail);
    window.dispatchEvent(new CustomEvent("lovable-non-latin1-header", { detail }));
  };

  // Catch headers even when libraries create Request/Headers internally (before our fetch wrapper sees init.headers)
  if (typeof Headers !== "undefined") {
    const origAppend = Headers.prototype.append;
    const origSet = Headers.prototype.set;

    Headers.prototype.append = function (name: string, value: string) {
      try {
        emit(String(name), String(value));
      } catch {
        // ignore
      }
      return origAppend.call(this, name, value);
    };

    Headers.prototype.set = function (name: string, value: string) {
      try {
        emit(String(name), String(value));
      } catch {
        // ignore
      }
      return origSet.call(this, name, value);
    };
  }

  // Also keep a fetch wrapper to surface the original error message.
  if (typeof window.fetch === "function") {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        return await originalFetch(input, init);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        window.dispatchEvent(new CustomEvent("lovable-fetch-error", { detail: { message } }));
        throw err;
      }
    };
  }
}

createRoot(document.getElementById("root")!).render(<App />);

