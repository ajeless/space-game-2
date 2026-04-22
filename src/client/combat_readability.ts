import type { PlotPreviewWeaponCue, ShipRuntimeState } from "../shared/index.js";

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

function getWeaponCueBlockedReason(cue: PlotPreviewWeaponCue): string {
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
