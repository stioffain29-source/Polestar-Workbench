const suppliedAt = new Date("2026-09-20T00:00:00Z");

function row(
  key: string,
  eventDate: string,
  country: string,
  city: string,
  venue: string,
  description: string,
  startTime: string,
  status: "Planned" | "Possible" = "Planned",
  source?: {
    name: string;
    title: string;
    url: string;
  },
) {
  return {
    sourceName: source?.name ?? "analyst_schedule_upload",
    sourceUrl: source?.url ?? "",
    sourceTitle: source?.title ?? description,
    sourcePublishedAt: suppliedAt,
    eventDate: new Date(`${eventDate}T00:00:00Z`),
    country,
    city,
    venue,
    eventType: "Protest",
    issue: null,
    organiser: null,
    description,
    startTime,
    attendance: null,
    disruptionPotential: "High",
    confidence: status === "Possible" ? "Moderate" : "High",
    status,
    collectedAt: suppliedAt,
    searchCompletedAt: suppliedAt,
    dedupKey: `analyst_schedule_sep2026_update_${key}`,
  };
}

/** Concise forward schedule supplied by the owner on 20 September 2026. */
export const SEPTEMBER_2026_PROTEST_SCHEDULE_UPDATE = [
  row(
    "philippines_manila_21",
    "2026-09-21",
    "Philippines",
    "Manila",
    "Central Manila and EDSA",
    "Martial Law anniversary demonstrations and a transport strike. More than 17,000 police personnel are deployed nationwide, including 8,553 NCRPO personnel in Metro Manila.",
    "From 00:01",
    "Planned",
    {
      name: "Philippine Daily Inquirer",
      title: "PNP on alert as protests commemorate martial law",
      url: "https://newsinfo.inquirer.net/2308558/pnp-on-alert-as-protests-commemorate-martial-law",
    },
  ),
  row(
    "pakistan_islamabad_21",
    "2026-09-21",
    "Pakistan",
    "Islamabad",
    "Approaches to Islamabad",
    "Jamaat-e-Islami fuel-levy march toward the capital.",
    "Ongoing",
  ),
  row(
    "indonesia_jakarta_24",
    "2026-09-24",
    "Indonesia",
    "Jakarta",
    "Central Jakarta",
    "National Farmers Day, Semanggi II and Black September demonstrations.",
    "TBC",
  ),
  row(
    "indonesia_jakarta_kspsi_24",
    "2026-09-24",
    "Indonesia",
    "Jakarta",
    "MH Thamrin–Bundaran HI",
    "Conditional KSPSI Employment Bill labour demonstration.",
    "TBC",
    "Possible",
  ),
  row(
    "pakistan_islamabad_27",
    "2026-09-27",
    "Pakistan",
    "Islamabad",
    "Islamabad and nationwide",
    "PTI nationwide protest and long march to Islamabad.",
    "TBC",
  ),
] as const;