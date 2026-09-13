import type { TopicFastFactsIncident } from "./topicFastFacts";
import { deriveIncidentCountry } from "./shippingCountry";

// Market-wide marine-fuel and refining coverage often carries a publisher
// country, exchange city or incidental country mention. Those are not event
// geography. Keep the scope and subject tests separate so normal variants
// such as "international ship-fuel markets" and "regional fuel availability"
// receive the same treatment as "global marine-fuel prices".
const GENERIC_FUEL_SCOPE_RE =
  /\b(?:global(?:ly)?|worldwide|international(?:ly)?|regional(?:ly)?|across (?:the )?region|around the world|world market|global market|international market|major shipping routes|international bunkering)\b/i;
const GENERIC_FUEL_SUBJECT_RE =
  /\b(?:marine[- ]fuel|ship[- ]fuel|bunker(?: fuel)?|fuel market|fuel supply|fuel availability|fuel shortage|refin(?:ery|ing)|refiner(?:y|s)?|fuel prices?|crude prices?|oil market|product markets?)\b/i;
const CONCRETE_FUEL_SITE_EVENT_RE =
  /\b(?:refiner(?:y|ies)|terminal|depot|pipeline|plant|facility|port|loading berth)\b[^.!?]{0,60}\b(?:fire|attack|strike|explosion|blast|outage|shutdown|closure|offline|damaged|halt(?:ed)?|blocked|disrupt(?:ed|ion)?)\b|\b(?:fire|attack|strike|explosion|blast|outage|shutdown|closure|offline|damaged|halt(?:ed)?|blocked|disrupt(?:ed|ion)?)\b[^.!?]{0,60}\b(?:refiner(?:y|ies)|terminal|depot|pipeline|plant|facility|port|loading berth)\b/i;

/** True when the text frames fuel as a market-wide or regional development. */
export function isGenericFuelScopeText(text: string): boolean {
  return GENERIC_FUEL_SCOPE_RE.test(text) && GENERIC_FUEL_SUBJECT_RE.test(text);
}

export function isConcreteFuelSiteEventText(text: string): boolean {
  return CONCRETE_FUEL_SITE_EVENT_RE.test(text);
}

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
  const hasShippingSemantic =
    incident.topic === "shipping" &&
    Object.prototype.hasOwnProperty.call(incident, "maritimeSemantic");
  const derived = incident.topic === "shipping"
    ? deriveIncidentCountry(incident)
    : deriveIncidentCountry({
        country: incident.country,
        location: incident.location,
        title: incident.title,
        summary: incident.summary,
      });
  if (!derived) return null;
  // Semantic shipping evidence is already an event-location decision.  Do
  // not second-guess an explicit semantic country with the generic-market
  // safeguard below.
  if (hasShippingSemantic) return derived;

  const eventText = `${incident.title ?? ""} ${incident.summary ?? ""}`;
  if (
    isGenericFuelScopeText(eventText) &&
    !isConcreteFuelSiteEventText(eventText)
  ) {
    return null;
  }
  return derived;
}