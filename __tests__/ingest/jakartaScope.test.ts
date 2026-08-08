import { isJakartaScoped } from "../../lib/ingest/src/jakartaExtract";

// Regression: a Papua conflict/insurgency story that merely mentions "Jakarta"
// (the national government/military responding) must NOT be pulled into the
// Jakarta CITY brief. Indonesian Papua is deliberately excluded from
// INDONESIA_PROVINCE_BY_CITY (it has its own West Papua brief), so the
// competing-locality list that guards the bare-"jakarta" fallback previously
// had no way to know a Papua mention should block it.
describe("isJakartaScoped — Papua out-of-region guard", () => {
  it("excludes a Papua separatist story that also mentions Jakarta", () => {
    const title = "Indonesian Forces Hunt Papua Separatists After Four Road Workers Killed";
    const summary =
      "Jakarta has ordered additional troops to Papua after separatists killed four road workers in the highlands.";
    expect(isJakartaScoped(title, summary, null)).toBe(false);
  });

  it("excludes a bare 'West Papua' mention alongside Jakarta", () => {
    const title = "West Papua unrest: Jakarta weighs response after ambush";
    const summary = "Officials in Jakarta are reviewing security options after the attack in West Papua.";
    expect(isJakartaScoped(title, summary, null)).toBe(false);
  });

  it("excludes a specific Papua province name (Papua Tengah) alongside Jakarta", () => {
    const title = "Jakarta sends reinforcements to Papua Tengah after clash";
    const summary = "The deployment was ordered from Jakarta following the incident in Papua Tengah.";
    expect(isJakartaScoped(title, summary, null)).toBe(false);
  });

  it("still scopes in a genuine bare-Jakarta mention with no competing locality", () => {
    const title = "Jakarta braces for heavier rain this week";
    const summary = "Forecasters in Jakarta warned of flooding risk across low-lying districts.";
    expect(isJakartaScoped(title, summary, null)).toBe(true);
  });

  it("still scopes in a named Jakarta district regardless of unrelated text", () => {
    const title = "Fire breaks out in Cikini building";
    const summary = "No fatalities were reported in the Central Jakarta blaze.";
    expect(isJakartaScoped(title, summary, null)).toBe(true);
  });
});
