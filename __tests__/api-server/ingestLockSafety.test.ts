import { terminateAfterIngestLockLoss } from "../../artifacts/api-server/src/lib/ingestLockSafety";

describe("ingest advisory-lock loss", () => {
  it("terminates the process immediately so work cannot continue unfenced", () => {
    const logger = { error: jest.fn() };
    const exit = jest.fn((code: number): never => {
      throw new Error(`process exit ${code}`);
    });
    const connectionError = new Error("lock connection dropped");

    expect(() =>
      terminateAfterIngestLockLoss(connectionError, logger, exit),
    ).toThrow("process exit 1");

    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(
      { err: connectionError },
      expect.stringContaining("fence all remaining writes"),
    );
  });
});