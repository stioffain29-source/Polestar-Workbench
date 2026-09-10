import { convergeMaritimeSemantic } from "../../artifacts/api-server/src/lib/maritimeSemanticConvergence";

describe("maritime semantic convergence coordination", () => {
  it("coalesces overlapping in-process runs", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const backfill = async () => {
      calls++;
      await gate;
      return { considered: 1, updated: 1 };
    };

    const first = convergeMaritimeSemantic(1, 1, backfill);
    // Let the first invocation enter its provider/backfill call before
    // requesting a second invocation.
    await new Promise((resolve) => setImmediate(resolve));
    const second = convergeMaritimeSemantic(1, 1, backfill);
    release();

    const [one, two] = await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(one).toEqual(two);
    expect(one.updated).toBe(1);
  });
});