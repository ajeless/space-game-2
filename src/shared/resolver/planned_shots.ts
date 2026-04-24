// Turn-scoped shot planning: picks the best sub-tick for each weapon mount given the projected motion of both ships.
// Depends on: resolver combat, motion, math, and shared derivations. Consumed by: resolver/index.ts and plot_preview.
// Invariant: the returned map is keyed by getPlannedShotKey(shipId, mountId) and is stable for a given input pair.

import type { BattleState, PlotSubmission, ShipInstanceId, ShipRuntimeState } from "../contracts.js";
import { getShipConfig, getSystemConfig } from "../derived.js";
import { evaluateWeaponOpportunity } from "./combat.js";
import {
  getWorldBearingDegrees,
  shortestSignedAngleDelta,
  subtractVectors,
  transformHullLocalPointToWorld
} from "./math.js";
import { advanceShipDynamics } from "./motion.js";
import type { PlannedWeaponShot } from "./types.js";

type PoseSnapshot = ShipRuntimeState["pose"];

const HIT_PROBABILITY_EPSILON = 1e-9;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function withPose(ship: ShipRuntimeState, pose: PoseSnapshot): ShipRuntimeState {
  return {
    ...ship,
    pose: clone(pose)
  };
}

function buildPredictedPoses(
  state: BattleState,
  plotsByShip: Record<ShipInstanceId, PlotSubmission>,
  sortedShipIds: ShipInstanceId[]
): Record<ShipInstanceId, PoseSnapshot[]> {
  const predictedState = clone(state);
  const snapshots: Record<ShipInstanceId, PoseSnapshot[]> = Object.fromEntries(
    sortedShipIds.map((shipId) => [shipId, []])
  ) as Record<ShipInstanceId, PoseSnapshot[]>;

  for (let subTick = 0; subTick < predictedState.match_setup.rules.turn.sub_ticks; subTick += 1) {
    for (const shipId of sortedShipIds) {
      const ship = predictedState.ships[shipId];
      const plot = plotsByShip[shipId];

      if (!ship || !plot || ship.status !== "active") {
        continue;
      }

      advanceShipDynamics(predictedState, ship, plot, subTick);
    }

    for (const shipId of sortedShipIds) {
      const ship = predictedState.ships[shipId];

      if (!ship) {
        continue;
      }

      snapshots[shipId]!.push(clone(ship.pose));
    }
  }

  return snapshots;
}

function calculateBearingSweepDegrees(
  state: BattleState,
  shooter: ShipRuntimeState,
  target: ShipRuntimeState,
  mountId: string,
  subTick: number,
  snapshots: Record<ShipInstanceId, PoseSnapshot[]>
): number {
  const shooterConfig = getShipConfig(state, shooter);
  const mountConfig = getSystemConfig(shooterConfig, mountId);

  if (mountConfig.type !== "weapon_mount") {
    throw new Error(`System '${mountId}' on '${shooterConfig.id}' is not a weapon_mount`);
  }

  const window = state.match_setup.rules.hit_probability.transverse_factor.measurement_window_sub_ticks;
  const halfWindow = Math.floor(window / 2);
  const shooterSnapshots = snapshots[shooter.ship_instance_id] ?? [];
  const targetSnapshots = snapshots[target.ship_instance_id] ?? [];
  const endIndexMax = Math.min(shooterSnapshots.length, targetSnapshots.length) - 1;

  if (endIndexMax < 0) {
    return 0;
  }

  const startIndex = Math.max(0, subTick - halfWindow);
  const endIndex = Math.min(endIndexMax, subTick + halfWindow);
  const shooterStart = withPose(shooter, shooterSnapshots[startIndex]!);
  const shooterEnd = withPose(shooter, shooterSnapshots[endIndex]!);
  const targetStart = withPose(target, targetSnapshots[startIndex]!);
  const targetEnd = withPose(target, targetSnapshots[endIndex]!);
  const startMountPosition = transformHullLocalPointToWorld(shooterStart, mountConfig.physical_position);
  const endMountPosition = transformHullLocalPointToWorld(shooterEnd, mountConfig.physical_position);
  const startBearing = getWorldBearingDegrees(subtractVectors(targetStart.pose.position, startMountPosition));
  const endBearing = getWorldBearingDegrees(subtractVectors(targetEnd.pose.position, endMountPosition));

  return Math.abs(shortestSignedAngleDelta(startBearing, endBearing));
}

export function getPlannedShotKey(actorShipId: ShipInstanceId, mountId: string): string {
  return `${actorShipId}:${mountId}`;
}

export function buildPlannedShots(
  state: BattleState,
  plotsByShip: Record<ShipInstanceId, PlotSubmission>,
  sortedShipIds: ShipInstanceId[]
): Record<string, PlannedWeaponShot> {
  const snapshots = buildPredictedPoses(state, plotsByShip, sortedShipIds);
  const plannedShots: Record<string, PlannedWeaponShot> = {};
  const subTicksPerTurn = state.match_setup.rules.turn.sub_ticks;

  for (const actorShipId of sortedShipIds) {
    const shooter = state.ships[actorShipId];
    const plot = plotsByShip[actorShipId];

    if (!shooter || !plot || shooter.status !== "active") {
      continue;
    }

    for (const weapon of [...plot.weapons].sort((left, right) => left.mount_id.localeCompare(right.mount_id))) {
      if (weapon.fire_mode !== "best_shot_this_turn") {
        continue;
      }

      const target = state.ships[weapon.target_ship_instance_id];

      if (!target || target.status !== "active") {
        continue;
      }

      let bestShot: PlannedWeaponShot | null = null;

      for (let subTick = 0; subTick < subTicksPerTurn; subTick += 1) {
        const shooterPose = snapshots[actorShipId]?.[subTick];
        const targetPose = snapshots[weapon.target_ship_instance_id]?.[subTick];

        if (!shooterPose || !targetPose) {
          continue;
        }

        const predictedShooter = withPose(shooter, shooterPose);
        const predictedTarget = withPose(target, targetPose);
        const bearingSweepDegrees = calculateBearingSweepDegrees(
          state,
          predictedShooter,
          predictedTarget,
          weapon.mount_id,
          subTick,
          snapshots
        );
        const opportunity = evaluateWeaponOpportunity(
          state,
          predictedShooter,
          predictedTarget,
          weapon.mount_id,
          weapon.charge_pips,
          bearingSweepDegrees
        );

        if (!opportunity) {
          continue;
        }

        if (
          !bestShot ||
          opportunity.hit_probability > bestShot.predicted_hit_probability + HIT_PROBABILITY_EPSILON ||
          (Math.abs(opportunity.hit_probability - bestShot.predicted_hit_probability) <= HIT_PROBABILITY_EPSILON &&
            subTick < bestShot.fire_sub_tick)
        ) {
          bestShot = {
            actor_ship_id: actorShipId,
            target_ship_id: weapon.target_ship_instance_id,
            mount_id: weapon.mount_id,
            fire_sub_tick: subTick,
            predicted_bearing_sweep_degrees: bearingSweepDegrees,
            predicted_hit_probability: opportunity.hit_probability
          };
        }
      }

      if (bestShot) {
        plannedShots[getPlannedShotKey(actorShipId, weapon.mount_id)] = bestShot;
      }
    }
  }

  return plannedShots;
}
