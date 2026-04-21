import type { BattleState, PlotSubmission, ShipRuntimeState, Vector2 } from "../contracts.js";
import { getAvailableReactorPips, getShipConfig, getSystemStateAndEffects } from "../derived.js";
import { clamp, normalizeDegrees, shortestSignedAngleDelta } from "./math.js";

function clampMagnitude(vector: Vector2, maxMagnitude: number): Vector2 {
  const magnitude = Math.hypot(vector.x, vector.y);

  if (magnitude === 0 || magnitude <= maxMagnitude) {
    return vector;
  }

  const scale = maxMagnitude / magnitude;

  return {
    x: vector.x * scale,
    y: vector.y * scale
  };
}

export function interpolateTranslationPlan(plot: PlotSubmission, sampleT: number): Vector2 {
  const knots = plot.maneuver.translation_plan.knots;

  if (sampleT <= knots[0]!.t) {
    return knots[0]!.thrust_fraction;
  }

  for (let index = 1; index < knots.length; index += 1) {
    const previous = knots[index - 1]!;
    const current = knots[index]!;

    if (sampleT <= current.t) {
      const span = current.t - previous.t;
      const localT = span === 0 ? 0 : (sampleT - previous.t) / span;

      return {
        x: previous.thrust_fraction.x + (current.thrust_fraction.x - previous.thrust_fraction.x) * localT,
        y: previous.thrust_fraction.y + (current.thrust_fraction.y - previous.thrust_fraction.y) * localT
      };
    }
  }

  return knots[knots.length - 1]!.thrust_fraction;
}

function getDriveContext(
  state: BattleState,
  ship: ShipRuntimeState,
  plot: PlotSubmission
): {
  availableThrustThisTurn: number;
} {
  const shipConfig = getShipConfig(state, ship);
  const driveConfig = shipConfig.systems.find((system) => system.type === "drive");

  if (!driveConfig || driveConfig.type !== "drive") {
    throw new Error(`Ship config '${shipConfig.id}' does not have a drive system`);
  }

  const availableReactorPips = getAvailableReactorPips(state, ship);
  const driveFraction = availableReactorPips <= 0 ? 0 : plot.power.drive_pips / availableReactorPips;
  const driveState = getSystemStateAndEffects(state, ship, driveConfig.id);
  const driveAuthorityFactor =
    typeof driveState.effects.drive_authority_factor === "number" ? driveState.effects.drive_authority_factor : 1;

  return {
    availableThrustThisTurn: driveConfig.parameters.max_thrust * driveFraction * driveAuthorityFactor
  };
}

function getEffectiveTurnCap(state: BattleState, ship: ShipRuntimeState): number {
  const shipConfig = getShipConfig(state, ship);
  const bridgeConfig = shipConfig.systems.find((system) => system.type === "bridge");

  if (!bridgeConfig || bridgeConfig.type !== "bridge") {
    return shipConfig.dynamics.max_turn_degrees_per_turn;
  }

  const bridgeState = getSystemStateAndEffects(state, ship, bridgeConfig.id);
  const factor = typeof bridgeState.effects.turn_cap_factor === "number" ? bridgeState.effects.turn_cap_factor : 1;

  return shipConfig.dynamics.max_turn_degrees_per_turn * factor;
}

export function advanceShipDynamics(
  state: BattleState,
  ship: ShipRuntimeState,
  plot: PlotSubmission,
  subTick: number
): {
  applied_thrust: Vector2;
} {
  const shipConfig = getShipConfig(state, ship);
  const subTicksPerTurn = state.match_setup.rules.turn.sub_ticks;
  const dt = 1 / subTicksPerTurn;
  const sampleT = (subTick + 0.5) / subTicksPerTurn;
  const { availableThrustThisTurn } = getDriveContext(state, ship, plot);
  const thrustFraction = interpolateTranslationPlan(plot, sampleT);
  const appliedThrust = clampMagnitude(
    {
      x: thrustFraction.x * availableThrustThisTurn,
      y: thrustFraction.y * availableThrustThisTurn
    },
    availableThrustThisTurn
  );
  const acceleration = {
    x: appliedThrust.x / shipConfig.dynamics.mass,
    y: appliedThrust.y / shipConfig.dynamics.mass
  };

  ship.pose.velocity.x += acceleration.x * dt;
  ship.pose.velocity.y += acceleration.y * dt;
  ship.pose.position.x += ship.pose.velocity.x * dt;
  ship.pose.position.y += ship.pose.velocity.y * dt;

  const perSubTickTurnCap = getEffectiveTurnCap(state, ship) / subTicksPerTurn;
  const headingDelta = shortestSignedAngleDelta(
    ship.pose.heading_degrees,
    plot.maneuver.desired_end_heading_degrees
  );
  const headingStep = clamp(headingDelta, -perSubTickTurnCap, perSubTickTurnCap);

  ship.pose.heading_degrees = normalizeDegrees(ship.pose.heading_degrees + headingStep);

  return {
    applied_thrust: appliedThrust
  };
}
