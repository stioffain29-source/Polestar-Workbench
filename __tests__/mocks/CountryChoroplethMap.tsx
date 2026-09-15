export const CHOROPLETH_COUNTRY_ALIASES: Record<string, string> = {
  "United Arab Emirates": "UAE",
};

export function buildCountryIntensity(
  rows: Array<{ country: string; count: number }>,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const { country, count } of rows) {
    if (!country) continue;
    const name = CHOROPLETH_COUNTRY_ALIASES[country] ?? country;
    result.set(name, (result.get(name) ?? 0) + count);
  }
  return result;
}

export default function CountryChoroplethMapStub() {
  return null;
}