// Weapon targeting, arc evaluation, hit probability, and impact resolution for the sub-tick resolver.
// Depends on: shared contracts, derived accessors, determinism, and resolver math. Consumed by: the events and planning phases.
// Invariant: every non-deterministic roll routes through sampleUnitInterval for replayability.

import type {
  BattleState,
  ShipConfig,
  ShipRuntimeState,
  SystemId,
  Vector2,
  WeaponMountSystemConfig
} from "../contracts.js";
import {
  deriveSubsystemState,
  getShipConfig,
  getSystemConfig,
  getSystemStateAndEffects
} from "../derived.js";
import {
  clamp,
  distanceBetween,
  getWorldBearingDegrees,
  magnitudeOf,
  normalizeDegrees,
  shortestSignedAngleDelta,
  subtractVectors,
  transformHullLocalPointToWorld,
  transformWorldPointToHullLocal
} from "./math.js";

export interface WeaponOpportunity {
  mount_position: Vector2;
  target_position: Vector2;
  effective_charge_pips: number;
  base_damage: number;
  hit_probability: number;
}

export interface ResolvedImpact {
  impact_point: Vector2;
  impact_system_id?: SystemId;
}

function getBridgeTrackQualityFactor(state: BattleState, ship: ShipRuntimeState): number {
  const shipConfig = getShipConfig(state, ship);
  const bridgeConfig = shipConfig.systems.find((system) => system.type === "bridge");

  if (!bridgeConfig || bridgeConfig.type !== "bridge") {
    return 1;
  }

  const bridgeState = getSystemStateAndEffects(state, ship, bridgeConfig.id);

  return typeof bridgeState.effects.track_quality_factor === "number"
    ? bridgeState.effects.track_quality_factor
    : 1;
}

function getWeaponMountContext(
  state: BattleState,
  ship: ShipRuntimeState,
  mountId: SystemId,
  committedChargePips: number
): {
  mount_config: WeaponMountSystemConfig;
  effective_charge_pips: number;
  base_damage: number;
  mount_track_quality_factor: number;
} | null {
  const shipConfig = getShipConfig(state, ship);
  const mountConfig = getSystemConfig(shipConfig, mountId);

  if (mountConfig.type !== "weapon_mount") {
    throw new Error(`System '${mountId}' on '${shipConfig.id}' is not a weapon_mount`);
  }

  const mountState = getSystemStateAndEffects(state, ship, mountId);
  const firingEnabled =
    typeof mountState.effects.firing_enabled === "boolean" ? mountState.effects.firing_enabled : true;

  if (!firingEnabled || committedChargePips <= 0) {
    return null;
  }

  const chargePenalty =
    typeof mountState.effects.charge_penalty_pips === "number" ? mountState.effects.charge_penalty_pips : 0;
  const effectiveChargePips = Math.max(1, committedChargePips - chargePenalty);
  const chargeBand = mountConfig.parameters.charge_table.find((entry) => entry.pips === effectiveChargePips);

  if (!chargeBand) {
    return null;
  }

  return {
    mount_config: mountConfig,
    effective_charge_pips: effectiveChargePips,
    base_damage: chargeBand.damage,
    mount_track_quality_factor:
      typeof mountState.effects.track_quality_factor === "number" ? mountState.effects.track_quality_factor : 1
  };
}

export function evaluateWeaponOpportunity(
  state: BattleState,
  shooter: ShipRuntimeState,
  target: ShipRuntimeState,
  mountId: SystemId,
  committedChargePips: number,
  bearingSweepDegrees: number
): WeaponOpportunity | null {
  const mountContext = getWeaponMountContext(state, shooter, mountId, committedChargePips);

  if (!mountContext) {
    return null;
  }

  const { mount_config: mountConfig, effective_charge_pips, base_damage, mount_track_quality_factor } =
    mountContext;
  const mountPosition = transformHullLocalPointToWorld(shooter, mountConfig.physical_position);
  const targetPosition = { ...target.pose.position };
  const targetVector = subtractVectors(targetPosition, mountPosition);
  const range = magnitudeOf(targetVector);
  const targetBearingDegrees = getWorldBearingDegrees(targetVector);
  const mountCenterBearingDegrees = normalizeDegrees(
    shooter.pose.heading_degrees + mountConfig.parameters.bearing_degrees
  );
  const offCenterDegrees = Math.abs(shortestSignedAngleDelta(mountCenterBearingDegrees, targetBearingDegrees));

  if (offCenterDegrees > mountConfig.parameters.arc_degrees / 2) {
    return null;
  }

  const chargeBand = mountConfig.parameters.charge_table.find((entry) => entry.pips === effective_charge_pips);

  if (!chargeBand) {
    return null;
  }

  const rangeRatio = range / chargeBand.max_range_km;

  if (rangeRatio > 1) {
    return null;
  }

  const rangeConfig = state.match_setup.rules.hit_probability.range_factor;
  const rangeFactor = clamp(
    rangeConfig.max_factor - rangeConfig.slope * rangeRatio,
    rangeConfig.min_factor,
    rangeConfig.max_factor
  );
  const transverseConfig = state.match_setup.rules.hit_probability.transverse_factor;
  const transverseSpan = transverseConfig.max_factor - transverseConfig.min_factor;
  const transverseFactor = clamp(
    transverseConfig.max_factor -
      transverseSpan * (bearingSweepDegrees / transverseConfig.reference_bearing_sweep_deg),
    transverseConfig.min_factor,
    transverseConfig.max_factor
  );
  const bridgeTrackQualityFactor = getBridgeTrackQualityFactor(state, shooter);
  const unclampedProbability =
    mountConfig.parameters.baseline_track_quality *
    bridgeTrackQualityFactor *
    mount_track_quality_factor *
    rangeFactor *
    transverseFactor;
  const hitProbability = clamp(
    unclampedProbability,
    state.match_setup.rules.hit_probability.min_probability,
    state.match_setup.rules.hit_probability.max_probability
  );

  return {
    mount_position: mountPosition,
    target_position: targetPosition,
    effective_charge_pips: effective_charge_pips,
    base_damage: base_damage,
    hit_probability: hitProbability
  };
}

function cross(left: Vector2, right: Vector2): number {
  return left.x * right.y - left.y * right.x;
}

function add(left: Vector2, right: Vector2): Vector2 {
  return {
    x: left.x + right.x,
    y: left.y + right.y
  };
}

function scale(vector: Vector2, scalar: number): Vector2 {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar
  };
}

function getImpactPointLocal(targetConfig: ShipConfig, shooterLocal: Vector2): Vector2 {
  const polygon = targetConfig.hull.silhouette;
  const rayDelta = {
    x: -shooterLocal.x,
    y: -shooterLocal.y
  };
  let bestT = Number.POSITIVE_INFINITY;
  let bestIntersection: Vector2 | null = null;

  for (let index = 0; index < polygon.length; index += 1) {
    const edgeStart = polygon[index]!;
    const edgeEnd = polygon[(index + 1) % polygon.length]!;
    const edgeDelta = subtractVectors(edgeEnd, edgeStart);
    const denominator = cross(rayDelta, edgeDelta);

    if (Math.abs(denominator) < 1e-9) {
      continue;
    }

    const fromShooterToEdgeStart = subtractVectors(edgeStart, shooterLocal);
    const t = cross(fromShooterToEdgeStart, edgeDelta) / denominator;
    const u = cross(fromShooterToEdgeStart, rayDelta) / denominator;

    if (t < 0 || t > 1 || u < 0 || u > 1) {
      continue;
    }

    if (t < bestT) {
      bestT = t;
      bestIntersection = add(shooterLocal, scale(rayDelta, t));
    }
  }

  return bestIntersection ?? { x: 0, y: 0 };
}

export function resolveImpact(
  state: BattleState,
  target: ShipRuntimeState,
  shooterOrigin: Vector2
): ResolvedImpact {
  const targetConfig = getShipConfig(state, target);
  const shooterLocal = transformWorldPointToHullLocal(target, shooterOrigin);
  const impactPointLocal = getImpactPointLocal(targetConfig, shooterLocal);
  const impactPoint = transformHullLocalPointToWorld(target, impactPointLocal);
  const localHit = state.match_setup.rules.damage.local_hit_resolution;

  let impactSystemId: SystemId | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const system of [...targetConfig.systems].sort((left, right) => left.id.localeCompare(right.id))) {
    const distance = distanceBetween(system.physical_position, impactPointLocal);

    if (distance <= localHit.radius_hull_units && distance < bestDistance) {
      bestDistance = distance;
      impactSystemId = system.id;
    }
  }

  return impactSystemId !== undefined
    ? {
        impact_point: impactPoint,
        impact_system_id: impactSystemId
      }
    : {
        impact_point: impactPoint
      };
}

export function getSubsystemStateLabel(
  state: BattleState,
  ship: ShipRuntimeState,
  systemId: SystemId
): "operational" | "degraded" | "offline" {
  const shipConfig = getShipConfig(state, ship);
  const systemConfig = getSystemConfig(shipConfig, systemId);
  const runtimeSystem = ship.systems[systemId];

  if (!runtimeSystem) {
    throw new Error(`Ship '${ship.ship_instance_id}' is missing runtime system '${systemId}'`);
  }

  return deriveSubsystemState(
    runtimeSystem.current_integrity,
    systemConfig.max_integrity,
    state.match_setup.rules
  );
}
