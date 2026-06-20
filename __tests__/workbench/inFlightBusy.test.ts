import { createInFlightBusy } from "../../artifacts/workbench/src/lib/inFlightBusy";

// Guards the country report "Redraft" button's busy-state logic. The button
// label flips to "Drafting..." while `busy` is true and back to "Redraft" when
// it settles to false. A prior bug derived that state from the shared React
// Query mutation's `isPending`, which could get stranded in a zombie pending
// state (StrictMode double-invoke / mid-flight remount) and leave the button
// stuck on "Drafting..." forever. The fix derives busy-ness from this LOCAL
// in-flight counter. These tests pin that contract so a future refactor cannot
// silently reintroduce the stuck spinner.

describe("createInFlightBusy", () => {
  it("starts idle (button reads 'Redraft', not 'Drafting...')", () => {
    const t = createInFlightBusy();
    expect(t.busy).toBe(false);
    expect(t.count).toBe(0);
  });

  it("shows busy ('Drafting...') only while a request is in flight", () => {
    const t = createInFlightBusy();
    expect(t.begin()).toBe(true);
    expect(t.busy).toBe(true);
    expect(t.count).toBe(1);

    expect(t.end()).toBe(false);
    expect(t.busy).toBe(false);
    expect(t.count).toBe(0);
  });

  it("settles back to idle after a single begin/end pair", () => {
    const t = createInFlightBusy();
    t.begin();
    t.end();
    expect(t.busy).toBe(false);
  });

  it("survives the StrictMode double-invoke: two begins then two ends settle to idle", () => {
    const t = createInFlightBusy();
    // StrictMode runs the prose effect twice in dev — two requests start.
    expect(t.begin()).toBe(true);
    expect(t.begin()).toBe(true);
    expect(t.count).toBe(2);

    // Both finish; the button must return to "Redraft".
    expect(t.end()).toBe(true); // one still in flight
    expect(t.busy).toBe(true);
    expect(t.end()).toBe(false); // all settled
    expect(t.busy).toBe(false);
    expect(t.count).toBe(0);
  });

  it("stays busy while any overlapping request is still in flight", () => {
    const t = createInFlightBusy();
    t.begin(); // request A
    t.begin(); // request B
    t.end(); // A done, B still running
    expect(t.busy).toBe(true);
    t.end(); // B done
    expect(t.busy).toBe(false);
  });

  it("never wedges below zero when 'end' is called more than 'begin'", () => {
    const t = createInFlightBusy();
    // A stray end (e.g. an aborted/duplicate finally) must not drive the
    // counter negative, which would otherwise require an extra begin before the
    // button could ever show busy again.
    expect(t.end()).toBe(false);
    expect(t.count).toBe(0);
    expect(t.end()).toBe(false);
    expect(t.count).toBe(0);

    // A subsequent real request must still register as busy.
    expect(t.begin()).toBe(true);
    expect(t.busy).toBe(true);
  });

  it("a fresh tracker (component remount) is never busy regardless of prior state", () => {
    const first = createInFlightBusy();
    first.begin(); // left mid-flight (e.g. unmounted while drafting)
    expect(first.busy).toBe(true);

    // A remount creates a new tracker — it must start idle, never inheriting
    // the previous instance's stranded pending state.
    const second = createInFlightBusy();
    expect(second.busy).toBe(false);
    expect(second.count).toBe(0);
  });
});
