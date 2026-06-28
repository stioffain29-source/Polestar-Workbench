/**
 * @jest-environment jsdom
 *
 * REGRESSION GUARD: same-screen action buttons must refresh the visible list.
 *
 * The workbench relies on each create/update/delete button manually telling the
 * screen to refresh after a successful mutation (React Query
 * `queryClient.invalidateQueries`). That step is easy to forget — the Protests
 * "Promote" button once shipped without it and looked broken ("nothing
 * happened" until a manual reload). This test exercises the REAL pages with the
 * REAL generated mutation hooks and a REAL `QueryClient`, mocking only the
 * network layer (global `fetch`) with a small stateful store. If a button stops
 * invalidating its list query, the mutated row never appears/disappears on
 * screen without a reload and these tests fail.
 *
 * Covered (PUBLIC, not token-gated) flows:
 *   - /incidents   : create then delete an incident, asserting the list updates.
 *   - /spot-reports: delete a spot report, asserting the card disappears.
 *   - /reports     : delete a report, asserting the card disappears.
 *   - /strikes/backfill: create a strike, asserting the "Recently Added" list
 *                    shows it without a reload.
 *   - /protests    : promote a Social Watch post, asserting the row flips from
 *                    the "Promote" button to its "Incident #N" back-link.
 *
 * CHECKLIST for any NEW same-screen mutation button: wire the mutation's
 * `onSuccess` to `queryClient.invalidateQueries({ queryKey: get<Thing>QueryKey() })`
 * (see `getListIncidentsQueryKey` / `getListSpotReportsQueryKey` usage in the
 * pages). Add the page here if it owns a same-screen create/update/delete.
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// `wouter` ships untransformed ESM and the pages only use it for navigation
// (out of scope here) — stub it to a minimal router so jest can load the pages.
jest.mock("wouter", () => ({
  __esModule: true,
  useLocation: () => ["/", () => {}],
  // Pattern-aware so the CountryReport page (`useRoute("/countries/:slug")`)
  // resolves a slug; every other page's `useRoute` call still gets no match.
  useRoute: (pattern: string) =>
    pattern === "/countries/:slug" ? [true, { slug: "testlandia" }] : [false, null],
  Link: ({ children, href }: { children: React.ReactNode; href?: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// recharts + react-leaflet are pure visualisation (out of scope for a
// refresh-after-action test) and don't render in jsdom — stub every named
// export to an inert passthrough so the heavy Protests page mounts.
jest.mock("recharts", () => {
  const React = require("react") as typeof import("react");
  const Passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children);
  return new Proxy(
    {},
    { get: (_t, prop) => (prop === "__esModule" ? true : Passthrough) },
  );
});
jest.mock("react-leaflet", () => {
  const React = require("react") as typeof import("react");
  const Passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return new Proxy(
    {},
    { get: (_t, prop) => (prop === "__esModule" ? true : Passthrough) },
  );
});

// CountryReport pulls in PDF chrome (`jspdf`), which touches `TextEncoder` at
// import time — absent in jsdom and irrelevant to a refresh-after-action test.
// Stub jspdf (covers every transitive importer) and the exportPdf helper.
jest.mock("jspdf", () => ({ __esModule: true, jsPDF: class {} }));
jest.mock("@/lib/exportPdf", () => ({
  __esModule: true,
  exportElementToPdf: jest.fn(async () => {}),
  slugifyForFilename: (s: string) => s,
}));

import Incidents from "@/pages/Incidents";
import SpotReports from "@/pages/SpotReports";
import Reports from "@/pages/Reports";
import StrikesBackfill from "@/pages/StrikesBackfill";
import Protests from "@/pages/Protests";
import CountryReport from "@/pages/CountryReport";

// ---------------------------------------------------------------------------
// In-memory store backing the mocked network layer.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
let incidents: Row[] = [];
let spotReports: Row[] = [];
let reports: Row[] = [];
let strikes: Row[] = [];
let socialWatch: Row[] = [];
let socialRaw: Row[] = [];
let nextId = 1;
// CountryReport baseline-retire flow: the curated baseline (null once retired)
// and a counter of how many times the baseline GET is hit — the counter rising
// after the DELETE proves the retire handler invalidated the baseline query and
// it refetched (the regression being guarded).
let countryBaseline: Row | null = null;
let baselineGetCount = 0;

function jsonResponse(body: unknown, status = 200) {
  const text = body === undefined || body === null ? "" : JSON.stringify(body);
  const headers = new Headers();
  if (text) headers.set("content-type", "application/json");
  else headers.set("content-length", "0");
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 204 ? "No Content" : "OK",
    url: "",
    headers,
    // `custom-fetch` treats `body === null` as "no content"; give a non-null
    // sentinel when there is a payload so it parses `text()`.
    body: text ? {} : null,
    text: async () => text,
    json: async () => JSON.parse(text),
    blob: async () => text,
  } as unknown as Response;
}

function installFetch() {
  (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(
    async (input: unknown, init?: { method?: string; body?: string }) => {
      const url = typeof input === "string" ? input : String((input as { url: string }).url);
      const method = (init?.method ?? "GET").toUpperCase();
      const path = url.split("?")[0];

      if (path === "/api/incidents" && method === "GET") {
        return jsonResponse(incidents);
      }
      if (path === "/api/incidents" && method === "POST") {
        const data = JSON.parse(init?.body ?? "{}") as Row;
        const row: Row = {
          id: nextId++,
          displayTitle: null,
          analystNotes: null,
          location: null,
          corroborations: [],
          ...data,
        };
        incidents = [row, ...incidents];
        return jsonResponse(row, 201);
      }
      const incDel = path.match(/^\/api\/incidents\/(\d+)$/);
      if (incDel && method === "DELETE") {
        const id = Number(incDel[1]);
        incidents = incidents.filter((i) => i.id !== id);
        return jsonResponse(null, 204);
      }

      if (path === "/api/spot-reports" && method === "GET") {
        return jsonResponse(spotReports);
      }
      const srDel = path.match(/^\/api\/spot-reports\/(\d+)$/);
      if (srDel && method === "DELETE") {
        const id = Number(srDel[1]);
        spotReports = spotReports.filter((s) => s.id !== id);
        return jsonResponse(null, 204);
      }

      // Reports list + create + delete (the Reports page also reads the
      // dashboard overview to clamp draft card dates).
      if (path === "/api/dashboard/overview" && method === "GET") {
        return jsonResponse({ topicCards: [] });
      }
      if (path === "/api/reports" && method === "GET") {
        return jsonResponse(reports);
      }
      if (path === "/api/reports" && method === "POST") {
        const data = JSON.parse(init?.body ?? "{}") as Row;
        const row: Row = { id: nextId++, author: null, hardNumbers: null, ...data };
        reports = [row, ...reports];
        return jsonResponse(row, 201);
      }
      const repDel = path.match(/^\/api\/reports\/(\d+)$/);
      if (repDel && method === "DELETE") {
        const id = Number(repDel[1]);
        reports = reports.filter((r) => r.id !== id);
        return jsonResponse(null, 204);
      }

      // Strikes list + create (Run Backfill screen).
      if (path === "/api/strikes" && method === "GET") {
        return jsonResponse(strikes);
      }
      if (path === "/api/strikes" && method === "POST") {
        const data = JSON.parse(init?.body ?? "{}") as Row;
        const row: Row = { id: nextId++, location: null, summary: null, ...data };
        strikes = [row, ...strikes];
        return jsonResponse(row, 201);
      }

      // Social Watch + Facebook OSINT boards (Protests page) + the Promote
      // action that mints a back-linked incident.
      if (path === "/api/social-watch" && method === "GET") {
        return jsonResponse(socialWatch);
      }
      if (path === "/api/social-raw" && method === "GET") {
        return jsonResponse(socialRaw);
      }
      const swPromote = path.match(/^\/api\/social-watch\/(\d+)\/promote$/);
      if (swPromote && method === "POST") {
        const id = Number(swPromote[1]);
        const incidentId = nextId++;
        socialWatch = socialWatch.map((it) =>
          it.id === id ? { ...it, promotable: false, promotedIncidentId: incidentId } : it,
        );
        return jsonResponse({ incidentId });
      }

      // CountryReport page: report + baseline + supporting reads, and the
      // baseline DELETE behind the "Retire curated baseline" button.
      if (path === "/api/countries/testlandia" && method === "GET") {
        return jsonResponse({
          slug: "testlandia",
          name: "Testlandia",
          region: "Test Region",
          overview: "",
          trendSummary: "",
          implications: "",
          mapPlacement: "none",
          photoPlacement: "none",
          reportPhotos: [],
        });
      }
      if (path === "/api/countries/testlandia/baseline" && method === "GET") {
        baselineGetCount += 1;
        if (!countryBaseline) return jsonResponse({ error: "not found" }, 404);
        return jsonResponse(countryBaseline);
      }
      if (path === "/api/countries/testlandia/baseline" && method === "DELETE") {
        countryBaseline = null;
        return jsonResponse(null, 204);
      }
      if (path === "/api/countries/testlandia/prose" && method === "POST") {
        // Keep the AI-prose effect deterministic: report the engine as
        // unavailable so the page uses its template draft (no flakiness).
        return jsonResponse({ available: false });
      }
      if (path === "/api/sources" && method === "GET") {
        return jsonResponse([]);
      }
      if (path === "/api/reliefweb-reports" && method === "GET") {
        return jsonResponse([]);
      }

      return jsonResponse({ error: `unhandled ${method} ${path}` }, 404);
    },
  );
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeAll(() => {
  // jsdom is missing a few DOM APIs that Radix primitives touch on mount.
  if (!window.matchMedia) {
    // @ts-expect-error minimal stub
    window.matchMedia = () => ({
      matches: false,
      media: "",
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    });
  }
  // @ts-expect-error minimal stub
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // @ts-expect-error minimal stub
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  if (!Element.prototype.hasPointerCapture)
    Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture)
    Element.prototype.releasePointerCapture = () => {};
});

beforeEach(() => {
  incidents = [];
  spotReports = [];
  reports = [];
  strikes = [];
  socialWatch = [];
  socialRaw = [];
  countryBaseline = null;
  baselineGetCount = 0;
  nextId = 1;
  installFetch();
  // The delete buttons gate on a `confirm()` prompt — auto-accept it.
  window.confirm = jest.fn(() => true);
});

// Resolve a form input/textarea inside the open Add sheet by its label text.
function fieldInput(scope: HTMLElement, label: string): HTMLElement {
  const labelEl = within(scope).getByText(label);
  const el = labelEl.parentElement?.querySelector("input, textarea");
  if (!el) throw new Error(`No input found for field "${label}"`);
  return el as HTMLElement;
}

describe("same-screen mutation buttons refresh the visible list", () => {
  it("/incidents — creating an incident shows it in the list without a reload, deleting removes it", async () => {
    renderWithClient(<Incidents />);

    // Initial empty list loads from the mocked API.
    await screen.findByText("No incidents match.");

    // Open the Add sheet and fill the required fields (topic/severity/confidence
    // keep their defaults).
    fireEvent.click(screen.getByRole("button", { name: /add incident/i }));
    const dialog = await screen.findByRole("dialog");

    const title = `Test incident ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    fireEvent.change(fieldInput(dialog, "Title"), { target: { value: title } });
    fireEvent.change(fieldInput(dialog, "Country"), { target: { value: "Testlandia" } });
    fireEvent.change(fieldInput(dialog, "Summary"), {
      target: { value: "A representative same-screen create flow." },
    });

    fireEvent.click(within(dialog).getByRole("button", { name: /create incident/i }));

    // The new row must appear WITHOUT a manual reload — i.e. the create handler
    // invalidated the list query and it refetched.
    expect(await screen.findByText(title)).toBeTruthy();
    expect(incidents).toHaveLength(1);

    // Now delete it from the same screen — the row must disappear.
    const deleteBtn = screen.getByLabelText("Delete");
    fireEvent.click(deleteBtn);

    await waitFor(() => expect(screen.queryByText(title)).toBeNull());
    expect(incidents).toHaveLength(0);
  });

  it("/spot-reports — deleting a spot report removes its card without a reload", async () => {
    const title = `Spot report ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    spotReports = [
      {
        id: 1,
        title,
        status: "draft",
        severity: "high",
        reportDate: "2026-06-18",
        createdBy: "Analyst",
        linkedIncidentIds: [],
        exportHistory: [],
        city: "Testville",
        province: "Test Province",
        country: "Testlandia",
      },
    ];

    renderWithClient(<SpotReports />);

    // The seeded card loads from the mocked API.
    const heading = await screen.findByText(title);
    const card = heading.closest("div.group") as HTMLElement;
    expect(card).toBeTruthy();

    // The card's only <button> is the delete control (Links are <a>).
    fireEvent.click(within(card).getByRole("button"));

    // The card must disappear WITHOUT a manual reload.
    await waitFor(() => expect(screen.queryByText(title)).toBeNull());
    expect(await screen.findByText("No spot reports yet.")).toBeTruthy();
    expect(spotReports).toHaveLength(0);
  });

  it("/reports — deleting a report removes its card without a reload", async () => {
    reports = [
      {
        id: 1,
        title: "Test Report",
        topic: "shipping",
        status: "review",
        issueDate: "2026-06-18",
        author: "Analyst",
      },
    ];

    renderWithClient(<Reports />);

    // The seeded card loads — find it via its delete (Trash) button.
    const card = (await screen.findByText("Open Editor")).closest("div.group") as HTMLElement;
    expect(card).toBeTruthy();

    // Inside the card the only <button> is the delete control (Links are <a>).
    fireEvent.click(within(card).getByRole("button"));

    // The card must disappear WITHOUT a manual reload.
    await waitFor(() => expect(screen.queryByText("Open Editor")).toBeNull());
    expect(await screen.findByText("No reports match.")).toBeTruthy();
    expect(reports).toHaveLength(0);
  });

  it("/strikes — recording a strike shows it in 'Recently Added' without a reload", async () => {
    renderWithClient(<StrikesBackfill />);

    // The empty recent list loads from the mocked API.
    await screen.findByText("No strikes recorded.");

    // Country is the only required field without a default; fill it uniquely.
    const country = `Strikeland ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    fireEvent.change(fieldInput(document.body, "Country"), { target: { value: country } });

    fireEvent.click(screen.getByRole("button", { name: /record strike/i }));

    // The new strike must appear in "Recently Added" WITHOUT a manual reload —
    // i.e. the create handler invalidated the list query and it refetched.
    expect(await screen.findByText(new RegExp(country))).toBeTruthy();
    expect(strikes).toHaveLength(1);
  });

  it("/protests — promoting a Social Watch post flips the row without a reload", async () => {
    socialWatch = [
      {
        id: 1,
        platform: "telegram",
        status: "active",
        caption: "Test mobilisation caption",
        url: null,
        promotable: true,
        promotedIncidentId: null,
        alertReasons: [],
        city: "Jakarta",
        location: "Jakarta",
      },
    ];

    renderWithClient(<Protests />);

    // The promotable row loads and shows a live "Promote" button.
    const promoteBtn = await screen.findByRole("button", { name: /^promote$/i });
    fireEvent.click(promoteBtn);

    // After a successful promote the board must refetch (invalidate) so the row
    // flips to its back-linked "Incident #N" state WITHOUT a manual reload.
    expect(await screen.findByText(/Incident #\d+/)).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^promote$/i })).toBeNull(),
    );
    expect(socialWatch[0].promotedIncidentId).not.toBeNull();
  });

  it("/countries/:slug — retiring a curated baseline refetches the baseline so the report falls back to live data without a reload", async () => {
    // Seed a curated baseline carrying a distinctive watchlist label so we can
    // see it surface in the editor and then disappear once retired.
    const watchLabel = `Testograd Province ${Date.now()}`;
    countryBaseline = {
      operatingEnvironment: "Curated operating note.",
      securityContext: "Curated security context.",
      knownRiskAreas: [],
      keyCitiesProvinces: [],
      movementConstraints: "",
      infrastructureLimits: "",
      medicalEvac: "",
      resourceSectorExposure: "",
      locationWatchlist: [{ label: watchLabel, note: "Seeded watch entry", match: ["testograd"] }],
    };

    renderWithClient(<CountryReport />);

    // Enter edit mode — the "Country Baseline" editor (with the Retire button)
    // only renders while editing.
    fireEvent.click(await screen.findByRole("button", { name: /^edit$/i }));

    // The seeded baseline loaded and its watchlist label shows in the editor.
    expect(await screen.findByDisplayValue(watchLabel)).toBeTruthy();
    const callsBeforeRetire = baselineGetCount;
    expect(callsBeforeRetire).toBeGreaterThan(0);

    // Click "Retire curated baseline" (the confirm() prompt is auto-accepted).
    fireEvent.click(screen.getByRole("button", { name: /retire curated baseline/i }));

    // The DELETE must fire AND the baseline GET must refetch (invalidateQueries
    // on getGetCountryBaselineQueryKey) — without that refetch the report would
    // keep serving the stale curated baseline until a manual reload.
    await waitFor(() => expect(baselineGetCount).toBeGreaterThan(callsBeforeRetire));
    expect(countryBaseline).toBeNull();

    // The report reflects the cleared baseline: the curated watchlist label is
    // gone from the screen.
    await waitFor(() => expect(screen.queryByDisplayValue(watchLabel)).toBeNull());
  });
});
