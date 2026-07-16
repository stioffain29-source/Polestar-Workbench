import { isPreparednessDrill } from "../../artifacts/workbench/src/lib/countryMatch";

// Preparedness DRILLS / exercises / simulations are non-events, but the hazard
// word that names them ("active shooter", "fire", "earthquake") drives severity,
// so they leaked into a country / city brief's crime / hazard themes and even
// surfaced as the "most serious reported" incident though nothing happened. The
// guard drops a record whose text pairs a hazard / security cue with a drill /
// exercise / simulation noun. A real casualty / violence signal VETOES the drop
// (a genuine attack that merely mentions a drill is kept). No-fabrication: it
// only removes non-events, it never invents or up-rates anything.

// Preparedness non-events that MUST be dropped.
const DROP = [
  "DepEd pilots \u2018active shooter\u2019 drill in Manila campus",
  "Psychologist cautions DepEd on active shooter drills",
  "Fire drill held at SM mall in Cebu",
  "Nationwide earthquake drill conducted in schools",
  "Tsunami evacuation exercise in coastal towns",
  "Terror drill staged at Ninoy Aquino airport",
  "Lockdown drill tests campus response",
  "Disaster preparedness simulation staged in Davao",
];

// Real incidents / non-drill records that MUST be kept.
const KEEP = [
  // Oil / gas "drilling" is never a preparedness drill.
  "Oil drilling rig explosion off the coast injures crew",
  "Exploratory drilling begins in offshore block A",
  // A bare military "exercise" carries no hazard/security cue before it.
  "Balikatan military exercise with US troops begins",
  // Violence veto: an actual attack that merely mentions a drill.
  "Gunman opens fire during fire drill, three killed",
  "Active shooter kills two at campus before police respond",
  // No drill noun at all.
  "Bomb blast in Pattani market wounds three",
  "Protest in the capital over fuel prices",
];

describe("isPreparednessDrill", () => {
  it.each(DROP)("drops the preparedness non-event: %s", (text) => {
    expect(isPreparednessDrill(text)).toBe(true);
  });

  it.each(KEEP)("keeps the real / non-drill record: %s", (text) => {
    expect(isPreparednessDrill(text)).toBe(false);
  });

  it("never fires on empty / nullish input", () => {
    expect(isPreparednessDrill("")).toBe(false);
    expect(isPreparednessDrill(null)).toBe(false);
    expect(isPreparednessDrill(undefined)).toBe(false);
  });
});
