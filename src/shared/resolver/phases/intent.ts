// Intent phase: emits one plot_committed event per active ship at sub-tick 0 and nothing on later sub-ticks.
// Depends on: resolver context and event types. Consumed by: resolver/sub_tick.ts.

import type { PlotCommittedEvent, ResolverContext } from "../types.js";

export function runIntentPhase(context: ResolverContext, subTick: number): PlotCommittedEvent[] {
  if (subTick !== 0) {
    return [];
  }

  return context.sorted_ship_ids.map((shipId) => {
    const plot = context.plots_by_ship[shipId];

    if (!plot) {
      throw new Error(`Resolver missing plot payload for ship '${shipId}' during intent phase`);
    }

    return {
      sub_tick: subTick,
      type: "plot_committed",
      actor: shipId,
      details: {
        plot
      }
    };
  });
}
