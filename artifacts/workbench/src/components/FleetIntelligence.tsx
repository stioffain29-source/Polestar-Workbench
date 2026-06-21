import { useMemo } from "react";
import {
  useListMaritimeVessels,
  getListMaritimeVesselsQueryKey,
} from "@workspace/api-client-react";
import { buildFleetIntelligence } from "@/lib/fleetIntelligence";
import { NAVY, ELECTRIC, SLATE } from "@/lib/spotReport";

// Class swatch colours mirror the Live Vessel Map legend so the two panels read
// as one system. Three clearly distinct, on-brand tones: Tanker = Electric Blue,
// Cargo = near-black Navy, Other / not reported = mid-gray Slate (the residual
// bucket is intentionally the most muted). RED IS DELIBERATELY UNUSED — a vessel
// is context, never a severity, and the subdued red is reserved for the Extreme tier.
const CLASS_META: Array<{ key: "tanker" | "cargo" | "other"; label: string; color: string }> = [
  { key: "tanker", label: "Tanker", color: ELECTRIC },
  { key: "cargo", label: "Cargo", color: NAVY },
  { key: "other", label: "Other / not reported", color: SLATE },
];

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="border border-[#e2e2e2] rounded-sm px-3 py-2">
      <div className="font-serif text-[20px] font-bold leading-none text-primary">
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground font-sans mt-1 leading-snug">
        {label}
      </div>
    </div>
  );
}

// Flat, single-colour cargo-ship silhouette. No gradient, shadow or glow — the
// fill is the class colour so the tile reads as one of the map legend classes.
function ShipIcon({ color }: { color: string }) {
  return (
    <svg
      viewBox="0 0 64 32"
      width="46"
      height="23"
      role="presentation"
      aria-hidden="true"
    >
      {/* hull */}
      <path d="M4 18 H60 L52 28 H12 Z" fill={color} />
      {/* deck cargo */}
      <rect x="14" y="10" width="26" height="8" fill={color} />
      {/* bridge */}
      <rect x="43" y="5" width="9" height="13" fill={color} />
    </svg>
  );
}

// One vessel-class tile in the colour-coded composition row. The count and icon
// take the class colour; the share is computed from the live fleet total so the
// three tiles always sum to the tracked vessels (no fabricated figure).
function FleetClassTile({
  color,
  label,
  count,
  total,
}: {
  color: string;
  label: string;
  count: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="border border-[#e2e2e2] rounded-sm bg-white px-3 py-3 flex flex-col items-center text-center gap-2">
      <span className="flex items-center justify-center w-full rounded-sm bg-muted/30 py-2">
        <ShipIcon color={color} />
      </span>
      <div
        className="font-serif text-[26px] font-bold leading-none tabular-nums"
        style={{ color }}
      >
        {count}
      </div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans leading-snug min-h-[26px] flex items-center justify-center">
        {label}
      </div>
      <div className="text-[10px] text-muted-foreground font-sans tabular-nums">
        {pct}% of fleet
      </div>
    </div>
  );
}

/**
 * Live Fleet Intelligence — flags of registry and fleet composition derived
 * from the same real AIS sightings the Live Vessel Map plots. Shares the vessel
 * query (identical key) so this adds no extra fetch. Every number is computed
 * from data the feed actually carries; nothing is fabricated.
 */
export default function FleetIntelligence() {
  const vesselParams = { maxAgeHours: 24, limit: 2000 } as const;
  const { data: vessels = [] } = useListMaritimeVessels(vesselParams, {
    query: {
      queryKey: getListMaritimeVesselsQueryKey(vesselParams),
      refetchInterval: 60_000,
    },
  });

  const fleet = useMemo(() => buildFleetIntelligence(vessels), [vessels]);

  if (fleet.total === 0) {
    return (
      <p className="text-[12px] text-muted-foreground font-sans leading-snug">
        No live vessel positions are available for the tracked chokepoints right
        now, so there is no fleet to break down. Flags and composition populate
        automatically once the AIS feed reports vessels.
      </p>
    );
  }

  const topFlags = fleet.flags.slice(0, 10);
  const maxFlag = topFlags.length > 0 ? topFlags[0].count : 1;
  const otherFlags = fleet.flags.slice(10).reduce((s, f) => s + f.count, 0);

  return (
    <div className="space-y-5">
      {/* Headline stats. Activity tiles show "—" when no vessel reports an AIS
          nav-status, so an unknown split is never rendered as a fabricated 0. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat value={fleet.total} label="Vessels tracked (last 24 h)" />
        <Stat value={fleet.flags.length} label="Flag states present" />
        <Stat
          value={fleet.navStatusReported > 0 ? fleet.atAnchor : "—"}
          label={
            fleet.navStatusReported > 0
              ? "At anchor / moored"
              : "At anchor / moored — not reported"
          }
        />
        <Stat
          value={fleet.navStatusReported > 0 ? fleet.underway : "—"}
          label={
            fleet.navStatusReported > 0
              ? "Under way"
              : "Under way — not reported"
          }
        />
      </div>

      {/* Fleet composition — colour-coded tile row, one tile per vessel class.
          Colours match the Live Vessel Map legend so map and composition read
          as one system. */}
      <div className="border border-[#e2e2e2] rounded-sm p-4">
        <div className="flex items-baseline justify-between gap-2 mb-3">
          <div className="font-serif text-[13px] font-bold uppercase tracking-wide text-primary">
            Fleet Composition
          </div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-sans">
            {fleet.total} vessels · last 24 h
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {CLASS_META.map((c) => (
            <FleetClassTile
              key={c.key}
              color={c.color}
              label={c.label}
              count={fleet.classes[c.key]}
              total={fleet.total}
            />
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground font-sans mt-3 leading-snug">
          Class is the broadcast AIS ship-type ({fleet.typeReported} of{" "}
          {fleet.total} report one). Vessels with no ship-type are counted as
          Other, never guessed; a precise bulk / container / gas split needs the
          vessel-registry layer.
        </p>
      </div>

      <div
        className={`grid grid-cols-1 gap-6 ${
          fleet.theatres.length > 0 ? "lg:grid-cols-2" : ""
        }`}
      >
        {/* Top flags of registry */}
        <div>
          <div className="font-serif text-[13px] font-bold uppercase tracking-wide text-primary mb-2">
            Top Flags of Registry
          </div>
          <div className="space-y-1.5">
            {topFlags.map((f) => (
              <div key={f.flag} className="flex items-center gap-2">
                <div className="w-28 shrink-0 text-[12px] font-sans text-foreground truncate">
                  {f.flag}
                </div>
                <div className="flex-1 h-2.5 bg-[#e2e2e2] rounded-sm overflow-hidden">
                  <div
                    className="h-2.5 rounded-sm"
                    style={{
                      width: `${Math.max(4, (f.count / maxFlag) * 100)}%`,
                      background: ELECTRIC,
                    }}
                  />
                </div>
                <div className="w-7 shrink-0 text-right text-[12px] font-sans tabular-nums text-foreground">
                  {f.count}
                </div>
              </div>
            ))}
            {(otherFlags > 0 || fleet.flagNotDerivable > 0) && (
              <div className="text-[11px] text-muted-foreground font-sans pt-1 leading-snug">
                {otherFlags > 0 && `+${otherFlags} in other flag states. `}
                {fleet.flagNotDerivable > 0 &&
                  `${fleet.flagNotDerivable} flag not derivable from MMSI.`}
              </div>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground font-sans mt-2 leading-snug">
            Flag state is the ITU country code (MID) encoded in each vessel's
            MMSI — the registering administration, derived directly from the
            identity.
          </p>
        </div>

        {/* Per-theatre breakdown */}
        {fleet.theatres.length > 0 && (
          <div>
            <div className="font-serif text-[13px] font-bold uppercase tracking-wide text-primary mb-2">
              By Chokepoint
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
              {fleet.theatres.map((t) => (
                <div key={t.theatre} className="text-[12px] font-sans">
                  <span className="text-foreground">{t.theatre}</span>
                  <span className="text-muted-foreground"> — {t.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground font-sans leading-snug">
        Live AIS context — vessel positions, flags and composition never count
        as incidents and never raise the risk level on their own.
      </p>
    </div>
  );
}
