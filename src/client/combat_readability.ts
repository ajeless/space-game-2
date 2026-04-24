import type { PlotPreviewWeaponCue, ShipRuntimeState, SubsystemState, SystemEffectValues } from "../shared/index.js";

export type WeaponCueEngagementState = "none" | "tracked" | "armed" | "blocked";

export type ContactTelemetry = {
  range_label: string;
  closure_label: "closing" | "opening" | "steady";
  summary_label: string;
};

const CLOSURE_EPSILON = 0.0005;

function formatDistance(distanceKm: number): string {
  return `${Math.round(distanceKm)} km`;
}

export function getWeaponCueEngagementState(cue: PlotPreviewWeaponCue | null | undefined): WeaponCueEngagementState {
  if (!cue || cue.target_ship_instance_id === null) {
    return "none";
  }

  if (!cue.firing_enabled) {
    return "blocked";
  }

  if (cue.charge_pips <= 0) {
    return "tracked";
  }

  if (cue.predicted_hit_probability !== null) {
    return "armed";
  }

  return "blocked";
}

export function getWeaponCueEngagementPriority(cue: PlotPreviewWeaponCue | null | undefined): number {
  switch (getWeaponCueEngagementState(cue)) {
    case "armed":
      return 3;
    case "blocked":
      return 2;
    case "tracked":
      return 1;
    case "none":
    default:
      return 0;
  }
}

export function getWeaponCueBlockedReason(cue: PlotPreviewWeaponCue): string {
  if (!cue.firing_enabled) {
    return "OFFLINE";
  }

  if (cue.target_in_arc === false) {
    return "OUT OF ARC";
  }

  if (cue.target_in_range === false) {
    return "OUT OF RANGE";
  }

  return "NO SHOT";
}

export function getWeaponCueArcRangeLabel(cue: PlotPreviewWeaponCue | null | undefined): string | null {
  if (!cue || cue.target_ship_instance_id === null || cue.target_in_arc === null || cue.target_in_range === null) {
    return null;
  }

  return `${cue.target_in_arc ? "IN ARC" : "OUT OF ARC"} · ${cue.target_in_range ? "IN RANGE" : "OUT OF RANGE"}`;
}

export function getWeaponCueSolutionLabel(cue: PlotPreviewWeaponCue | null | undefined): string | null {
  if (!cue || cue.target_ship_instance_id === null) {
    return null;
  }

  if (cue.charge_pips <= 0) {
    return "HOLD FIRE";
  }

  if (cue.predicted_hit_probability !== null) {
    return `${Math.round(cue.predicted_hit_probability * 100)}% · T${cue.best_fire_sub_tick ?? "?"}`;
  }

  return getWeaponCueBlockedReason(cue);
}

export function getWeaponMountStateLabel(
  subsystemState: SubsystemState,
  effects: SystemEffectValues,
  cue: PlotPreviewWeaponCue | null | undefined
): string {
  if (effects.firing_enabled === false || subsystemState === "offline") {
    return "OFFLINE";
  }

  if (subsystemState !== "degraded") {
    return subsystemState.toUpperCase();
  }

  const parts = ["DEGRADED"];
  const chargePenaltyPips = typeof effects.charge_penalty_pips === "number" ? effects.charge_penalty_pips : 0;
  const trackQualityFactor = typeof effects.track_quality_factor === "number" ? effects.track_quality_factor : 1;

  if (
    chargePenaltyPips > 0 &&
    cue &&
    cue.charge_pips > 0 &&
    cue.effective_charge_pips !== null &&
    cue.effective_charge_pips !== cue.charge_pips
  ) {
    parts.push(`${cue.charge_pips}P->${cue.effective_charge_pips}P`);
  } else if (chargePenaltyPips > 0) {
    parts.push(`-${chargePenaltyPips}P`);
  }

  if (trackQualityFactor < 1) {
    parts.push(`TRACK ${Math.round(trackQualityFactor * 100)}%`);
  }

  return parts.join(" · ");
}

export function getWeaponCueEngagementLabel(cue: PlotPreviewWeaponCue | null | undefined): string | null {
  if (!cue || cue.target_ship_instance_id === null) {
    return null;
  }

  const state = getWeaponCueEngagementState(cue);

  if (state === "tracked") {
    return "TRACKED · HOLD";
  }

  if (state === "armed") {
    const probabilityLabel =
      cue.predicted_hit_probability !== null ? ` · ${Math.round(cue.predicted_hit_probability * 100)}%` : "";

    return `ARMED · ${cue.charge_pips}P${probabilityLabel}`;
  }

  if (state === "blocked") {
    return `BLOCKED · ${cue.charge_pips}P · ${getWeaponCueBlockedReason(cue)}`;
  }

  return null;
}

export function getContactTelemetry(
  viewpointShip: ShipRuntimeState | null,
  ship: ShipRuntimeState
): ContactTelemetry | null {
  if (!viewpointShip || viewpointShip.ship_instance_id === ship.ship_instance_id) {
    return null;
  }

  const delta = {
    x: ship.pose.position.x - viewpointShip.pose.position.x,
    y: ship.pose.position.y - viewpointShip.pose.position.y
  };
  const distance = Math.hypot(delta.x, delta.y);

  if (distance <= 0.001) {
    return null;
  }

  const relativeVelocity = {
    x: ship.pose.velocity.x - viewpointShip.pose.velocity.x,
    y: ship.pose.velocity.y - viewpointShip.pose.velocity.y
  };
  const radialRate = -((delta.x * relativeVelocity.x + delta.y * relativeVelocity.y) / distance);
  const closureLabel =
    radialRate > CLOSURE_EPSILON ? "closing" : radialRate < -CLOSURE_EPSILON ? "opening" : "steady";
  const rangeLabel = formatDistance(distance);

  return {
    range_label: rangeLabel,
    closure_label: closureLabel,
    summary_label: `${rangeLabel} · ${closureLabel}`
  };
}
