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
