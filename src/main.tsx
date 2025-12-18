import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// DEV-only fetch diagnostics for "String contains non ISO-8859-1 code point".
// Logs which header contains non-Latin1 characters (without leaking secrets).
if (import.meta.env.DEV && typeof window !== "undefined" && typeof window.fetch === "function") {
  const originalFetch = window.fetch.bind(window);

  const hasNonLatin1 = (value: string) => {
    for (let i = 0; i < value.length; i++) {
      if (value.charCodeAt(i) > 255) return true;
    }
    return false;
  };

  const redact = (name: string, value: string) => {
    const n = name.toLowerCase();
    if (n.includes("authorization") || n.includes("apikey") || n.includes("api-key")) {
      return value ? `${value.slice(0, 10)}…[redacted]` : value;
    }
    return value;
  };

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = init?.headers;
    if (headers) {
      const entries: Array<[string, string]> = [];
      if (headers instanceof Headers) {
        headers.forEach((v, k) => entries.push([k, v]));
      } else if (Array.isArray(headers)) {
        entries.push(...headers);
      } else {
        entries.push(...Object.entries(headers as Record<string, string>));
      }

      for (const [k, v] of entries) {
        if (typeof v === "string" && hasNonLatin1(v)) {
          // eslint-disable-next-line no-console
          console.warn("Non-Latin1 header detected:", { header: k, value: redact(k, v) });
        }
      }
    }

    return originalFetch(input, init);
  };
}

createRoot(document.getElementById("root")!).render(<App />);

