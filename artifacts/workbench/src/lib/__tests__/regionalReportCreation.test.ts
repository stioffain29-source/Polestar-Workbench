import {
  regionalRebuildInput,
  regionalRefreshDisabled,
} from "../regionalReportCreation";

describe("regional rebuild client", () => {
  it("reuses the durable request identity for submission retry", () => {
    const originalWindow = globalThis.window;
    const originalCrypto = globalThis.crypto;
    const replaceState = (_state: unknown, _unused: string, next: string) => {
      fakeWindow.location.href = `https://example.test${next}`;
    };
    const fakeWindow = {
      location: { href: "https://example.test/reports/42" },
      history: { state: null, replaceState },
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: fakeWindow,
    });
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { randomUUID: () => "0f4cb980-3037-4c0d-b8e0-757e13d42b2a" },
    });
    try {
      const first = regionalRebuildInput(
        "apac_weekly",
        "2026-09-18",
        42,
        "2026-09-18T10:00:00.000Z",
      );
      const retry = regionalRebuildInput(
        "apac_weekly",
        "2026-09-18",
        42,
        "2026-09-18T10:00:00.000Z",
      );
      expect(retry).toEqual(first);
      expect(retry.targetReportId).toBe(42);
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: originalCrypto,
      });
    }
  });

  it("keeps refresh disabled for dirty editor state", () => {
    expect(regionalRefreshDisabled({
      hasUpdatedAt: true,
      hasUnsavedEdits: true,
    })).toBe(true);
    expect(regionalRefreshDisabled({
      hasUpdatedAt: true,
      hasUnsavedEdits: false,
      status: "running",
    })).toBe(true);
    expect(regionalRefreshDisabled({
      hasUpdatedAt: true,
      hasUnsavedEdits: false,
      status: "failed",
    })).toBe(false);
  });
});