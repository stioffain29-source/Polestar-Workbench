// A tiny in-flight request tracker that derives a boolean "busy" state from a
// LOCAL counter of started-but-not-yet-finished requests.
//
// Why this exists: the country report "Redraft" button must show "Drafting..."
// ONLY while a request this component actually started is still in flight, and
// it must ALWAYS settle back to "Redraft" once every started request has
// finished — even when the prose effect is double-invoked (React StrictMode in
// dev) or the component remounts mid-flight. Deriving the busy state from the
// shared React Query mutation's `isPending` can strand the button in a zombie
// pending state ("Drafting..." forever); a local counter cannot, because it
// only ever reflects begin/end pairs this component issued.
export interface InFlightBusy {
  /** Mark a new request as started. Returns the resulting busy state. */
  begin(): boolean;
  /** Mark one request as finished. Returns the resulting busy state. */
  end(): boolean;
  /** True while at least one started request has not yet finished. */
  readonly busy: boolean;
  /** Count of started-but-not-yet-finished requests. */
  readonly count: number;
}

export function createInFlightBusy(): InFlightBusy {
  let count = 0;
  return {
    begin() {
      count += 1;
      return count > 0;
    },
    end() {
      // Clamp at zero so a stray/extra `end` can never drive the counter
      // negative and wedge the busy state below settling point.
      count = Math.max(0, count - 1);
      return count > 0;
    },
    get busy() {
      return count > 0;
    },
    get count() {
      return count;
    },
  };
}
