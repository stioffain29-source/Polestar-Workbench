import { spawnSync } from "node:child_process";
import type Parser from "rss-parser";

const DEFAULT_TIMEOUT_MS = 20000;
const CURL_BIN = process.platform === "win32" ? "curl.exe" : "curl";
const DEFAULT_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 2500;

// A realistic desktop-browser User-Agent. Google News RSS throttles or blocks
// generic / library-default User-Agents (rss-parser's parseURL HTTP client),
// which is why the Google-News-backed feeds (energy / fertiliser / shipping /
// strikes) were timing out after 20s while the custom-fetch flashpoint feeds
// stayed healthy. Presenting a browser UA plus retry/backoff fixes that.
const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A fetch failure tagged with whether retrying could plausibly help. Timeouts,
// network errors, 429s and 5xx are transient (the usual throttle signature, so
// retry). A 4xx (other than 429) is a permanent client error, and a parse error
// means malformed content — neither is fixed by retrying, so we fail fast and
// avoid burning a second 20s timeout per feed during an upstream outage.
class FeedFetchError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "FeedFetchError";
    this.retryable = retryable;
  }
}

async function fetchBodyWithAccept(
  url: string,
  timeoutMs: number,
  accept: string,
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: accept,
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: ctrl.signal,
        redirect: "follow",
      });
    } catch (err) {
      // Abort (our timeout) and network-level errors are transient.
      const msg = ctrl.signal.aborted
        ? `Request timed out after ${timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : String(err);
      throw new FeedFetchError(msg, true);
    }
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new FeedFetchError(`Status code ${res.status}`, retryable);
    }
    try {
      return await res.text();
    } catch (err) {
      // The timeout can fire while the response BODY is still streaming (the
      // Google-News-throttle signature: headers arrive fast, body stalls). That
      // abort is thrown here, by the body read, not by the fetch() above. Treat
      // it exactly like a headers timeout — clean message + retryable — so it
      // runs through the normal backoff retries instead of leaking the raw
      // "This operation was aborted" AbortError and failing the feed at once.
      if (ctrl.signal.aborted) {
        throw new FeedFetchError(`Request timed out after ${timeoutMs}ms`, true);
      }
      // A genuine (non-abort) body read error is not retried — fail fast,
      // exactly as before (matches parse failures and permanent 4xx handling).
      throw err;
    }
  } finally {
    clearTimeout(timer);
  }
}

const RSS_ACCEPT =
  "application/rss+xml, application/atom+xml, application/xml, text/xml, */*";
const HTML_ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

export async function fetchBody(url: string, timeoutMs: number): Promise<string> {
  return fetchBodyWithAccept(url, timeoutMs, RSS_ACCEPT);
}

/** Fetch an HTML page (government / maritime sites that reject RSS Accept headers). */
export async function fetchHtmlBody(url: string, timeoutMs: number): Promise<string> {
  return fetchBodyWithAccept(url, timeoutMs, HTML_ACCEPT);
}

export type CurlFetchOptions = {
  accept?: string;
  headers?: Readonly<Record<string, string>>;
};

function normalizeCurlOpts(acceptOrOpts: string | CurlFetchOptions): CurlFetchOptions {
  return typeof acceptOrOpts === "string" ? { accept: acceptOrOpts } : acceptOrOpts;
}

function buildCurlArgs(
  url: string,
  timeoutMs: number,
  opts: CurlFetchOptions,
  appendHttpStatus: boolean,
): string[] {
  const accept = opts.accept ?? "*/*";
  const args = [
    "-sS",
    "-L",
    "--compressed",
    "--max-time",
    String(Math.max(1, Math.ceil(timeoutMs / 1000))),
    "-A",
    BROWSER_UA,
    "-H",
    `Accept: ${accept}`,
    "-H",
    "Accept-Language: en-US,en;q=0.9",
  ];
  for (const [name, value] of Object.entries(opts.headers ?? {})) {
    args.push("-H", `${name}: ${value}`);
  }
  if (appendHttpStatus) {
    args.push("-w", `\n%{http_code}`);
  }
  args.push(url);
  return args;
}

function parseCurlTextResponse(stdout: string): { body: string; httpStatus: number | null } {
  const raw = stdout ?? "";
  if (!raw) return { body: "", httpStatus: null };
  const lastNl = raw.lastIndexOf("\n");
  if (lastNl < 0) return { body: raw, httpStatus: null };
  const statusLine = raw.slice(lastNl + 1).trim();
  const status = Number.parseInt(statusLine, 10);
  if (!Number.isFinite(status) || status < 100 || status > 599) {
    return { body: raw, httpStatus: null };
  }
  return { body: raw.slice(0, lastNl), httpStatus: status };
}

function assertCurlHttpOk(httpStatus: number | null, body: string): void {
  if (httpStatus != null) {
    if (httpStatus >= 200 && httpStatus < 300) return;
    const retryable = httpStatus === 429 || httpStatus >= 500;
    throw new FeedFetchError(`Status code ${httpStatus}`, retryable);
  }
  if (/^\s*</.test(body) && /\b403\b|blocked|cloudflare|attention required/i.test(body)) {
    throw new FeedFetchError("Status code 403", false);
  }
}

function assertCurlProcessOk(result: ReturnType<typeof spawnSync>): void {
  if (result.error) {
    throw new FeedFetchError(`curl failed: ${result.error.message}`, true);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").toString().trim().slice(0, 300);
    throw new FeedFetchError(
      detail ? `curl exit ${result.status}: ${detail}` : `curl exit ${result.status}`,
      true,
    );
  }
}

/**
 * Fetch a URL body via curl. Node's global fetch is often WAF-blocked (Cloudflare
 * TLS fingerprint) on UKMTO / Royal Navy endpoints while curl with a browser UA
 * succeeds — see scripts/src/m15-phase0-check.ts.
 */
export function fetchBodyViaCurl(
  url: string,
  timeoutMs: number,
  acceptOrOpts: string | CurlFetchOptions = "*/*",
): string {
  const opts = normalizeCurlOpts(acceptOrOpts);
  const result = spawnSync(CURL_BIN, buildCurlArgs(url, timeoutMs, opts, true), {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });

  assertCurlProcessOk(result);

  const { body, httpStatus } = parseCurlTextResponse(result.stdout ?? "");
  const trimmed = body.trim();
  if (!trimmed) {
    throw new FeedFetchError("curl returned empty body", true);
  }
  assertCurlHttpOk(httpStatus, trimmed);
  return trimmed;
}

/** HTML fetch via curl — avoids Node fetch TLS fingerprint blocks on .mil / WAF sites. */
export function fetchHtmlViaCurl(
  url: string,
  timeoutMs: number,
  opts?: Omit<CurlFetchOptions, "accept">,
): string {
  return fetchBodyViaCurl(url, timeoutMs, { accept: HTML_ACCEPT, ...opts });
}

/** Binary-safe curl fetch (PDFs and other non-text assets). */
export function fetchBytesViaCurl(
  url: string,
  timeoutMs: number,
  acceptOrOpts: string | CurlFetchOptions = "*/*",
): Buffer {
  const opts = normalizeCurlOpts(acceptOrOpts);
  const result = spawnSync(CURL_BIN, buildCurlArgs(url, timeoutMs, opts, false), {
    maxBuffer: 20 * 1024 * 1024,
  });

  assertCurlProcessOk(result);

  const buf = result.stdout;
  if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
    throw new FeedFetchError("curl returned empty body", true);
  }
  const head = buf.subarray(0, 200).toString("latin1");
  if (/^\s*</.test(head) && /\b403\b|blocked|cloudflare|attention required/i.test(head)) {
    throw new FeedFetchError("Status code 403", false);
  }
  return buf;
}

/** Parse JSON from a curl-fetched body (throws FeedFetchError on HTML/block pages). */
export function fetchJsonViaCurl<T>(
  url: string,
  timeoutMs: number,
  opts?: CurlFetchOptions,
): T {
  const body = fetchBodyViaCurl(url, timeoutMs, {
    accept: "application/json",
    ...opts,
  });
  if (/^\s*</.test(body)) {
    throw new FeedFetchError(
      `Non-JSON response: ${body.replace(/\s+/g, " ").slice(0, 160)}`,
      false,
    );
  }
  try {
    return JSON.parse(body) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new FeedFetchError(`JSON parse failed: ${msg}`, false);
  }
}

export interface FetchFeedOptions {
  /** Total attempts including the first. Default 3 (two retries). */
  attempts?: number;
  /** Per-attempt abort timeout in ms. Default 20000. */
  timeoutMs?: number;
  /** Base exponential-backoff delay between retries in ms. Default 2500. */
  backoffMs?: number;
  /** Add an initial 0-400ms jitter to desynchronise feeds in the same batch. */
  stagger?: boolean;
}

// Fetch + parse an RSS/Atom feed robustly:
//  - a real browser User-Agent (avoids Google News bot-throttling),
//  - an AbortController timeout per attempt,
//  - gzip/br auto-decompression (Node's global fetch handles this; rss-parser's
//    parseURL does not reliably), and
//  - bounded retries with exponential backoff + jitter, so a transient Google
//    News throttle (the usual cause of the 20s timeouts) does not flag an
//    otherwise-healthy source as Failing.
//
// `stagger` adds a small initial random delay so feeds fetched together in a
// concurrency batch do not all hit the upstream at the same instant.
export async function fetchFeed(
  parser: Parser,
  url: string,
  opts: FetchFeedOptions = {},
) {
  const attempts = opts.attempts ?? DEFAULT_ATTEMPTS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseBackoffMs = opts.backoffMs ?? BASE_BACKOFF_MS;
  if (opts.stagger) await sleep(Math.random() * 400);
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const body = await fetchBody(url, timeoutMs);
      return await parser.parseString(body);
    } catch (err) {
      lastErr = err;
      // Parse errors (thrown by parseString, not FeedFetchError) and permanent
      // 4xx responses are not worth a second 20s attempt — fail fast.
      const retryable = err instanceof FeedFetchError && err.retryable;
      if (retryable && attempt < attempts - 1) {
        const backoff = baseBackoffMs * 2 ** attempt + Math.random() * 600;
        await sleep(backoff);
      } else {
        break;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
