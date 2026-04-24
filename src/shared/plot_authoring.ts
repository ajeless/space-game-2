// PlotDraft authoring helpers: create, mutate, summarize, and build a server-ready PlotSubmission from a draft.
// Depends on: shared contracts and derived accessors. Consumed by: src/client/** plot UI and tests.
// Invariant: mutators return fresh drafts; callers must not mutate the returned object in place.

import type {
  BattleState,
  PlotSubmission,
  ShipInstanceId,
  SystemId,
  Vector2,
  WeaponMountSystemConfig
} from "./contracts.js";
import { getAvailableReactorPips, getShipConfig, getSystemConfig, getSystemStateAndEffects } from "./derived.js";

export interface PlotDraftWeaponAssignment {
  mount_id: SystemId;
  target_ship_instance_id: ShipInstanceId | null;
  charge_pips: number;
}

export interface PlotDraft {
  ship_instance_id: ShipInstanceId;
  turn_number: number;
  heading_delta_degrees: number;
  thrust_input: {
    lateral_fraction: number;
    axial_fraction: number;
  };
  weapons: PlotDraftWeaponAssignment[];
}

export interface PlotAuthoringMountContext {
  mount_id: SystemId;
  label: string;
  allowed_charge_pips: number[];
  target_ship_instance_ids: ShipInstanceId[];
  firing_enabled: boolean;
}

export interface PlotAuthoringContext {
  ship_instance_id: ShipInstanceId;
  turn_number: number;
  current_heading_degrees: number;
  effective_turn_cap_degrees: number;
  available_reactor_pips: number;
  weapon_mounts: PlotAuthoringMountContext[];
}

export interface PlotDraftSummary {
  context: PlotAuthoringContext;
  draft: PlotDraft;
  power: {
    drive_pips: number;
    railgun_pips: number;
  };
  desired_end_heading_degrees: number;
  world_thrust_fraction: Vector2;
}

function updatePlotDraftWeaponAssignment(
  draft: PlotDraft,
  mountId: SystemId,
  mutate: (weapon: PlotDraftWeaponAssignment) => PlotDraftWeaponAssignment
): PlotDraft {
  return {
    ...draft,
    weapons: draft.weapons.map((weapon) => (weapon.mount_id === mountId ? mutate(weapon) : weapon))
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeDegrees(angle: number): number {
  const normalized = angle % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function getShortestSignedAngleDelta(fromDegrees: number, toDegrees: number): number {
  const delta = (toDegrees - fromDegrees + 540) % 360 - 180;

  return delta === -180 ? 180 : delta;
}

function clampUnitVector(vector: Vector2): Vector2 {
  const clamped = {
    x: clamp(vector.x, -1, 1),
    y: clamp(vector.y, -1, 1)
  };
  const magnitude = Math.hypot(clamped.x, clamped.y);

  if (magnitude <= 1 || magnitude === 0) {
    return clamped;
  }

  return {
    x: clamped.x / magnitude,
    y: clamped.y / magnitude
  };
}

function getEffectiveTurnCapDegrees(state: BattleState, shipInstanceId: ShipInstanceId): number {
  const ship = state.ships[shipInstanceId];

  if (!ship) {
    throw new Error(`Unknown ship '${shipInstanceId}'`);
  }

  const shipConfig = getShipConfig(state, ship);
  const bridge = shipConfig.systems.find((system) => system.type === "bridge");

  if (!bridge || bridge.type !== "bridge") {
    return shipConfig.dynamics.max_turn_degrees_per_turn;
  }

  const bridgeState = getSystemStateAndEffects(state, ship, bridge.id);
  const factor = typeof bridgeState.effects.turn_cap_factor === "number" ? bridgeState.effects.turn_cap_factor : 1;

  return shipConfig.dynamics.max_turn_degrees_per_turn * factor;
}

function getWeaponMountChargeOptions(mount: WeaponMountSystemConfig): number[] {
  return [...new Set(mount.parameters.charge_table.map((entry) => entry.pips))].sort((left, right) => left - right);
}

function getAvailableDriveThrustForDraft(state: BattleState, draft: PlotDraft): number {
  const ship = state.ships[draft.ship_instance_id];

  if (!ship) {
    throw new Error(`Unknown ship '${draft.ship_instance_id}'`);
  }

  const shipConfig = getShipConfig(state, ship);
  const driveConfig = shipConfig.systems.find((system) => system.type === "drive");

  if (!driveConfig || driveConfig.type !== "drive") {
    throw new Error(`Ship config '${shipConfig.id}' does not have a drive system`);
  }

  const availableReactorPips = getAvailableReactorPips(state, ship);
  const allocatedRailgunPips = draft.weapons.reduce((sum, weapon) => sum + weapon.charge_pips, 0);
  const drivePips = Math.max(0, availableReactorPips - allocatedRailgunPips);
  const driveState = getSystemStateAndEffects(state, ship, driveConfig.id);
  const driveAuthorityFactor =
    typeof driveState.effects.drive_authority_factor === "number" ? driveState.effects.drive_authority_factor : 1;
  const driveFraction = availableReactorPips <= 0 ? 0 : drivePips / availableReactorPips;

  return driveConfig.parameters.max_thrust * driveFraction * driveAuthorityFactor;
}

function getWeaponMountContexts(state: BattleState, shipInstanceId: ShipInstanceId): PlotAuthoringMountContext[] {
  const ship = state.ships[shipInstanceId];

  if (!ship) {
    throw new Error(`Unknown ship '${shipInstanceId}'`);
  }

  const shipConfig = getShipConfig(state, ship);
  const targetShipIds = state.match_setup.participants
    .map((participant) => participant.ship_instance_id)
    .filter((candidate) => candidate !== shipInstanceId && state.ships[candidate]?.status === "active")
    .sort();

  return shipConfig.systems
    .filter((system): system is WeaponMountSystemConfig => system.type === "weapon_mount")
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((mount) => {
      const mountState = getSystemStateAndEffects(state, ship, mount.id);
      const firingEnabled =
        typeof mountState.effects.firing_enabled === "boolean" ? mountState.effects.firing_enabled : true;

      return {
        mount_id: mount.id,
        label: mount.render?.label ?? mount.id.replaceAll("_", " "),
        allowed_charge_pips:
          firingEnabled && targetShipIds.length > 0 ? getWeaponMountChargeOptions(mount) : [],
        target_ship_instance_ids: targetShipIds,
        firing_enabled: firingEnabled
      };
    });
}

function getClampedChargePips(requestedChargePips: number, allowedChargePips: number[], remainingPips: number): number {
  const requested = Math.max(0, Math.trunc(Number.isFinite(requestedChargePips) ? requestedChargePips : 0));
  let best = 0;

  for (const allowed of allowedChargePips) {
    if (allowed > requested || allowed > remainingPips) {
      break;
    }

    best = allowed;
  }

  return best;
}

function getLocalThrustVector(draft: PlotDraft): Vector2 {
  return clampUnitVector({
    x: draft.thrust_input.lateral_fraction,
    y: draft.thrust_input.axial_fraction
  });
}

function transformLocalThrustToWorld(localThrust: Vector2, headingDegrees: number): Vector2 {
  const radians = (headingDegrees * Math.PI) / 180;
  const forward = {
    x: Math.sin(radians),
    y: Math.cos(radians)
  };
  const starboard = {
    x: Math.cos(radians),
    y: -Math.sin(radians)
  };

  return {
    x: forward.x * localThrust.y + starboard.x * localThrust.x,
    y: forward.y * localThrust.y + starboard.y * localThrust.x
  };
}

export function transformWorldThrustToLocal(worldThrust: Vector2, headingDegrees: number): Vector2 {
  const radians = (headingDegrees * Math.PI) / 180;
  const forward = {
    x: Math.sin(radians),
    y: Math.cos(radians)
  };
  const starboard = {
    x: Math.cos(radians),
    y: -Math.sin(radians)
  };

  return {
    x: worldThrust.x * starboard.x + worldThrust.y * starboard.y,
    y: worldThrust.x * forward.x + worldThrust.y * forward.y
  };
}

export function getPlotAuthoringContext(state: BattleState, shipInstanceId: ShipInstanceId): PlotAuthoringContext {
  const ship = state.ships[shipInstanceId];

  if (!ship) {
    throw new Error(`Unknown ship '${shipInstanceId}'`);
  }

  return {
    ship_instance_id: shipInstanceId,
    turn_number: state.turn_number,
    current_heading_degrees: ship.pose.heading_degrees,
    effective_turn_cap_degrees: getEffectiveTurnCapDegrees(state, shipInstanceId),
    available_reactor_pips: getAvailableReactorPips(state, ship),
    weapon_mounts: getWeaponMountContexts(state, shipInstanceId)
  };
}

export function createPlotDraft(state: BattleState, shipInstanceId: ShipInstanceId): PlotDraft {
  const context = getPlotAuthoringContext(state, shipInstanceId);

  return {
    ship_instance_id: shipInstanceId,
    turn_number: context.turn_number,
    heading_delta_degrees: 0,
    thrust_input: {
      lateral_fraction: 0,
      axial_fraction: 0
    },
    weapons: context.weapon_mounts.map((mount) => ({
      mount_id: mount.mount_id,
      target_ship_instance_id: null,
      charge_pips: 0
    }))
  };
}

export function normalizePlotDraft(state: BattleState, draft: PlotDraft): PlotDraft {
  const context = getPlotAuthoringContext(state, draft.ship_instance_id);
  const byMountId = new Map(draft.weapons.map((weapon) => [weapon.mount_id, weapon]));
  let remainingWeaponPips = context.available_reactor_pips;
  const localThrust = getLocalThrustVector(draft);

  return {
    ship_instance_id: context.ship_instance_id,
    turn_number: context.turn_number,
    heading_delta_degrees: clamp(
      Number.isFinite(draft.heading_delta_degrees) ? draft.heading_delta_degrees : 0,
      -context.effective_turn_cap_degrees,
      context.effective_turn_cap_degrees
    ),
    thrust_input: {
      lateral_fraction: localThrust.x,
      axial_fraction: localThrust.y
    },
    weapons: context.weapon_mounts.map((mount) => {
      const current = byMountId.get(mount.mount_id);
      const targetShipInstanceId =
        current?.target_ship_instance_id && mount.target_ship_instance_ids.includes(current.target_ship_instance_id)
          ? current.target_ship_instance_id
          : null;
      const chargePips =
        targetShipInstanceId && mount.firing_enabled
          ? getClampedChargePips(current?.charge_pips ?? 0, mount.allowed_charge_pips, remainingWeaponPips)
          : 0;

      remainingWeaponPips -= chargePips;

      return {
        mount_id: mount.mount_id,
        target_ship_instance_id: targetShipInstanceId,
        charge_pips: chargePips
      };
    })
  };
}

export function setPlotDraftWeaponTarget(
  state: BattleState,
  draft: PlotDraft,
  mountId: SystemId,
  targetShipInstanceId: ShipInstanceId
): PlotDraft {
  const context = getPlotAuthoringContext(state, draft.ship_instance_id);
  const mount = context.weapon_mounts.find((candidate) => candidate.mount_id === mountId);

  if (!mount || !mount.firing_enabled || !mount.target_ship_instance_ids.includes(targetShipInstanceId)) {
    return normalizePlotDraft(state, draft);
  }

  const minimumChargePips = mount.allowed_charge_pips[0] ?? 0;

  return normalizePlotDraft(
    state,
    updatePlotDraftWeaponAssignment(draft, mountId, (weapon) => ({
      ...weapon,
      target_ship_instance_id: targetShipInstanceId,
      charge_pips: Math.max(weapon.charge_pips, minimumChargePips)
    }))
  );
}

export function clearPlotDraftWeaponIntent(state: BattleState, draft: PlotDraft, mountId: SystemId): PlotDraft {
  return normalizePlotDraft(
    state,
    updatePlotDraftWeaponAssignment(draft, mountId, (weapon) => ({
      ...weapon,
      target_ship_instance_id: null,
      charge_pips: 0
    }))
  );
}

export function setPlotDraftDesiredEndHeading(
  state: BattleState,
  draft: PlotDraft,
  desiredEndHeadingDegrees: number
): PlotDraft {
  const context = getPlotAuthoringContext(state, draft.ship_instance_id);
  const desiredHeading = normalizeDegrees(
    Number.isFinite(desiredEndHeadingDegrees) ? desiredEndHeadingDegrees : context.current_heading_degrees
  );

  return normalizePlotDraft(state, {
    ...draft,
    heading_delta_degrees: getShortestSignedAngleDelta(context.current_heading_degrees, desiredHeading)
  });
}

export function setPlotDraftWorldThrust(state: BattleState, draft: PlotDraft, worldThrustFraction: Vector2): PlotDraft {
  const context = getPlotAuthoringContext(state, draft.ship_instance_id);
  const localThrust = transformWorldThrustToLocal(clampUnitVector(worldThrustFraction), context.current_heading_degrees);

  return normalizePlotDraft(state, {
    ...draft,
    thrust_input: {
      lateral_fraction: localThrust.x,
      axial_fraction: localThrust.y
    }
  });
}

export function setPlotDraftStationKeeping(state: BattleState, draft: PlotDraft): PlotDraft {
  const normalizedDraft = normalizePlotDraft(state, draft);
  const ship = state.ships[normalizedDraft.ship_instance_id];

  if (!ship) {
    throw new Error(`Unknown ship '${normalizedDraft.ship_instance_id}'`);
  }

  const availableThrustThisTurn = getAvailableDriveThrustForDraft(state, normalizedDraft);

  if (availableThrustThisTurn <= 0) {
    return setPlotDraftWorldThrust(state, normalizedDraft, { x: 0, y: 0 });
  }

  const shipConfig = getShipConfig(state, ship);
  const turnDurationSeconds = state.match_setup.rules.turn.duration_seconds;
  const requiredThrust = {
    x: (-ship.pose.velocity.x * shipConfig.dynamics.mass) / turnDurationSeconds,
    y: (-ship.pose.velocity.y * shipConfig.dynamics.mass) / turnDurationSeconds
  };

  return setPlotDraftWorldThrust(state, normalizedDraft, {
    x: requiredThrust.x / availableThrustThisTurn,
    y: requiredThrust.y / availableThrustThisTurn
  });
}

export function summarizePlotDraft(state: BattleState, draft: PlotDraft): PlotDraftSummary {
  const normalizedDraft = normalizePlotDraft(state, draft);
  const context = getPlotAuthoringContext(state, normalizedDraft.ship_instance_id);
  const railgunPips = normalizedDraft.weapons.reduce((sum, weapon) => sum + weapon.charge_pips, 0);
  const drivePips = context.available_reactor_pips - railgunPips;
  const worldThrust = transformLocalThrustToWorld(
    getLocalThrustVector(normalizedDraft),
    context.current_heading_degrees
  );

  return {
    context,
    draft: normalizedDraft,
    power: {
      drive_pips: drivePips,
      railgun_pips: railgunPips
    },
    desired_end_heading_degrees: normalizeDegrees(
      context.current_heading_degrees + normalizedDraft.heading_delta_degrees
    ),
    world_thrust_fraction: worldThrust
  };
}

export function buildPlotSubmissionFromDraft(state: BattleState, draft: PlotDraft): PlotSubmission {
  const summary = summarizePlotDraft(state, draft);

  return {
    schema_version: "sg2/v0.1",
    match_id: state.match_setup.match_id,
    turn_number: state.turn_number,
    ship_instance_id: summary.context.ship_instance_id,
    power: summary.power,
    maneuver: {
      desired_end_heading_degrees: summary.desired_end_heading_degrees,
      translation_plan: {
        kind: "piecewise_linear",
        frame: "world",
        knots: [
          { t: 0, thrust_fraction: summary.world_thrust_fraction },
          { t: 1, thrust_fraction: summary.world_thrust_fraction }
        ]
      }
    },
    weapons: summary.draft.weapons
      .filter((weapon) => weapon.charge_pips > 0 && weapon.target_ship_instance_id !== null)
      .map((weapon) => ({
        mount_id: weapon.mount_id,
        target_ship_instance_id: weapon.target_ship_instance_id!,
        fire_mode: "best_shot_this_turn",
        charge_pips: weapon.charge_pips
      }))
  };
}
