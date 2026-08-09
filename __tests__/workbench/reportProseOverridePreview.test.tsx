/**
 * Preview side of the prose-override parity guard (task 448).
 *
 * Renders each topic's on-screen preview component with the SAME sentinel-laden
 * report fixtures the PDF companion (`reportProseOverridePdf.test.ts`) feeds
 * the jsPDF exporters, and asserts every saved override sentinel appears in
 * the rendered HTML. Both suites passing proves preview text == PDF text for
 * each editable section: the same saved value renders on both surfaces.
 *
 * Separate file because the preview components need the REAL pdfChrome module
 * (SEV_COLOR / DISCLAIMER_TEXT / …) while the PDF suite mocks it with a
 * recording stub — the same split the curation parity suites use.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import FlashpointReportPreview from "../../artifacts/workbench/src/components/FlashpointReportPreview";
import ShippingReportPreview from "../../artifacts/workbench/src/components/ShippingReportPreview";
import ConflictReportPreview from "../../artifacts/workbench/src/components/ConflictReportPreview";
import ReportPreview from "../../artifacts/workbench/src/components/ReportPreview";
import CargoReportPreview from "../../artifacts/workbench/src/components/CargoReportPreview";
import {
  FLASHPOINT_REPORT,
  FLASHPOINT_INCIDENTS,
  FLASHPOINT_SENTINELS,
  SHIPPING_REPORT,
  SHIPPING_INCIDENTS,
  SHIPPING_SENTINELS,
  CONFLICT_REPORT,
  CONFLICT_INCIDENTS,
  CONFLICT_SENTINELS,
  ENERGY_REPORT,
  ENERGY_INCIDENTS,
  ENERGY_SENTINELS,
  CARGO_REPORT,
  CARGO_INCIDENTS,
  CARGO_SENTINELS,
  FUEL_REPORT,
  FUEL_INCIDENTS,
  FUEL_SENTINELS,
  CARGO_READ_SECTIONS,
  cargoReportWithoutReadOverrides,
} from "./prosePassthroughTestHelpers";

function expectAllSentinels(html: string, sentinels: Record<string, string>) {
  for (const [field, sentinel] of Object.entries(sentinels)) {
    const token = sentinel.split(" ")[0];
    if (!html.includes(token)) {
      throw new Error(
        `Saved override for "${field}" (token ${token}) did not reach the on-screen preview markup.`,
      );
    }
  }
}

describe("saved prose overrides reach the on-screen preview", () => {
  it("flashpoint preview renders every saved override", () => {
    const html = renderToStaticMarkup(
      createElement(FlashpointReportPreview, {
        report: FLASHPOINT_REPORT,
        incidents: FLASHPOINT_INCIDENTS,
      } as never),
    );
    expectAllSentinels(html, FLASHPOINT_SENTINELS);
  });

  it("shipping preview renders every saved section read", () => {
    const html = renderToStaticMarkup(
      createElement(ShippingReportPreview, {
        report: SHIPPING_REPORT,
        incidents: SHIPPING_INCIDENTS,
      } as never),
    );
    expectAllSentinels(html, SHIPPING_SENTINELS);
  });

  it("conflict preview renders the saved Other Watched Theatres read", () => {
    const html = renderToStaticMarkup(
      createElement(ConflictReportPreview, {
        report: CONFLICT_REPORT,
        incidents: CONFLICT_INCIDENTS,
      } as never),
    );
    expectAllSentinels(html, CONFLICT_SENTINELS);
  });

  it("generic energy preview renders every saved core narrative field", () => {
    const html = renderToStaticMarkup(
      createElement(ReportPreview, {
        report: ENERGY_REPORT,
        incidents: ENERGY_INCIDENTS,
      } as never),
    );
    expectAllSentinels(html, ENERGY_SENTINELS);
  });

  it("cargo preview renders every saved assessment override without tripping the validation gate", () => {
    const html = renderToStaticMarkup(
      createElement(CargoReportPreview, {
        report: CARGO_REPORT,
        incidents: CARGO_INCIDENTS,
      } as never),
    );
    // The gate renders a blocking panel INSTEAD of the report — assert the
    // fixture passes so the sentinels are proven on the real report body.
    if (html.includes("data-cargo-validation-blocked")) {
      throw new Error(
        "Cargo fixture tripped the hard validation gate — the preview rendered the blocking panel instead of the report.",
      );
    }
    expectAllSentinels(html, CARGO_SENTINELS);
  });

  it("fuel preview rejects every saved fuel read override in favour of canonical facts", () => {
    const html = renderToStaticMarkup(
      createElement(ReportPreview, {
        report: FUEL_REPORT,
        incidents: FUEL_INCIDENTS,
      } as never),
    );
    for (const sentinel of Object.values(FUEL_SENTINELS)) {
      expect(html).not.toContain(sentinel.split(" ")[0]);
    }
    expect(html).toContain("Overall severity: High");
    expect(html).toContain("Indonesia is the primary pressure point");
  });
});

// Task 454: the three cargo reads are gated by show(key). A typo in a section
// key would silently suppress a section — these tests pin the exact keys.
describe("cargo hidden section keys gate the three data-driven reads (preview)", () => {
  function renderCargo(hiddenSections: string[]): string {
    const html = renderToStaticMarkup(
      createElement(CargoReportPreview, {
        report: CARGO_REPORT,
        incidents: CARGO_INCIDENTS,
        hiddenSections,
      } as never),
    );
    if (html.includes("data-cargo-validation-blocked")) {
      throw new Error(
        "Cargo fixture tripped the hard validation gate — the preview rendered the blocking panel instead of the report.",
      );
    }
    return html;
  }

  it("renders all three reads when hiddenSections is empty", () => {
    const html = renderCargo([]);
    for (const s of CARGO_READ_SECTIONS) {
      expect(html).toContain(s.heading);
      expect(html).toContain(s.sentinelToken);
    }
  });

  for (const s of CARGO_READ_SECTIONS) {
    it(`omits "${s.heading}" when "${s.key}" is hidden — and keeps the other two`, () => {
      const html = renderCargo([s.key]);
      expect(html).not.toContain(s.heading);
      expect(html).not.toContain(s.sentinelToken);
      for (const other of CARGO_READ_SECTIONS) {
        if (other.key === s.key) continue;
        expect(html).toContain(other.heading);
        expect(html).toContain(other.sentinelToken);
      }
    });
  }

  it("suppresses the AUTO-generated read text too, not just saved overrides", () => {
    const report = cargoReportWithoutReadOverrides(CARGO_REPORT);
    const shown = renderToStaticMarkup(
      createElement(CargoReportPreview, {
        report,
        incidents: CARGO_INCIDENTS,
        hiddenSections: [],
      } as never),
    );
    const hidden = renderToStaticMarkup(
      createElement(CargoReportPreview, {
        report,
        incidents: CARGO_INCIDENTS,
        hiddenSections: CARGO_READ_SECTIONS.map((s) => s.key),
      } as never),
    );
    for (const s of CARGO_READ_SECTIONS) {
      expect(shown).toContain(s.heading);
      expect(hidden).not.toContain(s.heading);
    }
  });
});

// Task 457: every remaining editable/gated section obeys its hiddenSections
// key on the preview surface — hiding one section removes exactly that
// heading and its text while every other gated section keeps rendering.
import {
  FLASHPOINT_GATED_SECTIONS,
  SHIPPING_GATED_SECTIONS,
  CONFLICT_GATED_SECTIONS,
  FUEL_GATED_SECTIONS,
  ENERGY_GATED_SECTIONS,
  type GatedSection,
} from "./prosePassthroughTestHelpers";

function gateSuite(
  label: string,
  sections: GatedSection[],
  render: (hiddenSections: string[]) => string,
) {
  describe(`${label} hidden section keys gate their sections (preview)`, () => {
    it("renders every gated section when hiddenSections is empty", () => {
      const html = render([]);
      for (const s of sections) {
        expect(html).toContain(s.heading);
        if (s.sentinelToken) expect(html).toContain(s.sentinelToken);
      }
    });

    for (const s of sections) {
      it(`omits "${s.heading}" when "${s.key}" is hidden — and keeps the rest`, () => {
        const html = render([s.key]);
        expect(html).not.toContain(`>${s.heading}<`);
        if (s.sentinelToken) expect(html).not.toContain(s.sentinelToken);
        for (const other of sections) {
          if (other.key === s.key) continue;
          expect(html).toContain(other.heading);
          if (other.sentinelToken) expect(html).toContain(other.sentinelToken);
        }
      });
    }
  });
}

gateSuite("flashpoint", FLASHPOINT_GATED_SECTIONS, (hiddenSections) =>
  renderToStaticMarkup(
    createElement(FlashpointReportPreview, {
      report: FLASHPOINT_REPORT,
      incidents: FLASHPOINT_INCIDENTS,
      hiddenSections,
    } as never),
  ),
);

gateSuite("shipping", SHIPPING_GATED_SECTIONS, (hiddenSections) =>
  renderToStaticMarkup(
    createElement(ShippingReportPreview, {
      report: SHIPPING_REPORT,
      incidents: SHIPPING_INCIDENTS,
      hiddenSections,
    } as never),
  ),
);

gateSuite("conflict", CONFLICT_GATED_SECTIONS, (hiddenSections) =>
  renderToStaticMarkup(
    createElement(ConflictReportPreview, {
      report: CONFLICT_REPORT,
      incidents: CONFLICT_INCIDENTS,
      hiddenSections,
    } as never),
  ),
);

gateSuite("fuel", FUEL_GATED_SECTIONS, (hiddenSections) =>
  renderToStaticMarkup(
    createElement(ReportPreview, {
      report: FUEL_REPORT,
      incidents: FUEL_INCIDENTS,
      hiddenSections,
    } as never),
  ),
);

gateSuite("generic energy", ENERGY_GATED_SECTIONS, (hiddenSections) =>
  renderToStaticMarkup(
    createElement(ReportPreview, {
      report: ENERGY_REPORT,
      incidents: ENERGY_INCIDENTS,
      hiddenSections,
    } as never),
  ),
);
