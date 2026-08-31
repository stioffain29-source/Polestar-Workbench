import { fencePriorIngestSessions } from "../../artifacts/api-server/src/lib/ingestSessionFence";

describe("ingest database-session handover fence", () => {
  it("does not return until every prior worker session is terminated and gone", async () => {
    const waits: number[] = [];
    const query = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            fence_table: true,
            fence_function: true,
            missing_tables: [],
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            application_name: "polestar-ingest:new-run",
            backend_pid: "301",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { pid: 101, terminated: true },
          { pid: 102, terminated: true },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ count: "2" }] })
      .mockResolvedValueOnce({ rows: [{ count: "1" }] })
      .mockResolvedValueOnce({ rows: [{ count: "0" }] });

    const fenced = fencePriorIngestSessions(
      { query },
      async (ms) => {
        waits.push(ms);
      },
    );

    await expect(fenced).resolves.toBe(2);
    expect(waits).toEqual([50, 50]);
    expect(query).toHaveBeenCalledTimes(7);
    expect(query.mock.calls[2]?.[1]).toEqual(["new-run"]);
    expect(query.mock.calls[3]?.[1]).toEqual([
      "polestar-ingest:%",
      "polestar-ingest:new-run",
    ]);
  });

  it("makes an ordinary API-process holder drain prior worker sessions too", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            fence_table: true,
            fence_function: true,
            missing_tables: [],
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            application_name: "polestar-app:v2:400",
            backend_pid: "401",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ pid: 201, terminated: true }],
      })
      .mockResolvedValueOnce({ rows: [{ count: "1" }] })
      .mockResolvedValueOnce({ rows: [{ count: "0" }] });
    const waits: number[] = [];

    await expect(
      fencePriorIngestSessions({ query }, async (ms) => {
        waits.push(ms);
      }),
    ).resolves.toBe(1);

    expect(waits).toEqual([50]);
    expect(query.mock.calls[2]?.[1]).toEqual(["api:401"]);
    expect(query.mock.calls[3]?.[1]).toEqual([
      "polestar-ingest:%",
      "polestar-app:v2:400",
    ]);
  });

  it("fails closed before ownership advances when any table lacks the trigger", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          fence_table: true,
          fence_function: true,
          missing_tables: ["public.incidents"],
        },
      ],
    });

    await expect(fencePriorIngestSessions({ query })).rejects.toThrow(
      "missing=public.incidents",
    );
    expect(query).toHaveBeenCalledTimes(1);
  });
});