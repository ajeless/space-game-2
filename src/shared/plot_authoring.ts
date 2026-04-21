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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeDegrees(angle: number): number {
  const normalized = angle % 360;
  return normalized < 0 ? normalized + 360 : normalized;
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
      target_ship_instance_id: mount.target_ship_instance_ids[0] ?? null,
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
      const targetShipInstanceId = mount.target_ship_instance_ids.includes(current?.target_ship_instance_id ?? "")
        ? current?.target_ship_instance_id ?? null
        : mount.target_ship_instance_ids[0] ?? null;
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
