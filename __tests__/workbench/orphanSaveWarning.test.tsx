/**
 * Rendered-markup proof for Task: warn before saving a report if any Fast
 * Facts edit is orphaned. Owner-gated `/api` means no live screenshots, so
 * per `.agents/memory/owner-gated-ui-verification.md` we verify with
 * `renderToStaticMarkup`:
 *   1. OrphanSaveWarning names every orphaned override key and offers
 *      "Save anyway" + "Cancel".
 *   2. Singular vs plural copy is correct.
 *   3. With no orphans it renders NOTHING (saving after re-attach/clear
 *      proceeds with no notice).
 *   4. orphanedFastFactOverrideKeys drives the guard: keys vanish once the
 *      edit is re-attached or cleared, so the editor's auto-dismiss effect
 *      and silent save follow.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OrphanSaveWarning } from "../../artifacts/workbench/src/components/OrphanSaveWarning";
import {
  orphanedFastFactOverrideKeys,
  reattachFastFactOverride,
  clearFastFactOverride,
  type FastFactOverride,
} from "../../artifacts/workbench/src/lib/topicSectionOverrides";

const noop = () => {};

describe("OrphanSaveWarning rendered markup", () => {
  it("names every orphaned key and shows Save anyway / Cancel", () => {
    const html = renderToStaticMarkup(
      createElement(OrphanSaveWarning, {
        orphanKeys: ["Old Tile A", "Old Tile B"],
        onSaveAnyway: noop,
        onCancel: noop,
      }),
    );
    expect(html).toContain("Orphaned Fast Facts edits — save paused");
    expect(html).toContain("Old Tile A");
    expect(html).toContain("Old Tile B");
    expect(html).toContain("These saved edits are keyed to tiles");
    expect(html).toContain("Save anyway");
    expect(html).toContain("Cancel");
    expect(html).toContain('data-testid="orphan-save-warning"');
  });

  it("uses singular copy for one orphan", () => {
    const html = renderToStaticMarkup(
      createElement(OrphanSaveWarning, {
        orphanKeys: ["Renamed Tile"],
        onSaveAnyway: noop,
        onCancel: noop,
      }),
    );
    expect(html).toContain("This saved edit is keyed to a tile");
    expect(html).toContain("Renamed Tile");
    expect(html).toContain("the dead edit stored");
  });

  it("renders nothing when there are no orphans", () => {
    const html = renderToStaticMarkup(
      createElement(OrphanSaveWarning, {
        orphanKeys: [],
        onSaveAnyway: noop,
        onCancel: noop,
      }),
    );
    expect(html).toBe("");
  });
});

describe("save-guard predicate follows re-attach / clear", () => {
  const cards = [{ label: "Total Incidents" }, { label: "Countries" }];

  it("flags the orphan, then clears after re-attach", () => {
    const overrides: Record<string, FastFactOverride> = {
      "Old Label": { value: "42" },
    };
    expect(orphanedFastFactOverrideKeys(cards, overrides)).toEqual([
      "Old Label",
    ]);
    const fixed = reattachFastFactOverride(overrides, "Old Label", "Countries");
    expect(orphanedFastFactOverrideKeys(cards, fixed)).toEqual([]);
  });

  it("clears after the orphan is removed", () => {
    const overrides: Record<string, FastFactOverride> = {
      "Old Label": { note: "keep watching" },
      "Total Incidents": { value: "7" },
    };
    expect(orphanedFastFactOverrideKeys(cards, overrides)).toEqual([
      "Old Label",
    ]);
    const cleared = clearFastFactOverride(overrides, "Old Label");
    expect(orphanedFastFactOverrideKeys(cards, cleared)).toEqual([]);
    // The live-tile override is untouched.
    expect(cleared["Total Incidents"]).toEqual({ value: "7" });
  });
});
