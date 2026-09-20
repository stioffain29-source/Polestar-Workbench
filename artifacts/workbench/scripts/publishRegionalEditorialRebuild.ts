import { writeFileSync } from "node:fs";
import pg from "../../../lib/db/node_modules/pg/esm/index.mjs";

const connectionString = process.env.PROD_DATABASE_URL?.trim();
if (!connectionString) throw new Error("PROD_DATABASE_URL is required");

type Topic = "apac_weekly" | "middle_east_weekly";
type Severity = "Low" | "Moderate" | "High" | "Extreme";
type Development = {
  country: string;
  location: string;
  eventDate: string;
  dateVerified: true;
  title: string;
  severity: Severity;
  category: string;
  whatChanged: string;
  operationalSignificance: string;
  operationalImpact: string;
  polestarView: string;
  whatToWatch: string;
  outlook7Days: string;
  watchDate: null;
  sourceCount: number;
  evidenceIds: number[];
  sourceEvidence: string[];
};

const sourceNames = (rows: Array<{ id: number; source: string | null }>, ids: number[]) =>
  [...new Set(rows.filter((row) => ids.includes(row.id)).map((row) => row.source).filter(Boolean))] as string[];

const development = (
  rows: Array<{ id: number; source: string | null }>,
  value: Omit<Development, "dateVerified" | "watchDate" | "sourceCount" | "sourceEvidence">,
): Development => ({
  ...value,
  dateVerified: true,
  watchDate: null,
  sourceCount: value.evidenceIds.length,
  sourceEvidence: sourceNames(rows, value.evidenceIds),
});

const mapPoint = (
  row: Development,
  lat: number,
  lng: number,
) => ({
  lat,
  lng,
  severity: row.severity,
  title: row.title,
  label: row.location,
  summary: row.whatChanged,
  eventDate: row.eventDate,
});

const buildCanonical = (
  topic: Topic,
  rows: Array<{ id: number; source: string | null }>,
  coverageManifest: unknown,
) => {
  const apac = topic === "apac_weekly";
  const developments: Development[] = apac
    ? [
      development(rows, {
        country: "Pakistan",
        location: "Kohat, Khyber Pakhtunkhwa",
        eventDate: "2026-09-18",
        title: "Mass-casualty attack at Kohat police headquarters",
        severity: "Extreme",
        category: "Terrorism",
        whatChanged: "A bombing and armed attack struck a police headquarters in Kohat on 18 September. Later reporting put the death toll at 31, including police personnel.",
        operationalSignificance: "The immediate commercial exposure is localised, but the casualty level and attack on a hardened security site raise the likelihood of checkpoints, counter-terrorism activity and tighter access around government facilities in Khyber Pakhtunkhwa.",
        operationalImpact: "Journey management and route planning around police, military and government sites in Kohat and wider Khyber Pakhtunkhwa require closer control.",
        polestarView: "This was the region's highest-consequence security event of the week. It does not establish uniform deterioration across Pakistan, but it materially raises the local operating threshold around official sites and approach roads.",
        whatToWatch: "Further attacks on security facilities, checkpoints, road restrictions, counter-terrorism operations and official travel advisories.",
        outlook7Days: "Watch for follow-on attacks, security cordons, road restrictions and confirmed changes to the casualty or access picture.",
        evidenceIds: [77431, 77229, 77432, 78296, 78429, 78933],
      }),
      development(rows, {
        country: "Thailand",
        location: "Narathiwat",
        eventDate: "2026-09-18",
        title: "Bomb and shooting attack on defence volunteers",
        severity: "High",
        category: "Terrorism",
        whatChanged: "Attackers detonated a bomb and opened fire on a vehicle carrying territorial defence volunteers in Sukhirin district, Narathiwat.",
        operationalSignificance: "The attack demonstrates continued insurgent capability to prepare complex roadside attacks against government movement in Thailand's Deep South.",
        operationalImpact: "Personnel and contractors using rural roads in Narathiwat face a route-specific security exposure rather than a change to Thailand's national operating environment.",
        polestarView: "The combination of an explosive device and follow-on gunfire is more significant than a routine security incident. Controls should tighten on exposed routes without treating wider Thailand as disrupted.",
        whatToWatch: "Additional attacks on patrols or government transport, checkpoints, route closures and security operations in Narathiwat.",
        outlook7Days: "Track route advisories, checkpoints, security operations and further attacks against patrols or government-linked transport.",
        evidenceIds: [76897],
      }),
      development(rows, {
        country: "Philippines",
        location: "Cotabato City and BARMM",
        eventDate: "2026-09-14",
        title: "Election-period violence affects Cotabato and BARMM",
        severity: "High",
        category: "Political",
        whatChanged: "Election-related violence in and around Cotabato included a clash that killed three people and wounded 15, followed by further polling-day security incidents and investigations.",
        operationalSignificance: "The exposure is local political violence around polling locations, gatherings and factional competition, not a deterioration across the Philippines nationally.",
        operationalImpact: "Staff movement, venue access and local travel in Cotabato and other BARMM centres may be affected by political gatherings, checkpoints and short-notice security deployments.",
        polestarView: "The election proceeded, but the violence shows that disputes and local mobilisation can still produce armed confrontation after polling.",
        whatToWatch: "Election disputes, retaliatory violence, political gatherings, checkpoints and additional armed incidents across BARMM.",
        outlook7Days: "Monitor result disputes, political gatherings, security deployments and any displacement or retaliatory violence.",
        evidenceIds: [71937, 71934, 71935, 72059, 72796],
      }),
      development(rows, {
        country: "Australia",
        location: "National",
        eventDate: "2026-09-17",
        title: "Temporary migration and visa rules tighten",
        severity: "Moderate",
        category: "Regulatory",
        whatChanged: "The government announced tighter migration settings affecting international students, working-holiday arrangements and visa compliance. Implementation detail remains important.",
        operationalSignificance: "The change may affect recruitment, labour availability and compliance in agriculture, tourism, hospitality, education and other sectors that rely on temporary workers.",
        operationalImpact: "HR and mobility teams need to identify affected worker groups and distinguish announced policy from final effective rules before changing hiring assumptions.",
        polestarView: "This is a slower-moving workforce issue with broader commercial reach than the week's localised attacks. The operational effect will be determined by implementation guidance, exemptions and effective dates.",
        whatToWatch: "Formal guidance, effective dates, visa-condition text, exemptions, employer obligations and sector responses.",
        outlook7Days: "Watch for government implementation guidance, effective dates, exemptions and employer-facing compliance instructions.",
        evidenceIds: [74338, 74044, 74836, 75118, 76747],
      }),
      development(rows, {
        country: "Japan",
        location: "Western Pacific approach to Japan",
        eventDate: "2026-09-17",
        title: "Tropical Storm Dujuan creates a Japan transport watch",
        severity: "Moderate",
        category: "Weather & Natural Hazards",
        whatChanged: "Regional reporting tracked Tropical Storm Dujuan moving through the western Pacific toward Japan. The current evidence supports a weather watch, not a confirmed Kanto impact.",
        operationalSignificance: "A change in the official forecast track could affect aviation, rail, ferries, ports and road movement at short notice.",
        operationalImpact: "Travel and logistics teams should use official Japanese warnings and operator notices rather than the existence of the storm alone to trigger cancellations or rerouting.",
        polestarView: "Weather could become the most immediate continuity issue in the coming week if official warnings escalate, but the current evidence does not yet establish material disruption.",
        whatToWatch: "Japan Meteorological Agency warnings, track changes, flight and rail cancellations, port restrictions and evacuation advisories.",
        outlook7Days: "Track official storm forecasts and any resulting aviation, rail, ferry, port or road restrictions.",
        evidenceIds: [75347, 78107],
      }),
      development(rows, {
        country: "Indonesia",
        location: "Pulau Doi, North Maluku",
        eventDate: "2026-09-15",
        title: "Low-level earthquake activity near Pulau Doi",
        severity: "Low",
        category: "Weather & Natural Hazards",
        whatChanged: "Two reports recorded magnitude 4.4 and 3.7 earthquakes near Pulau Doi in North Maluku during the week. No material operating consequence was established.",
        operationalSignificance: "The current exposure is limited, but further seismic activity would matter for remote-site access, ports and local infrastructure.",
        operationalImpact: "No immediate operating change is justified without official damage, tsunami or access warnings.",
        polestarView: "This remains a hazard note rather than a key regional driver. It is included to distinguish monitored seismic activity from the stronger weather watch around Japan.",
        whatToWatch: "Further felt earthquakes, BMKG warnings, tsunami advisories and any infrastructure or port disruption.",
        outlook7Days: "Monitor BMKG notices and any evidence of damage, tsunami risk or access disruption.",
        evidenceIds: [72328, 72333],
      }),
    ]
    : [
      development(rows, {
        country: "Saudi Arabia",
        location: "Riyadh",
        eventDate: "2026-09-19",
        title: "Houthi missile attack raises Riyadh aviation exposure",
        severity: "High",
        category: "Armed Conflict",
        whatChanged: "The Saudi-led coalition said air defences intercepted a Houthi ballistic missile fired at Riyadh on 19 September. Smoke and flames were separately reported near the capital's international airport.",
        operationalSignificance: "The significance lies in the target: repeated alerts or a successful strike around Riyadh would affect aviation, executive travel, staff movement and continuity at the Kingdom's main commercial centre.",
        operationalImpact: "Travel and security teams need current airport, airspace and civil-defence information before moving personnel through Riyadh.",
        polestarView: "The absence of confirmed casualties does not make the event commercially irrelevant. The decision threshold is whether attempted attacks remain intermittent and intercepted or begin causing sustained airport or infrastructure disruption.",
        whatToWatch: "Further missile or drone launches, civil-defence alerts, airport operating status, airspace restrictions and confirmed damage.",
        outlook7Days: "Track repeat launches, airport restrictions, civil-defence warnings and verified effects on aviation or major infrastructure.",
        evidenceIds: [78688, 78686, 78704, 78991, 78972, 78977],
      }),
      development(rows, {
        country: "Saudi Arabia",
        location: "East-West pipeline and Yanbu",
        eventDate: "2026-09-12",
        title: "Pipeline disruption reduces Saudi export redundancy",
        severity: "High",
        category: "Energy",
        whatChanged: "Reports during the week continued to describe disruption to Saudi Arabia's East-West pipeline after an aerial attack, with concern around Yanbu loading and export resilience.",
        operationalSignificance: "The pipeline is a principal route for moving crude to the Red Sea while bypassing Hormuz. Reduced availability therefore concentrates exposure across fewer export routes.",
        operationalImpact: "Energy and logistics teams should verify pipeline status, Yanbu loading schedules and alternative capacity before changing cargo or inventory plans.",
        polestarView: "The business significance comes from lost redundancy, not only the damaged asset. Persistence would increase schedule, insurance and routing pressure even without a complete export halt.",
        whatToWatch: "Official repair and throughput updates, Yanbu loading activity, export schedule changes and further attacks.",
        outlook7Days: "Monitor verified repair progress, pipeline throughput, Yanbu loadings and changes to Saudi crude export schedules.",
        evidenceIds: [69778, 69762, 70436, 71677, 71686, 71945],
      }),
      development(rows, {
        country: "Iran",
        location: "Strait of Hormuz",
        eventDate: "2026-09-12",
        title: "Hormuz access remains politically and operationally constrained",
        severity: "Moderate",
        category: "Operational Disruption",
        whatChanged: "Regional reporting continued to describe restrictions, conditional access and navigation uncertainty around the Strait of Hormuz. The available evidence does not support a precise weekly transit count.",
        operationalSignificance: "Persistent uncertainty can still raise insurance, freight and schedule costs even when the strait is not fully closed.",
        operationalImpact: "Shipping teams should rely on verified vessel movements, insurer guidance and official navigation notices rather than political claims alone.",
        polestarView: "The material issue is degraded predictability, not a proven total closure. The assessment should strengthen only if independent movement data or operator notices show further deterioration.",
        whatToWatch: "Verified vessel transits, insurer guidance, shipping suspensions, port congestion and official navigation warnings.",
        outlook7Days: "Track independent vessel data, insurer notices, operator suspensions and changes to commercial access.",
        evidenceIds: [69768, 70088, 70091, 70093, 70439, 70441],
      }),
      development(rows, {
        country: "Yemen",
        location: "Red Sea coast and Bab el-Mandeb",
        eventDate: "2026-09-13",
        title: "Houthi coastal gains increase Bab el-Mandeb concern",
        severity: "Moderate",
        category: "Armed Conflict",
        whatChanged: "Reporting claimed Houthi advances along Yemen's Red Sea coast near Bab el-Mandeb. Available evidence is limited and does not yet establish a confirmed commercial-shipping disruption.",
        operationalSignificance: "If independently confirmed, greater coastal control could improve the group's ability to observe or threaten traffic through the southern Red Sea.",
        operationalImpact: "Maritime operators need official vessel warnings and verified movement data before treating territorial reporting as a change to route availability.",
        polestarView: "This is a strategically important watchpoint with lower evidential confidence than the Riyadh or pipeline developments. It should influence monitoring, not trigger unsupported closure assumptions.",
        whatToWatch: "UKMTO and official vessel warnings, verified attacks, insurer advisories, AIS changes and confirmed territorial-control updates.",
        outlook7Days: "Watch for independent confirmation of territorial changes and any resulting vessel threat or routing response.",
        evidenceIds: [69753, 71662],
      }),
      development(rows, {
        country: "United Arab Emirates",
        location: "National",
        eventDate: "2026-09-16",
        title: "Visa cancellations affect Bangladeshi workers and businesses",
        severity: "Moderate",
        category: "Regulatory",
        whatChanged: "Several reports said UAE visa cancellations affected almost 5,000 Bangladeshi nationals, creating uncertainty over existing permissions, savings and business activity.",
        operationalSignificance: "The immediate exposure is concentrated among affected nationals and employers rather than the wider UAE labour market.",
        operationalImpact: "HR and mobility teams need official guidance on affected visa classes, treatment of existing holders and employer obligations.",
        polestarView: "This is a targeted workforce and compliance issue. Its business significance depends on whether the measure is clarified, reversed or broadened to additional groups.",
        whatToWatch: "UAE and Bangladeshi official guidance, affected visa categories, treatment of existing holders and employer requirements.",
        outlook7Days: "Track official clarification of affected visa classes, existing permissions and employer obligations.",
        evidenceIds: [74267, 74269, 74271],
      }),
      development(rows, {
        country: "Syria",
        location: "Southern Syria",
        eventDate: "2026-09-18",
        title: "Israeli forces conduct another southern Syria incursion",
        severity: "Moderate",
        category: "Armed Conflict",
        whatChanged: "Israeli forces carried out a further ground incursion in southern Syria on 18 September, with reporting of military vehicles, home raids and aircraft activity.",
        operationalSignificance: "The immediate exposure is local military access and road disruption rather than a region-wide commercial constraint.",
        operationalImpact: "Movement near affected communities and routes in the south requires current local security and access information.",
        polestarView: "The event matters as evidence of repeated cross-border military activity, but the current reporting does not establish sustained closure of a major commercial route.",
        whatToWatch: "Repeat incursions, checkpoints, road closures, aircraft activity and movement toward commercial routes.",
        outlook7Days: "Monitor repeat incursions, new checkpoints, road closures and military activity extending toward commercial routes.",
        evidenceIds: [77551, 77552, 77557],
      }),
      development(rows, {
        country: "Yemen",
        location: "Yemen and Saudi border areas",
        eventDate: "2026-09-17",
        title: "Saudi-Houthi strike exchange drives civilian displacement",
        severity: "High",
        category: "Armed Conflict",
        whatChanged: "Reporting described Saudi and Houthi forces exchanging strikes as civilians fled affected areas in Yemen.",
        operationalSignificance: "Civilian displacement is evidence that the conflict is producing consequences beyond military targets and may increase pressure on local roads, services and border access.",
        operationalImpact: "Organisations with personnel, partners or supply movement in affected Yemeni areas need current displacement, access and security reporting.",
        polestarView: "Unlike strategic rhetoric alone, displacement indicates a realised operating consequence. The risk remains geographically concentrated but can broaden quickly through road restrictions or further strikes.",
        whatToWatch: "Further strikes, displacement, road or border restrictions and confirmed effects on ports or airports.",
        outlook7Days: "Track additional displacement, strike locations and any restrictions affecting roads, ports, airports or border access.",
        evidenceIds: [75996],
      }),
    ];

  const watchItems = developments
    .filter((row) => row.severity !== "Low")
    .slice(0, apac ? 4 : 5)
    .map((row) => ({
      date: "2026-09-27",
      location: row.location,
      trigger: row.title,
      whyItMatters: row.operationalImpact,
      whatToWatch: row.whatToWatch,
      currentSeverity: row.severity,
    }));

  const regionalOutlook = apac
    ? "APAC risk this week was driven by concentrated security and political violence rather than broad regional deterioration. The Kohat attack was the highest-consequence event, while the Narathiwat ambush and election-period violence in BARMM created separate, geographically bounded movement risks. Australia introduced a slower-moving workforce and compliance issue through tighter temporary-migration settings. Weather may become the most immediate continuity concern if Tropical Storm Dujuan prompts official transport restrictions around Japan. Lower-level earthquake activity in North Maluku did not establish a material operating consequence. The next seven days require the closest attention to security restrictions in Pakistan and southern Thailand, post-election mobilisation in BARMM, implementation detail in Australia and official storm warnings affecting Japan."
    : "Middle East risk this week was shaped by interacting security, energy and maritime pressures rather than one uniform regional trend. The attempted missile attack on Riyadh created an immediate aviation and personnel-security concern. Continued disruption to the Saudi East-West pipeline reduced export-route redundancy while Hormuz access remained uncertain and reporting of Houthi coastal gains increased concern around Bab el-Mandeb. These route pressures matter most if they combine. UAE visa cancellations created a separate workforce and compliance issue for affected Bangladeshi nationals and employers. Incursions in southern Syria and strike-driven displacement in Yemen remained geographically concentrated but demonstrated continued conflict spillover.";
  const riskPicture = apac
    ? "The week's APAC exposures operate on different timescales. Kohat, Narathiwat and Cotabato require immediate, location-specific controls around routes, official sites and political gatherings. None justifies a blanket regional security escalation. Australia's migration changes may move more slowly but reach a wider set of employers through recruitment, visa compliance and temporary-labour availability. Dujuan remains a forecast-driven continuity risk: aviation, rail, ferry and road decisions should follow official warnings rather than speculative storm coverage. North Maluku's earthquake activity remains a monitored hazard note unless damage or access restrictions emerge. The core management task is to separate acute local violence from broader workforce and weather exposures, then assign different triggers and owners to each."
    : "The week's Middle East exposures form one connected transport and continuity problem. Riyadh demonstrates that the aerial threat can reach a principal commercial and aviation centre. The East-West pipeline disruption matters because it reduces the alternative to Hormuz at the same time that access through the strait remains uncertain. Reporting from Bab el-Mandeb is less firmly established, but any independently confirmed increase in Houthi coastal capability would add pressure at the Red Sea end of the regional route system. Southern Syria and Yemen require local security controls; neither currently establishes a region-wide commercial closure. The UAE visa issue operates through a different channel and should be managed as a targeted workforce and compliance exposure.";
  const businessImplicationsNarrative = apac
    ? "The week does not justify a blanket increase in security posture across APAC. Pakistan, Narathiwat and parts of BARMM warrant tighter journey management, route verification and monitoring of local restrictions. Australian employers that rely on international students or working-holiday labour should identify exposed roles and wait for final implementation detail before changing workforce plans. Travel and logistics teams with activity in Japan should prepare decision thresholds for rail, aviation, ferry and road disruption if official storm warnings escalate. The North Maluku earthquakes require monitoring but no immediate operating change without evidence of damage or tsunami risk."
    : "The principal Middle East business issue is the interaction between security and logistics. Riyadh aerial threats, reduced Saudi pipeline redundancy, uncertainty at Hormuz and potential Houthi pressure around Bab el-Mandeb affect different parts of the same regional operating system. Companies dependent on Gulf and Red Sea routes should distinguish confirmed asset or navigation restrictions from political claims, while maintaining alternatives for time-critical cargo. Mobility teams should verify which UAE visa classes and existing permissions are affected before changing staffing or travel plans. Southern Syria and Yemen remain localised security exposures, but repeat incursions, displacement or access restrictions could broaden their operating effect.";
  const polestarOutlook = apac
    ? "The main APAC question over the next seven days is whether the week's serious security incidents remain geographically contained. Pakistan requires the closest security attention after the scale of the Kohat attack. Narathiwat reinforces a persistent route-security problem in Thailand's Deep South, while BARMM remains sensitive to post-election disputes and mobilisation. Weather could overtake security as the most immediate continuity issue if official warnings around Dujuan produce transport cancellations in Japan. Australia's migration announcement will matter through implementation rather than further political commentary. A broader regional risk change would require repeated violence affecting commercial nodes, binding workforce rules with demonstrated sector effects, or weather disruption across major transport systems."
    : "Middle East risk over the next seven days will depend first on whether attacks against Saudi Arabia remain intermittent and intercepted or begin causing sustained disruption to airports, energy infrastructure or population centres. The second concern is simultaneous pressure across Hormuz, Bab el-Mandeb and the Saudi East-West pipeline: deterioration across more than one route would reduce redundancy and increase freight, insurance and scheduling costs. Southern Syria and Yemen remain geographically concentrated, but repeat incursions, displacement or restrictions affecting commercial routes would justify stronger local controls. UAE visa cancellations should remain a targeted workforce issue unless official guidance broadens the affected categories.";

  const byCategory = [...new Set(developments.map((row) => row.category))].map((label) => ({
    label,
    count: developments.filter((row) => row.category === label).length,
  }));
  const byCountry = [...new Set(developments.map((row) => row.country))].map((label) => ({
    label,
    count: developments.filter((row) => row.country === label).length,
  }));

  return {
    schemaVersion: "regional-weekly-canonical-v1",
    topic,
    issueDate: "2026-09-20",
    developments,
    regionalOutlook,
    polestarOutlook,
    riskPicture,
    domainBriefs: byCategory.map(({ label }) => ({
      domain: label,
      heading: label,
      assessment: developments.filter((row) => row.category === label).map((row) => row.polestarView).join(" "),
    })),
    businessImplications: [],
    businessImplicationsNarrative,
    watchItems,
    glanceMetrics: [
      { label: "Material Developments", value: developments.filter((row) => row.severity !== "Low").length },
      { label: "Markets Requiring Watch", value: new Set(developments.map((row) => row.country)).size },
      { label: "High or Extreme Developments", value: developments.filter((row) => ["High", "Extreme"].includes(row.severity)).length },
      { label: "7-Day Watch Items", value: watchItems.length },
    ],
    mapPoints: apac
      ? [mapPoint(developments[0], 33.59, 71.44), mapPoint(developments[1], 6.43, 101.82), mapPoint(developments[4], 30.7, 137.0)]
      : [mapPoint(developments[0], 24.71, 46.67), mapPoint(developments[1], 24.09, 38.06), mapPoint(developments[3], 12.58, 43.33)],
    visualSummary: { byCategory, byCountry },
    coverageManifest,
  };
};

const ids = [
  77431, 77229, 77432, 78296, 78429, 78933, 76897, 71937, 71934, 71935, 72059, 72796,
  74338, 74044, 74836, 75118, 76747, 75347, 78107, 72328, 72333,
  78688, 78686, 78704, 78991, 78972, 78977, 69778, 69762, 70436, 71677, 71686, 71945,
  69768, 70088, 70091, 70093, 70439, 70441, 69753, 71662, 74267, 74269, 74271,
  77551, 77552, 77557, 75996,
];

const pool = new pg.Pool({
  connectionString,
  max: 1,
  application_name: "polestar-maintenance:v2",
});

try {
  const current = await pool.query(
    `select id, topic, issue_date, title, hard_numbers, executive_summary, situation,
            what_matters, watch_next, prose_basis_fingerprint, prose_provenance
       from reports
      where id = any($1::int[])
      order by id`,
    [[152, 153]],
  );
  if (current.rowCount !== 2) throw new Error("Expected production reports 152 and 153");
  writeFileSync(
    "exports/regional-weekly-production-backup-2026-09-20.json",
    JSON.stringify(current.rows, null, 2),
  );

  const evidenceResult = await pool.query(
    `select id, topic, title, display_title, summary, country, location, latitude,
            longitude, occurred_at, incident_date, severity, category, confidence,
            source, source_url, resolved_url, analyst_notes, event_cluster_key
       from incidents
      where id = any($1::int[])`,
    [ids],
  );
  const rows = evidenceResult.rows;
  const found = new Set(rows.map((row) => row.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) throw new Error(`Missing evidence IDs: ${missing.join(", ")}`);

  const dryRun = process.env.DRY_RUN === "1";
  await pool.query(dryRun ? "begin read only" : "begin");
  for (const record of current.rows) {
    const topic = record.topic as Topic;
    const issueDate = new Date(record.issue_date).toISOString().slice(0, 10);
    if (!["apac_weekly", "middle_east_weekly"].includes(topic) || issueDate !== "2026-09-20") {
      throw new Error(`Unexpected report row ${record.id}: ${record.topic} ${record.issue_date}`);
    }
    const existing = record.hard_numbers ?? {};
    const coverage = existing.regionalCoverageManifest ?? existing.regionalCanonicalReport?.coverageManifest;
    if (!coverage) throw new Error(`Report ${record.id} has no coverage manifest`);
    const canonical = buildCanonical(topic, rows, coverage);
    const evidenceIds = canonical.developments.flatMap((row: Development) => row.evidenceIds).map(String);
    const snapshot = rows
      .filter((row) => evidenceIds.includes(String(row.id)))
      .sort((a, b) => evidenceIds.indexOf(String(a.id)) - evidenceIds.indexOf(String(b.id)))
      .map((row) => ({
        ...row,
        displayTitle: row.display_title,
        occurredAt: new Date(row.occurred_at).toISOString(),
        incidentDate: row.incident_date ? new Date(row.incident_date).toISOString().slice(0, 10) : null,
        sourceUrl: row.source_url,
        resolvedUrl: row.resolved_url,
        analystNotes: row.analyst_notes,
        eventClusterKey: row.event_cluster_key,
      }));
    const fingerprint = `${topic}:2026-09-20:editorial-v2:${evidenceIds.join(",")}`;
    const hardNumbers = {
      ...existing,
      evidenceIds,
      selectedEvidenceIds: evidenceIds,
      regionalEvidenceSnapshot: snapshot,
      regionalCanonicalReport: canonical,
      model: { provider: "analyst-curated-regional-engine", version: "regional-weekly-editorial-v2" },
    };
    const provenance = Object.fromEntries(
      ["executiveSummary", "situation", "whatHappened", "whatMatters", "watchNext"].map((section) => [
        section,
        { kind: "ANALYST", fingerprint, generationBasisFingerprint: fingerprint },
      ]),
    );
    if (dryRun) {
      console.log(JSON.stringify({
        dryRun: true,
        id: record.id,
        topic,
        developments: canonical.developments.length,
        watchItems: canonical.watchItems.length,
        evidenceIds: evidenceIds.length,
        sources: [...new Set(canonical.developments.flatMap((row: Development) => row.sourceEvidence))],
      }, null, 2));
      continue;
    }
    await pool.query(
      `update reports
          set executive_summary = $2,
              situation = $3,
              what_happened = '',
              what_matters = $4,
              watch_next = '',
              hard_numbers = $5::jsonb,
              prose_basis_fingerprint = $6,
              prose_provenance = $7::jsonb,
              updated_at = now()
        where id = $1`,
      [
        record.id,
        canonical.regionalOutlook,
        canonical.riskPicture,
        canonical.businessImplicationsNarrative,
        JSON.stringify(hardNumbers),
        fingerprint,
        JSON.stringify(provenance),
      ],
    );
  }
  await pool.query("commit");

  const verify = await pool.query(
    `select id, topic, issue_date,
            jsonb_array_length(hard_numbers->'regionalCanonicalReport'->'developments') as developments,
            jsonb_array_length(hard_numbers->'regionalCanonicalReport'->'watchItems') as watch_items,
            hard_numbers->'regionalCanonicalReport'->>'schemaVersion' as schema_version
       from reports
      where id = any($1::int[])
      order by id`,
    [[152, 153]],
  );
  console.log(JSON.stringify(verify.rows, null, 2));
} catch (error) {
  await pool.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await pool.end();
}