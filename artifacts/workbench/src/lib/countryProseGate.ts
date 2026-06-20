// Decides when the country-report prose effect is allowed to fire.
//
// This encodes the regeneration-loop fix: the effect must wait until the
// incidents query has SETTLED (success OR error) before grounding the prose.
// While the query is still loading the incident set is empty, so firing then
// would ground prose on zero incidents AND race a second fingerprint (the full
// set) into the cache — wasted AI spend and non-deterministic prose. A
// genuinely empty week still proceeds: the query settles with an empty array.
//
// Extracted as a pure predicate so the gate is unit-testable independently of
// the React component.

export interface ProseEffectGateState {
  /** The country has loaded (we know what brief we are generating). */
  hasCountry: boolean;
  /** The report is in edit mode — never auto-generate over an analyst edit. */
  editing: boolean;
  /** The incidents query has resolved (isSuccess). */
  incidentsSuccess: boolean;
  /** The incidents query has errored (isError). */
  incidentsError: boolean;
  /** This brief uses the structured (png) variant. */
  isStructured: boolean;
  /** The structured dataset has built (only relevant when isStructured). */
  structuredReady: boolean;
}

/**
 * True only when every precondition for grounding the prose is met. Returns
 * false while the incidents query is still in flight so the effect cannot fire
 * on a transient empty set.
 */
export function shouldGenerateProse(state: ProseEffectGateState): boolean {
  if (!state.hasCountry) return false;
  if (state.editing) return false;
  // The settle gate: neither success nor error means the query is still loading.
  if (!state.incidentsSuccess && !state.incidentsError) return false;
  if (state.isStructured && !state.structuredReady) return false;
  return true;
}
