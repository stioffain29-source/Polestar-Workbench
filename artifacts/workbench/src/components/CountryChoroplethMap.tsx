import { MapContainer, TileLayer, GeoJSON } from "react-leaflet";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { Layer, PathOptions } from "leaflet";
import cargoScopeCountriesGeo from "@/assets/cargoScopeCountries.geo.json";
import monitorChoroplethExtrasGeo from "@/assets/monitorChoroplethExtras.geo.json";
import { COUNT_BANDS, countBandColor, featureCountryName } from "@/lib/cargoChoropleth";

// DB country spellings that differ from the shared choropleth polygon names.
// Folded in when building the intensity so those countries shade instead of
// silently failing the name lookup.
export const CHOROPLETH_COUNTRY_ALIASES: Record<string, string> = {
  "United Arab Emirates": "UAE",
};

/**
 * Fold a page's per-country counts into the polygon-name space the choropleth
 * shades: apply the spelling aliases and merge any collisions. Composite
 * country strings ("India; Thailand") and "Unknown" carry no polygon and are
 * deliberately left unmapped, so the map and the country tables always agree.
 */
export function buildCountryIntensity(
  rows: Array<{ country: string; count: number }>,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const { country, count } of rows) {
    if (!country) continue;
    const name = CHOROPLETH_COUNTRY_ALIASES[country] ?? country;
    m.set(name, (m.get(name) ?? 0) + count);
  }
  return m;
}

// Base = the cargo IN_SCOPE_COUNTRIES polygons. The wider topic monitors
// (energy, fertiliser, civil unrest, conflict) also carry countries outside
// that set — Nepal and the Indonesian province of West Papua each hold hundreds
// of flashpoint/conflict incidents — so those extra polygons are merged in HERE
// only. They are kept OUT of cargoScopeCountries.geo.json so the cargo
// report/monitor (which paint zero-count countries solid and fold West Papua
// into Indonesia) stay unchanged and the cargo-scope guard test holds.
const MONITOR_CHOROPLETH_GEO: FeatureCollection<Geometry, { name?: string }> = {
  ...(cargoScopeCountriesGeo as unknown as FeatureCollection<Geometry, { name?: string }>),
  features: [
    ...(cargoScopeCountriesGeo as unknown as FeatureCollection<Geometry, { name?: string }>).features,
    ...(monitorChoroplethExtrasGeo as unknown as FeatureCollection<Geometry, { name?: string }>).features,
  ],
};

// Country-intensity choropleth: shade each in-scope country polygon by its
// incident count using the shared brand-blue count ramp; zero-count countries
// are an outline only. Reuses the shared count bands so shading rules stay a
// single source of truth across every topic map (cargo, energy, fertiliser,
// civil unrest, conflict).
function Choropleth({ intensity }: { intensity: Map<string, number> }) {
  const geo = MONITOR_CHOROPLETH_GEO;
  const styleKey = Array.from(intensity.entries())
    .map(([c, n]) => `${c}:${n}`)
    .sort()
    .join("|");

  const style = (feature?: Feature<Geometry, { name?: string }>): PathOptions => {
    const name = feature ? featureCountryName(feature) : "";
    const count = intensity.get(name) ?? 0;
    const fill = countBandColor(count);
    return {
      color: "#8A94A6",
      weight: 0.8,
      fillColor: fill ?? "#000000",
      fillOpacity: fill ? 0.85 : 0,
    };
  };

  const onEachFeature = (feature: Feature<Geometry, { name?: string }>, layer: Layer) => {
    const name = featureCountryName(feature);
    const count = intensity.get(name) ?? 0;
    layer.bindTooltip(
      `<div style="font-size:11px"><div style="font-weight:700">${name}</div>` +
        `<div>${count} incident${count === 1 ? "" : "s"}</div></div>`,
      { sticky: true },
    );
  };

  return <GeoJSON key={styleKey} data={geo} style={style} onEachFeature={onEachFeature} />;
}

// Compact legend for the count-intensity bands, overlaid on the map.
function ChoroplethLegend({ label }: { label: string }) {
  return (
    <div className="absolute bottom-3 right-3 z-[1000] bg-card/95 border border-border rounded-sm px-2.5 py-2 text-[10px] font-sans shadow-sm">
      <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <div className="space-y-0.5">
        {COUNT_BANDS.map((b) => (
          <div key={b.label} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-[1px]" style={{ backgroundColor: b.color }} />
            <span className="text-foreground">{b.label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-[1px] border border-border" style={{ backgroundColor: "transparent" }} />
          <span className="text-muted-foreground">0 (none)</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Full country-choropleth map block: empty state, CARTO Positron basemap, the
 * shaded polygons, the count-band legend, and an optional caption. Callers wrap
 * it in their own bordered card container.
 */
export function CountryChoroplethMap({
  intensity,
  legendLabel,
  caption,
  center = [20, 80],
  emptyText = "No identified countries available for this view.",
}: {
  intensity: Map<string, number>;
  legendLabel: string;
  caption?: string;
  center?: [number, number];
  emptyText?: string;
}) {
  if (intensity.size === 0) {
    return <div className="p-8 text-center text-sm text-muted-foreground">{emptyText}</div>;
  }
  return (
    <>
      <div className="relative h-[420px]">
        <MapContainer center={center} zoom={3} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
          <TileLayer
            attribution="&copy; OpenStreetMap &copy; CARTO"
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            subdomains="abcd"
            maxZoom={19}
          />
          <Choropleth intensity={intensity} />
        </MapContainer>
        <ChoroplethLegend label={legendLabel} />
      </div>
      {caption ? (
        <div className="px-3 py-1.5 text-[10px] text-muted-foreground font-sans border-t border-border">
          {caption}
        </div>
      ) : null}
    </>
  );
}
