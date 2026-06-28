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
 *   - /incidents  : create then delete an incident, asserting the list updates.
 *   - /spot-reports: delete a spot report, asserting the card disappears.
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
  Link: ({ children, href }: { children: React.ReactNode; href?: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import Incidents from "@/pages/Incidents";
import SpotReports from "@/pages/SpotReports";

// ---------------------------------------------------------------------------
// In-memory store backing the mocked network layer.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
let incidents: Row[] = [];
let spotReports: Row[] = [];
let nextId = 1;

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
});
