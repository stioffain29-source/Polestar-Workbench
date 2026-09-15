/** @jest-environment jsdom */

const originalFetch = globalThis.fetch;

describe("PDF font asset loading", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    if (originalFetch) {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: originalFetch,
      });
    } else {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    }
  });

  it("aborts abandoned font requests and allows a fresh retry", async () => {
    const fetchMock = jest.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      },
    );
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
    const { ensureRobotoLoaded } = await import(
      "../../artifacts/workbench/src/lib/pdfFonts"
    );
    const pdf = {} as Parameters<typeof ensureRobotoLoaded>[0];

    const first = ensureRobotoLoaded(pdf);
    const firstRejected = expect(first).rejects.toThrow("timed out fetching");
    await jest.advanceTimersByTimeAsync(12_000);
    await firstRejected;
    expect(fetchMock).toHaveBeenCalledTimes(5);

    const second = ensureRobotoLoaded(pdf);
    const secondRejected = expect(second).rejects.toThrow("timed out fetching");
    expect(fetchMock).toHaveBeenCalledTimes(10);
    await jest.advanceTimersByTimeAsync(12_000);
    await secondRejected;
  });
});