import { createRoot } from "react-dom/client";
import "../index.css";
import JakartaCorridorMap from "@/components/JakartaCorridorMap";
import type { CountryFastFactsIncident } from "@/lib/countryFastFacts";

// Temporary dev-only preview of the redesigned Jakarta exposure map. Not part of
// the app; created to show a representative sample, deleted after review.
const SAMPLE: CountryFastFactsIncident[] = [
  {
    id: 1,
    topic: "flashpoint",
    title: "Large demonstration outside ministry in Menteng, Central Jakarta",
    severity: "high",
    occurredAt: "2026-06-26T03:00:00.000Z",
    location: "Menteng, Central Jakarta",
  },
  {
    id: 2,
    topic: "shipping",
    title: "Container backlog and tidal flooding at Tanjung Priok port",
    severity: "moderate",
    occurredAt: "2026-06-25T02:00:00.000Z",
    location: "Tanjung Priok, North Jakarta",
  },
  {
    id: 3,
    topic: "flashpoint",
    title: "Robbery near office towers in SCBD, Sudirman",
    severity: "moderate",
    occurredAt: "2026-06-24T10:00:00.000Z",
    location: "SCBD, South Jakarta",
  },
  {
    id: 4,
    topic: "flashpoint",
    title: "Protest march disrupts Grogol, West Jakarta",
    severity: "moderate",
    occurredAt: "2026-06-24T22:00:00.000Z",
    location: "Grogol, West Jakarta",
  },
  {
    id: 5,
    topic: "flashpoint",
    title: "Brief gathering near Jatinegara market, East Jakarta",
    severity: "low",
    occurredAt: "2026-06-23T20:00:00.000Z",
    location: "Jatinegara, East Jakarta",
  },
  {
    id: 6,
    topic: "flashpoint",
    title: "Heavy rain floods commuter routes across Bekasi",
    severity: "moderate",
    occurredAt: "2026-06-23T11:00:00.000Z",
    location: "Bekasi, Greater Jakarta",
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
