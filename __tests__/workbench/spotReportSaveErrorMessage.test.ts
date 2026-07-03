import { spotReportSaveErrorMessage } from "@/lib/spotReport";

/** Minimal stand-in for the generated ApiError (status + parsed body). */
function apiError(status: number, error?: string): unknown {
  return { name: "ApiError", status, data: error ? { error } : null };
}

describe("spotReportSaveErrorMessage — actionable save-failure toasts", () => {
  it("maps 401 (and 403) to a session-expired message, not the admin token", () => {
    for (const status of [401, 403]) {
      const msg = spotReportSaveErrorMessage(apiError(status), "save");
      expect(msg.title).toBe("Session expired");
      expect(msg.description).toMatch(/sign in/i);
      // Spot reports use no admin token — never mention one.
      expect(`${msg.title} ${msg.description}`).not.toMatch(/token/i);
    }
  });

  it("maps 413 to an attachments-too-large hint", () => {
    const msg = spotReportSaveErrorMessage(apiError(413), "save");
    expect(msg.title).toBe("Attachments too large");
    expect(msg.description).toMatch(/photo/i);
  });

  it("maps 404 to a report-not-found hint", () => {
    const msg = spotReportSaveErrorMessage(apiError(404), "save");
    expect(msg.title).toBe("Report not found");
    expect(msg.description).toMatch(/deleted/i);
  });

  it("surfaces the server's own error message on 400", () => {
    const msg = spotReportSaveErrorMessage(
      apiError(400, "A photo is too large; please use a smaller image."),
      "save",
    );
    expect(msg.title).toBe("Check the report before saving");
    expect(msg.description).toBe("A photo is too large; please use a smaller image.");
  });

  it("falls back to a generic 400 hint when the server sends no message", () => {
    const msg = spotReportSaveErrorMessage(apiError(400), "save");
    expect(msg.title).toBe("Check the report before saving");
    expect(msg.description).toMatch(/invalid|required|photo/i);
  });

  it("uses an action-specific title for unknown/5xx failures", () => {
    expect(spotReportSaveErrorMessage(apiError(500), "create").title).toBe("Failed to create");
    expect(spotReportSaveErrorMessage(apiError(500), "save").title).toBe("Failed to save");
    expect(spotReportSaveErrorMessage(apiError(500), "delete").title).toBe("Failed to delete");
  });

  it("surfaces a server message on 5xx when present", () => {
    const msg = spotReportSaveErrorMessage(apiError(503, "Database unavailable"), "save");
    expect(msg.description).toBe("Database unavailable");
  });

  it("handles a null/undefined error and a bare Error without throwing", () => {
    expect(spotReportSaveErrorMessage(null, "save").title).toBe("Failed to save");
    expect(spotReportSaveErrorMessage(undefined, "create").title).toBe("Failed to create");
    expect(spotReportSaveErrorMessage(new Error("network down"), "save").title).toBe(
      "Failed to save",
    );
  });

  it("ignores a non-string server error field", () => {
    const msg = spotReportSaveErrorMessage({ status: 400, data: { error: 42 } }, "save");
    expect(msg.description).toMatch(/invalid|required|photo/i);
  });
});
