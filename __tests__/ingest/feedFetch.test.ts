import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import Parser from "rss-parser";
import { fetchBody, fetchFeed } from "../../lib/ingest/src/feedFetch";

const VALID_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Test Feed</title>
<item><title>Item 1</title><link>http://example.test/1</link></item>
</channel></rss>`;

interface TestServer {
  url: string;
  close: () => Promise<void>;
}

async function startServer(handler: http.RequestListener): Promise<TestServer> {
  const server = http.createServer(handler);
  const sockets = new Set<Socket>();
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

describe("feed fetcher resilience", () => {
  it("returns the body on a normal successful fetch", async () => {
    const srv = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/rss+xml" });
      res.end(VALID_RSS);
    });
    try {
      const body = await fetchBody(srv.url, 1000);
      expect(body).toContain("Item 1");
    } finally {
      await srv.close();
    }
  });

  it("fetchFeed parses a successful feed", async () => {
    const srv = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/rss+xml" });
      res.end(VALID_RSS);
    });
    try {
      const feed = await fetchFeed(new Parser(), srv.url, {
        attempts: 2,
        timeoutMs: 1000,
        backoffMs: 5,
      });
      expect(feed.items).toHaveLength(1);
      expect(feed.items[0].title).toBe("Item 1");
    } finally {
      await srv.close();
    }
  });

  it("reports a stalled response body as a clean retryable timeout and retries via backoff", async () => {
    let requests = 0;
    const srv = await startServer((_req, res) => {
      requests++;
      // Headers arrive fast, then the body stalls forever (the Google-News
      // throttle signature). The abort fires during the body read.
      res.writeHead(200, { "Content-Type": "application/rss+xml" });
      res.write('<?xml version="1.0"?><rss><channel>');
      // intentionally never end the response
    });
    try {
      const err = await fetchFeed(new Parser(), srv.url, {
        attempts: 2,
        timeoutMs: 80,
        backoffMs: 10,
      }).catch((e) => e as Error);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toMatch(/Request timed out after 80ms/);
      expect(err.message).not.toMatch(/aborted/i);
      // Retried via backoff: the first failure was retryable, so two requests.
      expect(requests).toBe(2);
    } finally {
      await srv.close();
    }
  });

  it("reports a stalled (no response) headers timeout as a clean retryable timeout and retries", async () => {
    let requests = 0;
    const srv = await startServer(() => {
      requests++;
      // Never respond at all — the abort fires during the fetch() call itself.
    });
    try {
      const err = await fetchFeed(new Parser(), srv.url, {
        attempts: 2,
        timeoutMs: 80,
        backoffMs: 10,
      }).catch((e) => e as Error);
      expect(err.message).toMatch(/Request timed out after 80ms/);
      expect(err.message).not.toMatch(/aborted/i);
      expect(requests).toBe(2);
    } finally {
      await srv.close();
    }
  });

  it("fails fast on a 4xx with no extra retries", async () => {
    let requests = 0;
    const srv = await startServer((_req, res) => {
      requests++;
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
    });
    try {
      const err = await fetchFeed(new Parser(), srv.url, {
        attempts: 3,
        timeoutMs: 1000,
        backoffMs: 10,
      }).catch((e) => e as Error);
      expect(err.message).toMatch(/Status code 404/);
      expect(requests).toBe(1);
    } finally {
      await srv.close();
    }
  });

  it("treats a 5xx as retryable and exhausts all attempts", async () => {
    let requests = 0;
    const srv = await startServer((_req, res) => {
      requests++;
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("service unavailable");
    });
    try {
      const err = await fetchFeed(new Parser(), srv.url, {
        attempts: 3,
        timeoutMs: 1000,
        backoffMs: 10,
      }).catch((e) => e as Error);
      expect(err.message).toMatch(/Status code 503/);
      expect(requests).toBe(3);
    } finally {
      await srv.close();
    }
  });

  it("treats a 429 as retryable and exhausts all attempts", async () => {
    let requests = 0;
    const srv = await startServer((_req, res) => {
      requests++;
      res.writeHead(429, { "Content-Type": "text/plain" });
      res.end("too many requests");
    });
    try {
      const err = await fetchFeed(new Parser(), srv.url, {
        attempts: 3,
        timeoutMs: 1000,
        backoffMs: 10,
      }).catch((e) => e as Error);
      expect(err.message).toMatch(/Status code 429/);
      expect(requests).toBe(3);
    } finally {
      await srv.close();
    }
  });
});
