import React from "react";
import { format } from "date-fns";
import type { ShippingSevenPageTimelineItem } from "@/lib/shippingSevenPagePresentation";
import { shippingSevKey } from "@/lib/shippingReportDataset";

export function ShippingThreatTimeline({ incidents }: { incidents: ShippingSevenPageTimelineItem[] }) {
  if (incidents.length === 0) {
     return <div className="text-[14px] text-[#363636] italic border border-[#e2e2e2] p-8 rounded-sm text-center bg-[#f8f9fa]">No incidents recorded in this window.</div>;
  }

  return (
    <div className="flex flex-col gap-3 relative pl-4 mt-4">
      <div className="absolute left-[72px] top-2 bottom-2 w-[2px] bg-[#e2e2e2]"></div>
      
      {incidents.map(inc => {
         const sevK = shippingSevKey(inc.severity);
         const bg = sevK === "high" || sevK === "extreme" ? "#0b0a3d" : sevK === "moderate" ? "#465bff" : "#363636";
         const isMajor = inc.major;

         return (
           <div key={inc.id} className={`flex items-start gap-6 relative z-10 ${isMajor ? 'py-3' : 'py-2 pr-4'}`}>
             <div className="w-[45px] text-right font-bold text-[#0b0a3d] text-[13px] pt-1 leading-tight flex-shrink-0 whitespace-pre-line">
               {format(inc.date, "dd\nMMM")}
             </div>
             
             <div className="w-[14px] h-[14px] rounded-full mt-[6px] border-2 border-white flex-shrink-0 shadow-sm" style={{ backgroundColor: bg, marginLeft: '-3px' }}></div>
             
             <div className="flex-1 flex flex-col gap-1.5 pt-0.5">
               <div className="flex items-center gap-3">
                 <span className="text-[9px] font-bold text-white px-1.5 py-[2px] rounded-sm uppercase tracking-wider" style={{ backgroundColor: bg }}>
                   {inc.severityLabel}
                 </span>
                 <span className="text-[11px] font-bold text-[#465bff] uppercase tracking-wider">{inc.type}</span>
                 <span className="text-[10px] text-[#363636]">· {inc.physicalLocation || inc.country || "Location not established"}</span>
               </div>
               
               <div className={`text-[#0b0a3d] ${isMajor ? 'font-bold text-[15px] leading-snug' : 'font-medium text-[14px] leading-snug'}`}>
                 {inc.title}
               </div>
             </div>
           </div>
         );
      })}
    </div>
  );
}