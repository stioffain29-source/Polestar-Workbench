import type Parser from "rss-parser";

const DEFAULT_TIMEOUT_MS = 20000;
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
