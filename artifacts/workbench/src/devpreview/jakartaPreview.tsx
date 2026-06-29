import { createRoot } from "react-dom/client";
import "../index.css";
import JakartaCorridorMap from "@/components/JakartaCorridorMap";
import type { CountryFastFactsIncident } from "@/lib/countryFastFacts";

// Temporary dev-only preview of the redesigned Jakarta exposure map. Not part of
// the app; created to show a representative sample, deleted after review.
const SAMPLE: CountryFastFactsIncident[] = [
  {
    id: 1,
    title: "Large demonstration outside ministry in Menteng, Central Jakarta",
    severity: "high",
    occurredAt: "2026-06-26T03:00:00.000Z",
    location: "Menteng, Central Jakarta",
  },
  {
    id: 2,
    title: "Container backlog and tidal flooding at Tanjung Priok port",
    severity: "moderate",
    occurredAt: "2026-06-25T02:00:00.000Z",
    location: "Tanjung Priok, North Jakarta",
  },
  {
    id: 3,
    title: "Robbery near office towers in SCBD, Sudirman",
    severity: "moderate",
    occurredAt: "2026-06-24T10:00:00.000Z",
    location: "SCBD, South Jakarta",
  },
  {
    id: 4,
    title: "Toll-route congestion delays transfers to Soekarno-Hatta airport",
    severity: "low",
    occurredAt: "2026-06-24T22:00:00.000Z",
    location: "Soekarno-Hatta corridor",
  },
  {
    id: 5,
    title: "Heavy rain floods commuter routes across Bekasi",
    severity: "moderate",
    occurredAt: "2026-06-23T20:00:00.000Z",
    location: "Bekasi, Greater Jakarta",
  },
  {
    id: 6,
    title: "Gridlock on JORR outer ring road during evening peak",
    severity: "low",
    occurredAt: "2026-06-23T11:00:00.000Z",
    location: "JORR toll road",
  },
];

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <div
      style={{
        maxWidth: 900,
        margin: "24px auto",
        padding: "0 16px",
        fontFamily: "Roboto, sans-serif",
      }}
    >
      <JakartaCorridorMap incidents={SAMPLE} issueDate="2026-06-28" />
    </div>,
  );
}
