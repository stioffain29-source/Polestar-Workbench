const fs = require('fs');
const file = 'artifacts/workbench/src/components/ReportPreview.tsx';
let code = fs.readFileSync(file, 'utf8');

const oldMap = `function ApacHotspotMap({
  items,
}: {
  items: ReturnType<typeof import("@/lib/regionalWeekly").buildApacMapItems>;
}) {
  if (items.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground italic" style={{ fontFamily: "Roboto, sans-serif" }}>
        No selected development has a verified plottable location.
      </p>
    );
  }
  return (
    <div className="flex flex-col md:flex-row gap-5 items-stretch">
      <div className="w-full md:w-[62%] border border-[#d2d6e1] bg-[#f7f8fb] overflow-hidden">
        <IncidentMap
          points={items.map(item => ({
            lat: item.lat,
            lng: item.lng,
            title: item.country,
            severity: item.developments[0]?.severity ?? "Moderate",
            primary: false,
            markerNumber: item.id
          }))}
          height={380}
          showLabels={false}
        />
      </div>
      <div className="w-full md:w-[38%] flex flex-col gap-3 justify-center">
        {items.map(item => {
          // Worst severity is the one from the first development (since sorted by severity in builder)
          const worstSeverity = item.developments[0]?.severity ?? "Moderate";
          return (
            <div key={item.id} className="bg-white border border-[#e2e2e2] p-3 shadow-sm flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                <span className="flex items-center justify-center bg-[#0b0a3d] text-white rounded-full w-[22px] h-[22px] text-[11px] font-bold">
                  {item.id}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  {item.flag && (
                    <img 
                      src={\`/assets/flags/\${item.flag}.svg\`} 
                      alt={\`Flag of \${item.country}\`} 
                      className="w-5 h-auto object-contain drop-shadow-sm" 
                    />
                  )}
                  <span className="font-bold text-[13px] tracking-wide uppercase" style={{ color: NAVY, fontFamily: "Roboto, sans-serif" }}>
                    {item.country}
                  </span>
                </div>
                <div className="text-[10px] font-bold tracking-wider mb-2" style={{ color: SPOT_SEV_COLOR[worstSeverity.toLowerCase()] ?? DUSK, fontFamily: "Roboto, sans-serif" }}>
                  CURRENT SEVERITY: {worstSeverity.toUpperCase()}
                </div>
                <div className="space-y-1.5">
                  {item.developments.map((dev, i) => (
                    <div key={i} className="text-[12px] leading-[1.4] flex items-start gap-1.5" style={{ color: DUSK, fontFamily: "Roboto, sans-serif" }}>
                      <span className="mt-1.5 w-1 h-1 rounded-full bg-[#363636] flex-shrink-0" />
                      <span>{dev.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}`;

const newMap = `function ApacHotspotMap({
  items,
}: {
  items: ReturnType<typeof import("@/lib/regionalWeekly").buildApacMapItems>;
}) {
  if (items.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground italic" style={{ fontFamily: "Roboto, sans-serif" }}>
        No selected development has a verified plottable location.
      </p>
    );
  }
  return (
    <div className="border border-[#d2d6e1] bg-[#f7f8fb] overflow-hidden w-full">
      <IncidentMap
        points={items.map(item => {
          const worstSeverity = item.developments[0]?.severity ?? "Moderate";
          return {
            lat: item.lat,
            lng: item.lng,
            title: item.country,
            severity: worstSeverity,
            primary: false,
            callout: {
              country: item.country,
              severityLabel: worstSeverity.toUpperCase(),
              severityColor: SPOT_SEV_COLOR[worstSeverity.toLowerCase()] ?? DUSK,
              developments: item.developments.map(d => d.label)
            }
          };
        })}
        height={450}
        hideControls={true}
        showLabels={false}
        boundsPadding={[40, 180]}
      />
    </div>
  );
}`;

code = code.replace(oldMap, newMap);
fs.writeFileSync(file, code);
