const fs = require('fs');
const file = 'artifacts/workbench/src/components/IncidentMap.tsx';
let code = fs.readFileSync(file, 'utf8');

// Replace the positionAll loop to handle callouts
const positionAllOld = `    const positionAll = () => {
      for (const d of dotsRef.current) {
        const p = map.latLngToContainerPoint([d.lat, d.lng]);
        d.el.style.left = \`\${p.x - d.size / 2}px\`;
        d.el.style.top = \`\${p.y - d.size / 2}px\`;
      }
      for (const lb of labelsRef.current) {
        const p = map.latLngToContainerPoint([lb.lat, lb.lng]);
        lb.el.style.left = \`\${p.x + 14}px\`;
        lb.el.style.top = \`\${p.y - 7}px\`;
      }`;

const positionAllNew = `    const positionAll = () => {
      for (const d of dotsRef.current) {
        const p = map.latLngToContainerPoint([d.lat, d.lng]);
        d.el.style.left = \`\${p.x - d.size / 2}px\`;
        d.el.style.top = \`\${p.y - d.size / 2}px\`;
      }
      for (const lb of labelsRef.current) {
        const p = map.latLngToContainerPoint([lb.lat, lb.lng]);
        lb.el.style.left = \`\${p.x + 14}px\`;
        lb.el.style.top = \`\${p.y - 7}px\`;
      }
      for (const co of calloutsRef.current) {
        const p = map.latLngToContainerPoint([co.lat, co.lng]);
        co.leader.style.left = \`\${p.x}px\`;
        co.leader.style.top = \`\${p.y}px\`;
        co.box.style.left = \`\${p.x + 20}px\`;
        co.box.style.top = \`\${p.y}px\`;
        co.box.style.transform = "translateY(-50%)";
      }`;
code = code.replace(positionAllOld, positionAllNew);

// Add calloutsRef clearing
const clearRefOld = `    overlay.replaceChildren();
    dotsRef.current = [];
    labelsRef.current = [];
    radiusRef.current = null;`;
const clearRefNew = `    overlay.replaceChildren();
    dotsRef.current = [];
    labelsRef.current = [];
    calloutsRef.current = [];
    radiusRef.current = null;`;
code = code.replace(clearRefOld, clearRefNew);

// Cleanup on unmount
const unmountOld = `      overlayRef.current = null;
      dotsRef.current = [];
      labelsRef.current = [];
      radiusRef.current = null;`;
const unmountNew = `      overlayRef.current = null;
      dotsRef.current = [];
      labelsRef.current = [];
      calloutsRef.current = [];
      radiusRef.current = null;`;
code = code.replace(unmountOld, unmountNew);

// Map fitBounds padding
const fitBoundsOld = `      } else {
        map.fitBounds(L.latLngBounds(latLngs), { padding: [32, 32], maxZoom: 14 });
      }`;
const fitBoundsNew = `      } else {
        map.fitBounds(L.latLngBounds(latLngs), { padding: boundsPadding, maxZoom: 14 });
      }`;
code = code.replace(fitBoundsOld, fitBoundsNew);

fs.writeFileSync(file, code);
