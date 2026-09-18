const fs = require('fs');
const file = 'artifacts/workbench/src/components/IncidentMap.tsx';
let code = fs.readFileSync(file, 'utf8');

const oldPointCreation = `      // Analyst-typed marker caption (e.g. a manual map point labelled "MINES").
      // The primary point gets its location label from the block below, so it is
      // excluded here to avoid a double label.
      const pointLabel = (p.label ?? "").trim();
      if (showLabels && pointLabel && !p.primary) {
        const lbl = document.createElement("div");
        lbl.style.position = "absolute";
        lbl.style.color = NAVY;
        lbl.style.font = "700 12px/1.2 Roboto, sans-serif";
        lbl.style.letterSpacing = "0.01em";
        lbl.style.whiteSpace = "nowrap";
        lbl.textContent = pointLabel;
        overlay.appendChild(lbl);
        labelsRef.current.push({ el: lbl, lat: p.lat, lng: p.lng });
      }`;

const newPointCreation = `      // Analyst-typed marker caption (e.g. a manual map point labelled "MINES").
      // The primary point gets its location label from the block below, so it is
      // excluded here to avoid a double label.
      const pointLabel = (p.label ?? "").trim();
      if (showLabels && pointLabel && !p.primary) {
        const lbl = document.createElement("div");
        lbl.style.position = "absolute";
        lbl.style.color = NAVY;
        lbl.style.font = "700 12px/1.2 Roboto, sans-serif";
        lbl.style.letterSpacing = "0.01em";
        lbl.style.whiteSpace = "nowrap";
        lbl.textContent = pointLabel;
        overlay.appendChild(lbl);
        labelsRef.current.push({ el: lbl, lat: p.lat, lng: p.lng });
      }

      if (p.callout) {
        dot.style.zIndex = "500";
        const co = document.createElement("div");
        co.style.position = "absolute";
        co.style.background = "rgba(255, 255, 255, 0.95)";
        co.style.border = \`1px solid \${POLAR}\`;
        co.style.padding = "6px 8px";
        co.style.borderRadius = "3px";
        co.style.boxShadow = "0 2px 4px rgba(0,0,0,0.1)";
        co.style.pointerEvents = "none";
        co.style.zIndex = "1000";
        co.style.minWidth = "150px";
        co.style.maxWidth = "220px";

        const cName = document.createElement("div");
        cName.style.font = "700 12px/1.2 Roboto, sans-serif";
        cName.style.color = NAVY;
        cName.style.textTransform = "uppercase";
        cName.style.marginBottom = "2px";
        cName.textContent = p.callout.country;
        co.appendChild(cName);

        const cSev = document.createElement("div");
        cSev.style.font = "700 9px/1.2 Roboto, sans-serif";
        cSev.style.color = p.callout.severityColor;
        cSev.style.marginBottom = "5px";
        cSev.style.letterSpacing = "0.02em";
        cSev.textContent = \`CURRENT SEVERITY: \${p.callout.severityLabel}\`;
        co.appendChild(cSev);

        for (const devText of p.callout.developments) {
          const dItem = document.createElement("div");
          dItem.style.font = "400 11px/1.35 Roboto, sans-serif";
          dItem.style.color = DUSK;
          dItem.style.marginBottom = "3px";
          dItem.style.display = "flex";
          dItem.style.alignItems = "baseline";
          
          const bullet = document.createElement("span");
          bullet.style.display = "inline-block";
          bullet.style.width = "4px";
          bullet.style.height = "4px";
          bullet.style.borderRadius = "50%";
          bullet.style.background = p.callout.severityColor;
          bullet.style.marginRight = "5px";
          bullet.style.flexShrink = "0";
          bullet.style.transform = "translateY(-1.5px)";
          
          const dText = document.createElement("span");
          dText.textContent = devText;

          dItem.appendChild(bullet);
          dItem.appendChild(dText);
          co.appendChild(dItem);
        }
        
        if (co.lastChild) {
           (co.lastChild).style.marginBottom = "0";
        }

        const leader = document.createElement("div");
        leader.style.position = "absolute";
        leader.style.width = "20px";
        leader.style.height = "1px";
        leader.style.background = "#888888";
        leader.style.zIndex = "400";
        
        overlay.appendChild(leader);
        overlay.appendChild(co);
        
        calloutsRef.current.push({ box: co, leader, lat: p.lat, lng: p.lng });
      }`;

code = code.replace(oldPointCreation, newPointCreation);

fs.writeFileSync(file, code);
