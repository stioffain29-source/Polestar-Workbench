export type IncidentMapFallback = {
  latitude: number;
  longitude: number;
  location: string;
};

const COUNTRY_CAPITALS: Record<string, IncidentMapFallback> = {
  Australia: { latitude: -35.28, longitude: 149.13, location: "Canberra (capital fallback)" },
  Bangladesh: { latitude: 23.81, longitude: 90.41, location: "Dhaka (capital fallback)" },
  Cambodia: { latitude: 11.56, longitude: 104.93, location: "Phnom Penh (capital fallback)" },
  China: { latitude: 39.9, longitude: 116.41, location: "Beijing (capital fallback)" },
  India: { latitude: 28.61, longitude: 77.21, location: "New Delhi (capital fallback)" },
  Indonesia: { latitude: -6.21, longitude: 106.85, location: "Jakarta (capital fallback)" },
  Japan: { latitude: 35.68, longitude: 139.69, location: "Tokyo (capital fallback)" },
  Laos: { latitude: 17.98, longitude: 102.63, location: "Vientiane (capital fallback)" },
  Malaysia: { latitude: 3.14, longitude: 101.69, location: "Kuala Lumpur (capital fallback)" },
  Myanmar: { latitude: 19.76, longitude: 96.08, location: "Naypyidaw (capital fallback)" },
  Nepal: { latitude: 27.72, longitude: 85.32, location: "Kathmandu (capital fallback)" },
  "New Zealand": { latitude: -41.29, longitude: 174.78, location: "Wellington (capital fallback)" },
  Pakistan: { latitude: 33.69, longitude: 73.04, location: "Islamabad (capital fallback)" },
  "Papua New Guinea": { latitude: -9.44, longitude: 147.18, location: "Port Moresby (capital fallback)" },
  Philippines: { latitude: 14.6, longitude: 120.98, location: "Manila (capital fallback)" },
  Singapore: { latitude: 1.29, longitude: 103.85, location: "Singapore (capital fallback)" },
  "South Korea": { latitude: 37.57, longitude: 126.98, location: "Seoul (capital fallback)" },
  "Sri Lanka": { latitude: 6.89, longitude: 79.92, location: "Sri Jayawardenepura Kotte (capital fallback)" },
  Taiwan: { latitude: 25.03, longitude: 121.57, location: "Taipei (capital fallback)" },
  Thailand: { latitude: 13.76, longitude: 100.5, location: "Bangkok (capital fallback)" },
  Vietnam: { latitude: 21.03, longitude: 105.85, location: "Hanoi (capital fallback)" },
  "West Papua": { latitude: -2.53, longitude: 140.72, location: "Jayapura (regional-capital fallback)" },
  Bahrain: { latitude: 26.23, longitude: 50.59, location: "Manama (capital fallback)" },
  Iran: { latitude: 35.69, longitude: 51.39, location: "Tehran (capital fallback)" },
  Iraq: { latitude: 33.31, longitude: 44.37, location: "Baghdad (capital fallback)" },
  Israel: { latitude: 31.78, longitude: 35.22, location: "Jerusalem (capital fallback)" },
  Jordan: { latitude: 31.95, longitude: 35.93, location: "Amman (capital fallback)" },
  Kuwait: { latitude: 29.38, longitude: 47.99, location: "Kuwait City (capital fallback)" },
  Lebanon: { latitude: 33.89, longitude: 35.5, location: "Beirut (capital fallback)" },
  Oman: { latitude: 23.59, longitude: 58.41, location: "Muscat (capital fallback)" },
  Qatar: { latitude: 25.29, longitude: 51.53, location: "Doha (capital fallback)" },
  "Saudi Arabia": { latitude: 24.71, longitude: 46.68, location: "Riyadh (capital fallback)" },
  Syria: { latitude: 33.51, longitude: 36.29, location: "Damascus (capital fallback)" },
  UAE: { latitude: 24.45, longitude: 54.38, location: "Abu Dhabi (capital fallback)" },
  "United Arab Emirates": { latitude: 24.45, longitude: 54.38, location: "Abu Dhabi (capital fallback)" },
  Yemen: { latitude: 15.37, longitude: 44.19, location: "Sanaa (capital fallback)" },
};

const AUSTRALIAN_STATE_CAPITALS: Array<[RegExp, IncidentMapFallback]> = [
  [/\b(new south wales|\bnsw\b)\b/i, { latitude: -33.87, longitude: 151.21, location: "Sydney (state-capital fallback)" }],
  [/\b(victoria|\bvic\b)\b/i, { latitude: -37.81, longitude: 144.96, location: "Melbourne (state-capital fallback)" }],
  [/\b(queensland|\bqld\b)\b/i, { latitude: -27.47, longitude: 153.03, location: "Brisbane (state-capital fallback)" }],
  [/\b(western australia|\bwa\b)\b/i, { latitude: -31.95, longitude: 115.86, location: "Perth (state-capital fallback)" }],
  [/\b(south australia|\bsa\b)\b/i, { latitude: -34.93, longitude: 138.6, location: "Adelaide (state-capital fallback)" }],
  [/\b(tasmania|\btas\b)\b/i, { latitude: -42.88, longitude: 147.33, location: "Hobart (state-capital fallback)" }],
  [/\b(northern territory|\bnt\b)\b/i, { latitude: -12.46, longitude: 130.84, location: "Darwin (territory-capital fallback)" }],
  [/\b(australian capital territory|\bact\b)\b/i, { latitude: -35.28, longitude: 149.13, location: "Canberra (territory-capital fallback)" }],
];

export function incidentMapFallback(country: string, text = ""): IncidentMapFallback | null {
  const primary = country.split(";")[0]?.trim() || country.trim();
  if (primary === "Australia") {
    const regional = AUSTRALIAN_STATE_CAPITALS.find(([pattern]) => pattern.test(text));
    if (regional) return regional[1];
  }
  return COUNTRY_CAPITALS[primary] ?? COUNTRY_CAPITALS[country.trim()] ?? null;
}