export {
  loadTriggerTerms,
  TRIGGER_TERMS,
  termToPattern,
  matchesTerms,
  matchRegionTags,
} from "./triggerTerms";
export type {
  M15TriggerTerms,
  M15CentcomTerms,
  M15UkmtoTerms,
  M15PartnerTerms,
} from "./triggerTerms";

export {
  routeOfficialSource,
  isPartnerEscalationAdvisory,
  isPartnerThreatLevelUpdate,
} from "./routing";
export type {
  M15Watch,
  M15SourceKind,
  RouteOfficialSourceInput,
  RouteOfficialSourceResult,
} from "./routing";

export { assignAnalystFlags, simulateOfficialSourceIngest } from "./flags";
export type { AssignAnalystFlagsInput, AnalystFlags } from "./flags";
