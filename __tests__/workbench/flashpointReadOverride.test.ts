import {
  looksLikeAutoFlashpointRead,
  pickFlashpointRead,
  resolveFlashpointReadOverride,
} from "../../artifacts/workbench/src/lib/pickRead";

describe("flashpoint read override resolution", () => {
  const staleActivism =
    "The main protest event across 6 Aug - 12 Aug 2026 was Civic protest march in Sri Lanka, rated Low severity. Reports describe the grievance or call rather than turnout, routes or police action on the day - treat the severity as provisional.";
  const freshActivism =
    "The main protest event across 6 Aug - 12 Aug 2026 was Civic protest march in India, rated High severity.";
  const analystOverride = "ZZ-ACTIVISM-READ-OVERRIDE-ZZ saved analyst text.";

  test("detects dataset-generated activism read templates", () => {
    expect(looksLikeAutoFlashpointRead(staleActivism)).toBe(true);
    expect(looksLikeAutoFlashpointRead(freshActivism)).toBe(true);
    expect(looksLikeAutoFlashpointRead(analystOverride)).toBe(false);
  });

  test("discards stale auto-prose that differs from the current generated read", () => {
    expect(resolveFlashpointReadOverride(staleActivism, freshActivism)).toBe("");
  });

  test("keeps genuine analyst overrides", () => {
    expect(resolveFlashpointReadOverride(analystOverride, freshActivism)).toBe(
      analystOverride,
    );
  });

  test("pickFlashpointRead falls back to live auto when saved prose is stale auto", () => {
    expect(pickFlashpointRead(staleActivism, freshActivism)).toBe(freshActivism);
  });

  test("pickFlashpointRead keeps analyst overrides", () => {
    expect(pickFlashpointRead(analystOverride, freshActivism)).toBe(analystOverride);
  });
});
