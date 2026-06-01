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

export default function TokenGate({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(getStoredToken);
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    setAuthTokenGetter(() => getStoredToken());
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) {
      setError(true);
      return;
    }
    storeToken(trimmed);
    setAuthTokenGetter(() => getStoredToken());
    setToken(trimmed);
    setError(false);
  }

  if (token) {
    return <>{children}</>;
  }

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
              setError(false);
            }}
            autoFocus
            style={{
              width: "100%",
              background: "#0B0B3D",
              border: error ? "1px solid #A33232" : "1px solid #4655FF",
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
          {error && (
            <div
              style={{
                color: "#A33232",
                fontSize: "0.75rem",
                marginBottom: "0.75rem",
              }}
            >
              Token is required.
            </div>
          )}
          <button
            type="submit"
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
              cursor: "pointer",
            }}
          >
            Access Workbench
          </button>
        </form>
      </div>
    </div>
  );
}
