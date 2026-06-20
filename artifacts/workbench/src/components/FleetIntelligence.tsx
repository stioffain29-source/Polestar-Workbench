import { useMemo } from "react";
import {
  useListMaritimeVessels,
  getListMaritimeVesselsQueryKey,
} from "@workspace/api-client-react";
import { buildFleetIntelligence } from "@/lib/fleetIntelligence";
import { NAVY, ELECTRIC, DUSK } from "@/lib/spotReport";

// Class swatch colours mirror the Live Vessel Map legend so the two panels read
// as one system. RED IS DELIBERATELY UNUSED — a vessel is context, never a
// severity, and the subdued red is reserved for the Extreme tier.
const CLASS_META: Array<{ key: "tanker" | "cargo" | "other"; label: string; color: string }> = [
  { key: "tanker", label: "Tanker", color: ELECTRIC },
  { key: "cargo", label: "Cargo", color: NAVY },
  { key: "other", label: "Other / not reported", color: DUSK },
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
  const maxClass = Math.max(
    fleet.classes.tanker,
    fleet.classes.cargo,
    fleet.classes.other,
    1,
  );

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

        {/* Fleet composition */}
        <div>
          <div className="font-serif text-[13px] font-bold uppercase tracking-wide text-primary mb-2">
            Fleet Composition
          </div>
          <div className="space-y-1.5">
            {CLASS_META.map((c) => {
              const count = fleet.classes[c.key];
              return (
                <div key={c.key} className="flex items-center gap-2">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full shrink-0 border border-[#e2e2e2]"
                    style={{ background: c.color }}
                  />
                  <div className="w-32 shrink-0 text-[12px] font-sans text-foreground truncate">
                    {c.label}
                  </div>
                  <div className="flex-1 h-2.5 bg-[#e2e2e2] rounded-sm overflow-hidden">
                    <div
                      className="h-2.5 rounded-sm"
                      style={{
                        width: `${Math.max(count > 0 ? 4 : 0, (count / maxClass) * 100)}%`,
                        background: c.color,
                      }}
                    />
                  </div>
                  <div className="w-7 shrink-0 text-right text-[12px] font-sans tabular-nums text-foreground">
                    {count}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground font-sans mt-2 leading-snug">
            Class is the broadcast AIS ship-type ({fleet.typeReported} of{" "}
            {fleet.total} report one). Vessels with no ship-type are counted as
            Other, never guessed; a precise bulk / container / gas split needs
            the vessel-registry layer.
          </p>
        </div>
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

      <p className="text-[11px] text-muted-foreground font-sans leading-snug">
        Live AIS context — vessel positions, flags and composition never count
        as incidents and never raise the risk level on their own.
      </p>
    </div>
  );
}
