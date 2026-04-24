// Logging phase stub: returns the sub-tick's new events unchanged so the sub-tick runner has a uniform final step.
// Depends on: resolver event types. Consumed by: resolver/sub_tick.ts.

import type { ResolverEvent } from "../types.js";

export function runLoggingPhase(events: ResolverEvent[]): ResolverEvent[] {
  return events;
}
