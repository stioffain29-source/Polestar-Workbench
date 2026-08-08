// Repeatable guard for the compact Jakarta city report. Two independent checks
// keep the offline jsPDF brief in lockstep with the on-screen one:
//
//   1. SECTION ORDER PARITY — reads the Jakarta-only preview branch and the
//      headless renderJakartaWeeklyBrief() function, then verifies the approved
//      five-section weekly structure. A reorder or a return of a retired
//      multi-table section fails.
//
//   2. FONT AUDIT — generates a real Jakarta PDF through the same exporter the
//      app uses and inventories the per-page Tf (font-select) operators,
//      resolving each selected resource back to its BaseFont. PASS = only
//      /Roboto* fonts are ever SELECTED. jsPDF auto-registers the 14 standard
//      PDF fonts in the font dictionary, so a dictionary scan is meaningless;
//      only the Tf operator inventory proves what is actually drawn.
//
// Usage:
//   cd artifacts/workbench
//   npx tsx --import ./scripts/registerLoader.mjs scripts/auditJakartaPdf.ts
//
// Exits non-zero (and writes nothing) on any drift, so it is safe to wire into
// CI / a validation step. Pass --write to refresh screenshots/font_proof/FONT_AUDIT.txt.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve as resolvePath, dirname, join } from "node:path";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKBENCH = resolvePath(HERE, "..");
const SRC = (p: string) => resolvePath(WORKBENCH, "src", p);

// The single source of truth for the expected section order. Mirrors the task's
// "Done looks like" list and the comments in both source files.
const CANONICAL_SECTIONS = [
  "Bottom Line Up Front",
  "Top 3 Developments",
  "Operating Picture This Week",
  "Crime & Escalation Watch",
  "Recommended Actions",
];

// ---------------------------------------------------------------------------
// 1. SECTION ORDER PARITY (static source parse)
// ---------------------------------------------------------------------------

/** On-screen order from the tactical Jakarta-only return branch. */
function screenSectionOrder(): string[] {
  const body = readFileSync(SRC("components/PngCountryReportBody.tsx"), "utf8");
  const start = body.indexOf("if (tactical) {");
  const end = body.indexOf("\n  return (", start);
  if (start === -1 || end === -1) throw new Error("Jakarta preview branch not found");
  return [...body.slice(start, end).matchAll(/<Section\s+title="([^"]+)"/g)].map((m) => m[1]);
}

/** Offline order from the dedicated compact Jakarta renderer. */
function pdfSectionOrder(): string[] {
  const src = readFileSync(SRC("lib/exportCountryReportPdf.ts"), "utf8");
  const start = src.indexOf("function renderJakartaWeeklyBrief");
  const after = src.indexOf("\nfunction ", start + 1);
  if (start === -1) throw new Error("renderJakartaWeeklyBrief() not found");
  const fnBody = src.slice(start, after === -1 ? undefined : after);
  return [
    ...fnBody.matchAll(/draw(?:SectionWithProse|SectionHeading)\(\s*ctx,\s*"([^"]+)"/g),
  ].map((m) => m[1]);
}

function assertOrder(label: string, actual: string[], expected: string[]) {
  const same =
    actual.length === expected.length &&
    actual.every((s, i) => s === expected[i]);
  if (!same) {
    console.error(`\n  FAIL — ${label} section order drift`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
    return false;
  }
  console.log(`  PASS — ${label} (${actual.length} sections in order)`);
  return true;
}

// ---------------------------------------------------------------------------
// 2. FONT AUDIT (real PDF generation + per-page Tf inventory)
// ---------------------------------------------------------------------------

// Patch fetch so pdfFonts.ts can read the Roboto TTFs the loader rewrote to
// file:// URLs, while data: URLs (cover image inlined by the loader) and other
// requests pass through to Node's native fetch.
const origFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;
  if (url && url.startsWith("file://")) {
    const buf = readFileSync(fileURLToPath(url));
    return new Response(buf, {
      status: 200,
      headers: { "content-type": "font/ttf" },
    });
  }
  return origFetch(input as RequestInfo, init);
}) as typeof fetch;

/**
 * Inventory the fonts SELECTED (via the `Tf` operator) on each page of an
 * uncompressed jsPDF document. Returns { perPage, nonRoboto }. jsPDF emits
 * uncompressed content streams by default, so the bytes are plain text.
 */
function inventoryTfFonts(bytes: ArrayBuffer): {
  perPage: { page: number; fonts: string[] }[];
  nonRoboto: Set<string>;
} {
  const pdf = Buffer.from(bytes).toString("latin1");

  // obj number -> BaseFont name, e.g. "12 0 obj <</Type/Font/BaseFont/Roboto-Bold..."
  const baseFontByObj = new Map<string, string>();
  const objRe = /(\d+)\s+\d+\s+obj([\s\S]*?)endobj/g;
  let om: RegExpExecArray | null;
  while ((om = objRe.exec(pdf))) {
    const bf = /\/BaseFont\s*\/([A-Za-z0-9+\-]+)/.exec(om[2]);
    if (bf) baseFontByObj.set(om[1], bf[1]);
  }

  // Global short-name -> BaseFont. jsPDF keeps a single shared Resources/Font
  // dictionary (a separate object, NOT inline in each page), so resolve every
  // `/F<n> <obj> 0 R` reference in the document and fold it through the BaseFont
  // map. Short names are stable across pages.
  const shortToBase = new Map<string, string>();
  const refRe = /\/(F\d+)\s+(\d+)\s+\d+\s+R/g;
  let rm: RegExpExecArray | null;
  while ((rm = refRe.exec(pdf))) {
    const base = baseFontByObj.get(rm[2]);
    if (base) shortToBase.set(rm[1], base);
  }

  // Page content streams, in document order.
  const perPage: { page: number; fonts: string[] }[] = [];
  const nonRoboto = new Set<string>();
  const pageRe = /\/Type\s*\/Page[^s][\s\S]*?endobj/g;
  let pm: RegExpExecArray | null;
  let pageNo = 0;
  while ((pm = pageRe.exec(pdf))) {
    pageNo += 1;
    const block = pm[0];
    // resolve the content stream referenced by /Contents N 0 R
    const contentsRef = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(block);
    let stream = "";
    if (contentsRef) {
      const sObjRe = new RegExp(
        `\\b${contentsRef[1]}\\s+\\d+\\s+obj([\\s\\S]*?)endobj`,
      );
      const sm = sObjRe.exec(pdf);
      if (sm) {
        const body = /stream\r?\n([\s\S]*?)\r?\nendstream/.exec(sm[1]);
        stream = body ? body[1] : sm[1];
      }
    }
    // Tf operators select a font by short name: "/F1 12 Tf"
    const used = new Set<string>();
    const tfRe = /\/(\w+)\s+[\d.]+\s+Tf/g;
    let tm: RegExpExecArray | null;
    while ((tm = tfRe.exec(stream))) {
      const base = shortToBase.get(tm[1]) ?? tm[1];
      used.add(base);
      if (!/Roboto/i.test(base)) nonRoboto.add(base);
    }
    perPage.push({ page: pageNo, fonts: [...used].sort() });
  }
  return { perPage, nonRoboto };
}

async function generateJakartaPdf(): Promise<ArrayBuffer> {
  const { exportCountryReportPdf } = await import(
    "../src/lib/exportCountryReportPdf"
  );
  // Minimal synthetic Jakarta dataset — enough to populate every section so the
  // Tf inventory exercises all heading/body/table/italic font weights.
  const today = new Date();
  const iso = (daysAgo: number) =>
    new Date(today.getTime() - daysAgo * 86400000).toISOString();
  const incidents = [
    {
      id: 1,
      title: "Protest near Central Jakarta business district",
      topic: "flashpoint",
      severity: "Moderate",
      occurredAt: iso(1),
      country: "Indonesia",
      location: "Jakarta",
      latitude: -6.2,
      longitude: 106.82,
      summary: "Demonstration disrupted access around Sudirman corridor.",
      source: "Synthetic",
      sourceUrl: "https://example.test/a",
    },
    {
      id: 2,
      title: "Port congestion at Tanjung Priok",
      topic: "flashpoint",
      severity: "Low",
      occurredAt: iso(3),
      country: "Indonesia",
      location: "Jakarta",
      latitude: -6.1,
      longitude: 106.88,
      summary: "Logistics backlog reported at the port.",
      source: "Synthetic",
      sourceUrl: "https://example.test/b",
    },
    {
      id: 3,
      title: "Security incident near Soekarno-Hatta airport",
      topic: "flashpoint",
      severity: "High",
      occurredAt: iso(5),
      country: "Indonesia",
      location: "Jakarta",
      latitude: -6.13,
      longitude: 106.66,
      summary: "Heightened checks affected airport transfers.",
      source: "Synthetic",
      sourceUrl: "https://example.test/c",
    },
  ];
  const country = {
    name: "Jakarta",
    region: "Southeast Asia",
    overview: "Synthetic overview for the font audit.",
    trendSummary: "Synthetic trend summary.",
    implications: "Synthetic implications.",
  };
  const tmp = mkdtempSync(join(tmpdir(), "jakarta-audit-"));
  const out = join(tmp, "jakarta_country.pdf");
  // The jsPDF Node build writes the file to disk synchronously via fs on save().
  await exportCountryReportPdf(
    country as Parameters<typeof exportCountryReportPdf>[0],
    incidents as Parameters<typeof exportCountryReportPdf>[1],
    {},
    out,
  );
  const buf = readFileSync(out);
  rmSync(tmp, { recursive: true, force: true });
  // Return a fresh ArrayBuffer view over the file bytes.
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  const write = process.argv.includes("--write");
  let ok = true;

  console.log("Jakarta offline PDF guard\n");
  console.log("[1/2] Section order parity");
  const screen = screenSectionOrder();
  const pdf = pdfSectionOrder();
  ok = assertOrder("canonical vs on-screen", screen, CANONICAL_SECTIONS) && ok;
  ok = assertOrder("canonical vs offline PDF", pdf, CANONICAL_SECTIONS) && ok;
  ok = assertOrder("on-screen vs offline PDF", pdf, screen) && ok;

  console.log("\n[2/2] Font audit (per-page Tf inventory)");
  const bytes = await generateJakartaPdf();
  const { perPage, nonRoboto } = inventoryTfFonts(bytes);
  for (const p of perPage) {
    console.log(`  page ${p.page}: Tf-used fonts = [${p.fonts.join(", ")}]`);
  }
  const allUsed = [
    ...new Set(perPage.flatMap((p) => p.fonts)),
  ].sort();
  if (nonRoboto.size === 0 && allUsed.length > 0) {
    console.log(`  PASS — only Roboto selected: [${allUsed.join(", ")}]`);
  } else {
    ok = false;
    if (allUsed.length === 0) {
      console.error("  FAIL — no fonts were selected (PDF not generated?)");
    } else {
      console.error(`  FAIL — non-Roboto fonts selected: [${[...nonRoboto].sort().join(", ")}]`);
    }
  }

  if (write && ok) {
    const auditPath = resolvePath(
      WORKBENCH,
      "screenshots/font_proof/FONT_AUDIT.txt",
    );
    const existing = readFileSync(auditPath, "utf8");
    const marker = "==== jakarta_country.pdf (Jakarta compact weekly brief) ====";
    const lines = [
      marker,
      ...perPage.map(
        (p) => `  page ${p.page}: Tf-used fonts = [${p.fonts.map((f) => `'${f}'`).join(", ")}]`,
      ),
      `  --> ALL fonts USED via Tf: [${allUsed.map((f) => `'${f}'`).join(", ")}]`,
      "  --> NON-Roboto used: NONE — PASS",
      "  Section order verified: " + CANONICAL_SECTIONS.join(", ") + ".",
      "  (regenerate with: npx tsx --import ./scripts/registerLoader.mjs scripts/auditJakartaPdf.ts --write)",
    ].join("\n");
    const idx = existing.indexOf(marker);
    const next = idx === -1 ? `${existing.trimEnd()}\n\n${lines}\n` : `${existing.slice(0, idx).trimEnd()}\n\n${lines}\n`;
    writeFileSync(auditPath, next);
    console.log(`\nUpdated ${auditPath}`);
  }

  console.log(`\n${ok ? "OVERALL: PASS" : "OVERALL: FAIL"}`);
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
