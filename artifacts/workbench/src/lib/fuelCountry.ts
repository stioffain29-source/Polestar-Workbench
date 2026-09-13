import type { TopicFastFactsIncident } from "./topicFastFacts";
import { deriveIncidentCountry } from "./shippingCountry";

/**
 * Fuel Watch consumes fuel, energy-continuity and bounded shipping cross-read
 * records. Only shipping records may let maritimeSemantic suppress ordinary
 * geography inference. API objects include maritimeSemantic: null on every
 * topic, so passing a Fuel record through the shipping-only null branch would
 * erase otherwise valid country evidence.
 */
export function deriveFuelIncidentCountry(
  incident: TopicFastFactsIncident,
): string | null {
  if (incident.topic === "shipping") {
    return deriveIncidentCountry(incident);
  }
  return deriveIncidentCountry({
    country: incident.country,
    location: incident.location,
    title: incident.title,
    summary: incident.summary,
  });
}