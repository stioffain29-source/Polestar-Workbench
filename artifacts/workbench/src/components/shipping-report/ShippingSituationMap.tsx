import { featurePath } from "@/lib/cargoChoropleth";
import { SHIPPING_REGIONAL_GEO, SHIPPING_REGIONAL_MAP_POINTS, SHIPPING_REGIONAL_MAP_LABEL_OFFSETS, projectShippingRegionalPoint } from "@/lib/shippingRegionalMap";

export function ShippingSituationMap({ chokepoints }: { chokepoints: Array<{ name: string; level: number | null; label: string }> }) {
  const frame = { x: 25, y: 62, width: 750, height: 340 };
  const project = (longitude: number, latitude: number): [number, number] => {
    const p = projectShippingRegionalPoint({ longitude, latitude }, frame);
    return [p.x, p.y];
  };
  const normal = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");
  return <svg viewBox="0 0 800 500" role="img" aria-label="Regional maritime map showing the seven tracked chokepoints" style={{ width: "100%", height: "100%", background: "#fff", fontFamily: "Roboto, sans-serif" }}>
    <defs><clipPath id="shipping-map-clip"><rect x="0" y="10" width="800" height="450" /></clipPath></defs>
    <g clipPath="url(#shipping-map-clip)">
      {SHIPPING_REGIONAL_GEO.features.map((feature, i) => <path key={i} d={featurePath(feature, project) || ""} fill="#e2e2e2" stroke="#fff" strokeWidth=".8" />)}
    </g>

    {SHIPPING_REGIONAL_MAP_POINTS.map((point, i) => {
      const route = chokepoints.find(cp => normal(cp.name) === normal(point.key));
      const pending = !route || route.level == null || /pending/i.test(route.label) || route.label === "Not assessed";
      if (pending) return null;

      const [x, y] = project(point.longitude, point.latitude);

      const [dx, dy] = SHIPPING_REGIONAL_MAP_LABEL_OFFSETS[i];
      const lx = Math.min(714, Math.max(65, x + dx));
      const ly = y + dy;
      return <g key={point.key} data-shipping-map-marker={point.key}>
        <path d={`M${x},${y} L${lx},${ly}`} fill="none" stroke="#0b0a3d" strokeWidth=".8" />
        <circle cx={x} cy={y} r={6} fill={pending ? "#fff" : "#465bff"} stroke="#0b0a3d" strokeWidth="1.5" />
        <rect x={lx - 74} y={ly - 14} width="148" height={pending ? 22 : 35} fill="#fff" />
        <text x={lx} y={ly} textAnchor="middle" fill="#0b0a3d" fontSize="11" fontWeight="700">{point.key.toUpperCase()}</text>
        {!pending && <text x={lx} y={ly + 13} textAnchor="middle" fill="#465bff" fontSize="10">{route?.label}</text>}
      </g>;
    })}
    <circle cx="25" cy="477" r="5" fill="#fff" stroke="#0b0a3d" strokeWidth="1.5" />
    <text x="39" y="481" fill="#363636" fontSize="11">Outlined markers: assessment pending. AIS is not used to rate incident risk.</text>
  </svg>;
}