import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractPdfTextFallback,
  extractUkmtoPdfText,
  type UkmtoPdfExtractResult,
} from "./ukmtoPdf";

export type PartnerPdfExtractResult = UkmtoPdfExtractResult;

/** Extract text from a partner PDF buffer (JMIC / CMF advisories). */
export async function parsePartnerPdf(
  buffer: Buffer,
  opts: { maxPages?: number } = {},
): Promise<PartnerPdfExtractResult> {
  return extractUkmtoPdfText(buffer, opts);
}

export { extractPdfTextFallback };

export function partnerPdfFixturePath(fixtureDir: string, externalId: string): string {
  return join(fixtureDir, `jmic-${externalId}.pdf`);
}

export function loadPartnerPdfFixture(
  fixtureDir: string,
  externalId: string,
): Buffer | null {
  try {
    return readFileSync(partnerPdfFixturePath(fixtureDir, externalId));
  } catch {
    return null;
  }
}
