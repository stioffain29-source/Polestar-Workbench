import { useState, useEffect, type ReactNode } from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";

const STORAGE_KEY = "polestar_admin_token";

function getStoredToken(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    // ignore
  }
}

function clearStoredToken(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

type CheckResult = "ok" | "invalid" | "disabled" | "error";

// Validate a candidate token against the server's zero-cost auth-check route.
// The header is passed explicitly so we can verify a token BEFORE storing it.
async function validateToken(candidate: string): Promise<CheckResult> {
  try {
    const res = await fetch("/api/admin/check", {
      headers: { Authorization: `Bearer ${candidate}` },
    });
    if (res.ok) return "ok";
    if (res.status === 401) return "invalid";
    if (res.status === 503) return "disabled";
    return "error";
  } catch {
    return "error";
  }
}

type Status = "checking" | "needauth" | "authed";

export default function TokenGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(() =>
    getStoredToken() ? "checking" : "needauth",
  );
  const [input, setInput] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // On mount, register the token getter and verify any stored token. A stored
  // token that no longer matches the server is cleared so the operator is
  // returned to the login screen instead of a half-broken workbench where
  // every request 401s.
  useEffect(() => {
    setAuthTokenGetter(() => getStoredToken());
    const stored = getStoredToken();
    if (!stored) {
      setStatus("needauth");
      return;
    }
    let cancelled = false;
    void validateToken(stored).then((result) => {
      if (cancelled) return;
      if (result === "ok") {
        setStatus("authed");
        return;
      }
      if (result === "invalid") {
        clearStoredToken();
        setMessage("Your saved access token is no longer valid. Please sign in again.");
      } else if (result === "disabled") {
        setMessage("Workbench access is not configured on the server.");
      } else {
        setMessage("Could not reach the server. Check your connection and try again.");
      }
      setStatus("needauth");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) {
      setMessage("Token is required.");
      return;
    }
    setSubmitting(true);
    setMessage(null);
    const result = await validateToken(trimmed);
    setSubmitting(false);
    if (result === "ok") {
      storeToken(trimmed);
      setAuthTokenGetter(() => getStoredToken());
      setMessage(null);
      setStatus("authed");
      return;
    }
    if (result === "invalid") {
      setMessage("That token was not accepted.");
    } else if (result === "disabled") {
      setMessage("Workbench access is not configured on the server.");
    } else {
      setMessage("Could not reach the server. Check your connection and try again.");
    }
  }

  if (status === "authed") {
    return <>{children}</>;
  }

  if (status === "checking") {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#0B0B3D",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#9ca3af",
          fontFamily: "'Roboto Condensed', Roboto, sans-serif",
          fontSize: "0.8rem",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        Checking access…
      </div>
    );
  }

  const showError = message != null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0B0B3D",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Roboto Condensed', Roboto, sans-serif",
      }}
    >
      <div
        style={{
          background: "#303030",
          padding: "2.5rem 3rem",
          width: "100%",
          maxWidth: 400,
        }}
      >
        <div style={{ marginBottom: "1.75rem" }}>
          <div
            style={{
              fontSize: "0.65rem",
              letterSpacing: "0.15em",
              color: "#9ca3af",
              textTransform: "uppercase",
              marginBottom: "0.4rem",
            }}
          >
            Polestar Advisory
          </div>
          <div
            style={{
              fontSize: "1.25rem",
              fontWeight: 700,
              color: "#E2E2E2",
              letterSpacing: "0.02em",
            }}
          >
            Workbench Access
          </div>
        </div>
        <form onSubmit={handleSubmit}>
          <label
            style={{
              display: "block",
              fontSize: "0.7rem",
              letterSpacing: "0.1em",
              color: "#9ca3af",
              textTransform: "uppercase",
              marginBottom: "0.5rem",
            }}
          >
            Admin Token
          </label>
          <input
            type="password"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setMessage(null);
            }}
            autoFocus
            disabled={submitting}
            style={{
              width: "100%",
              background: "#0B0B3D",
              border: showError ? "1px solid #A33232" : "1px solid #4655FF",
              color: "#E2E2E2",
              padding: "0.6rem 0.75rem",
              fontSize: "0.9rem",
              fontFamily: "inherit",
              outline: "none",
              boxSizing: "border-box",
              marginBottom: "0.4rem",
            }}
            placeholder="Enter admin token"
          />
          {showError && (
            <div
              style={{
                color: "#A33232",
                fontSize: "0.75rem",
                marginBottom: "0.75rem",
              }}
            >
              {message}
            </div>
          )}
          <button
            type="submit"
            disabled={submitting}
            style={{
              marginTop: "1rem",
              width: "100%",
              background: "#4655FF",
              color: "#E2E2E2",
              border: "none",
              padding: "0.65rem 1rem",
              fontSize: "0.8rem",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              fontFamily: "inherit",
              fontWeight: 700,
              cursor: submitting ? "default" : "pointer",
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? "Verifying…" : "Access Workbench"}
          </button>
        </form>
      </div>
    </div>
  );
}
