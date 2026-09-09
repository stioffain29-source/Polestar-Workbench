jest.mock("../../artifacts/api-server/src/lib/logger", () => ({
  logger: { info: jest.fn(), error: jest.fn() },
}));

import { convergeFlashpointValidity } from "../../artifacts/api-server/src/lib/flashpointValidityConvergence";

describe("Flashpoint semantic convergence", () => {
  it("runs sequential bounded batches until no stale rows remain", async () => {
    const backfill = jest.fn()
      .mockResolvedValueOnce({ considered: 20, updated: 20 })
      .mockResolvedValueOnce({ considered: 7, updated: 7 });

    await expect(convergeFlashpointValidity(100, 20, backfill)).resolves.toEqual({
      considered: 27,
      updated: 27,
      batches: 2,
      complete: true,
    });
    expect(backfill).toHaveBeenNthCalledWith(1, 20);
    expect(backfill).toHaveBeenNthCalledWith(2, 20);
  });

  it("stops at the per-boot row ceiling", async () => {
    const backfill = jest.fn(async (limit: number) => ({
      considered: limit,
      updated: limit,
    }));

    await expect(convergeFlashpointValidity(45, 20, backfill)).resolves.toEqual({
      considered: 45,
      updated: 45,
      batches: 3,
      complete: false,
    });
    expect(backfill).toHaveBeenNthCalledWith(3, 5);
  });
});