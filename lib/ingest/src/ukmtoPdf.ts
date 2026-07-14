import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchBytesViaCurl, sleep } from "./feedFetch";
import { UKMTO_SITE_ORIGIN } from "./ukmtoParse";

const FETCH_TIMEOUT_MS = 30_000;
const FETCH_ATTEMPTS = 3;
const FETCH_BACKOFF_MS = 2500;
const DEFAULT_MAX_PAGES = 1;

export type UkmtoPdfExtractResult = {
  text: string;
  /** True when only a best-effort / first-page excerpt was recovered. */
  partial: boolean;
  error?: string;
  pagesExtracted?: number;
};

type PdfParser = (
  data: Buffer,
  options?: { max?: number },
) => Promise<{ text: string; numpages: number }>;

function normalizePdfText(text: string): string {
  return text
    .replace(/\0/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Best-effort text recovery from PDF literal strings (no native parser). */
export function extractPdfTextFallback(bytes: Buffer): string {
  const raw = bytes.toString("latin1");
  const chunks: string[] = [];
  const re = /\(([^()\\]*(?:\\.[^()\\]*)*)\)/g;
  for (const match of raw.matchAll(re)) {
    const piece = (match[1] ?? "")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .replace(/\\\\/g, "\\")
      .trim();
    if (piece.length >= 4 && /[A-Za-z]/.test(piece)) {
      chunks.push(piece);
    }
  }
  return normalizePdfText(chunks.join("\n"));
}

async function loadPdfParser(): Promise<PdfParser> {
  const mod = (await import("pdf-parse")) as PdfParser | { default: PdfParser };
  return typeof mod === "function" ? mod : mod.default;
}

/**
 * Extract UKMTO PDF text — first page + summary, best-effort (M1.5-T5).
 * Falls back to literal-string scraping when the parser fails.
 */
export async function extractUkmtoPdfText(
  bytes: Buffer,
  opts: { maxPages?: number } = {},
): Promise<UkmtoPdfExtractResult> {
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  try {
    const pdfParse = await loadPdfParser();
    const parsed = await pdfParse(bytes, { max: maxPages });
    const text = normalizePdfText(parsed.text);
    if (text.length >= 20) {
      return {
        text,
        partial: parsed.numpages > maxPages,
        pagesExtracted: Math.min(parsed.numpages, maxPages),
      };
    }
  } catch (err) {
    const fallback = extractPdfTextFallback(bytes);
    if (fallback.length >= 20) {
      return {
        text: fallback,
        partial: true,
        error: err instanceof Error ? err.message : String(err),
        pagesExtracted: 1,
      };
    }
    return {
      text: fallback,
      partial: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const fallback = extractPdfTextFallback(bytes);
  return {
    text: fallback,
    partial: true,
    error: fallback ? "pdf-parse returned little text" : "no extractable PDF text",
    pagesExtracted: fallback ? 1 : 0,
  };
}

export async function fetchPdfBytes(url: string): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    try {
      try {
        const buf = fetchBytesViaCurl(url, FETCH_TIMEOUT_MS, "application/pdf,*/*");
        if (buf.length === 0) throw new Error("empty PDF response");
        return buf;
      } catch (curlErr) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        try {
          const res = await fetch(url, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              Accept: "application/pdf,*/*",
              "Accept-Language": "en-US,en;q=0.9",
            },
            signal: ctrl.signal,
            redirect: "follow",
          });
          if (!res.ok) {
            throw new Error(`PDF fetch HTTP ${res.status}`);
          }
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length === 0) throw new Error("empty PDF response");
          return buf;
        } finally {
          clearTimeout(timer);
        }
      }
    } catch (err) {
      lastErr = err;
      if (attempt < FETCH_ATTEMPTS - 1) {
        await sleep(FETCH_BACKOFF_MS * 2 ** attempt + Math.random() * 600);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export function pdfFixturePath(fixtureDir: string, externalId: string): string {
  return join(fixtureDir, `ukmto-${externalId}.pdf`);
}

export function loadUkmtoPdfFixture(
  fixtureDir: string,
  externalId: string,
): Buffer | null {
  try {
    return readFileSync(pdfFixturePath(fixtureDir, externalId));
  } catch {
    return null;
  }
}

/** Merge PDF excerpt into HTML-derived UKMTO body text. */
export function mergeUkmtoBodyWithPdf(
  htmlBody: string,
  pdf: UkmtoPdfExtractResult | null,
): { bodyText: string; pdfMerged: boolean } {
  if (!pdf?.text?.trim()) {
    return { bodyText: htmlBody, pdfMerged: false };
  }
  const label = pdf.partial ? "PDF excerpt (partial parse)" : "PDF text";
  return {
    bodyText: `${htmlBody}\n\n---\n[${label}]\n${pdf.text.trim()}`,
    pdfMerged: true,
  };
}

export function resolveUkmtoPdfUrl(pdfUrl: string): string {
  try {
    return new URL(pdfUrl, UKMTO_SITE_ORIGIN).href;
  } catch {
    return pdfUrl;
  }
}
