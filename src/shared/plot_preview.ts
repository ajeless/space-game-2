import type {
  BattleState,
  PlotSubmission,
  ShipInstanceId,
  ShipRuntimeState,
  Vector2,
  WeaponMountSystemConfig
} from "./contracts.js";
import { getShipConfig, getSystemStateAndEffects } from "./derived.js";
import type { PlotDraft } from "./plot_authoring.js";
import { buildPlotSubmissionFromDraft, summarizePlotDraft } from "./plot_authoring.js";
import { advanceShipDynamics } from "./resolver/motion.js";
import {
  addVectors,
  getWorldBearingDegrees,
  magnitudeOf,
  normalizeDegrees,
  shortestSignedAngleDelta,
  transformHullLocalPointToWorld
} from "./resolver/math.js";

export interface PlotPreviewSample {
  sub_tick: number;
  position: Vector2;
  heading_degrees: number;
}

export interface PlotPreviewWeaponCue {
  mount_id: string;
  label: string;
  target_ship_instance_id: ShipInstanceId;
  charge_pips: number;
  effective_charge_pips: number;
  max_range_km: number;
  mount_position: Vector2;
  target_position: Vector2;
  target_bearing_degrees: number;
  arc_center_bearing_degrees: number;
  arc_start_bearing_degrees: number;
  arc_end_bearing_degrees: number;
  target_in_arc: boolean;
  target_in_range: boolean;
}

export interface PlotPreview {
  ship_instance_id: ShipInstanceId;
  plot: PlotSubmission;
  desired_end_heading_degrees: number;
  projected_path: PlotPreviewSample[];
  projected_pose: ShipRuntimeState["pose"];
  weapon_cues: PlotPreviewWeaponCue[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function getWeaponRangeContext(
  state: BattleState,
  ship: ShipRuntimeState,
  mount: WeaponMountSystemConfig,
  committedChargePips: number
):
  | {
      effective_charge_pips: number;
      max_range_km: number;
    }
  | null {
  const mountState = getSystemStateAndEffects(state, ship, mount.id);
  const firingEnabled =
    typeof mountState.effects.firing_enabled === "boolean" ? mountState.effects.firing_enabled : true;

  if (!firingEnabled || committedChargePips <= 0) {
    return null;
  }

  const chargePenalty =
    typeof mountState.effects.charge_penalty_pips === "number" ? mountState.effects.charge_penalty_pips : 0;
  const effectiveChargePips = Math.max(1, committedChargePips - chargePenalty);
  const chargeBand = mount.parameters.charge_table.find((entry) => entry.pips === effectiveChargePips);

  if (!chargeBand) {
    return null;
  }

  return {
    effective_charge_pips: effectiveChargePips,
    max_range_km: chargeBand.max_range_km
  };
}

export function buildPlotPreview(state: BattleState, draft: PlotDraft): PlotPreview {
  const summary = summarizePlotDraft(state, draft);
  const plot = buildPlotSubmissionFromDraft(state, summary.draft);
  const projectedState = clone(state);
  const ship = projectedState.ships[plot.ship_instance_id];

  if (!ship) {
    throw new Error(`Unknown ship '${plot.ship_instance_id}'`);
  }

  const shipConfig = getShipConfig(projectedState, ship);
  const projectedPath: PlotPreviewSample[] = [
    {
      sub_tick: 0,
      position: { ...ship.pose.position },
      heading_degrees: ship.pose.heading_degrees
    }
  ];

  for (let subTick = 0; subTick < projectedState.match_setup.rules.turn.sub_ticks; subTick += 1) {
    advanceShipDynamics(projectedState, ship, plot, subTick);
    projectedPath.push({
      sub_tick: subTick + 1,
      position: { ...ship.pose.position },
      heading_degrees: ship.pose.heading_degrees
    });
  }

  const liveShip = state.ships[plot.ship_instance_id];

  if (!liveShip) {
    throw new Error(`Unknown live ship '${plot.ship_instance_id}'`);
  }

  const weaponCues = summary.draft.weapons
    .filter((weapon) => weapon.charge_pips > 0 && weapon.target_ship_instance_id !== null)
    .map((weapon) => {
      const mount = shipConfig.systems.find((system): system is WeaponMountSystemConfig => {
        return system.id === weapon.mount_id && system.type === "weapon_mount";
      });

      if (!mount) {
        return null;
      }

      const targetShip = state.ships[weapon.target_ship_instance_id!];

      if (!targetShip) {
        return null;
      }

      const rangeContext = getWeaponRangeContext(state, liveShip, mount, weapon.charge_pips);

      if (!rangeContext) {
        return null;
      }

      const mountPosition = transformHullLocalPointToWorld(liveShip, mount.physical_position);
      const delta = {
        x: targetShip.pose.position.x - mountPosition.x,
        y: targetShip.pose.position.y - mountPosition.y
      };
      const targetBearingDegrees = getWorldBearingDegrees(delta);
      const arcCenterBearingDegrees = normalizeDegrees(liveShip.pose.heading_degrees + mount.parameters.bearing_degrees);
      const offCenterDegrees = Math.abs(shortestSignedAngleDelta(arcCenterBearingDegrees, targetBearingDegrees));

      return {
        mount_id: mount.id,
        label: mount.render?.label ?? mount.id.replaceAll("_", " "),
        target_ship_instance_id: targetShip.ship_instance_id,
        charge_pips: weapon.charge_pips,
        effective_charge_pips: rangeContext.effective_charge_pips,
        max_range_km: rangeContext.max_range_km,
        mount_position: mountPosition,
        target_position: { ...targetShip.pose.position },
        target_bearing_degrees: targetBearingDegrees,
        arc_center_bearing_degrees: arcCenterBearingDegrees,
        arc_start_bearing_degrees: normalizeDegrees(arcCenterBearingDegrees - mount.parameters.arc_degrees / 2),
        arc_end_bearing_degrees: normalizeDegrees(arcCenterBearingDegrees + mount.parameters.arc_degrees / 2),
        target_in_arc: offCenterDegrees <= mount.parameters.arc_degrees / 2,
        target_in_range: magnitudeOf(delta) <= rangeContext.max_range_km
      } satisfies PlotPreviewWeaponCue;
    })
    .filter((cue): cue is PlotPreviewWeaponCue => cue !== null);

  return {
    ship_instance_id: plot.ship_instance_id,
    plot,
    desired_end_heading_degrees: summary.desired_end_heading_degrees,
    projected_path: projectedPath,
    projected_pose: clone(ship.pose),
    weapon_cues: weaponCues
  };
}

export function getBearingVector(distance: number, bearingDegrees: number): Vector2 {
  const radians = (bearingDegrees * Math.PI) / 180;

  return {
    x: Math.sin(radians) * distance,
    y: Math.cos(radians) * distance
  };
}

export function getArcPolygonPoints(cue: PlotPreviewWeaponCue, segments = 10): Vector2[] {
  const points: Vector2[] = [cue.mount_position];
  const totalSweep = shortestSignedAngleDelta(cue.arc_start_bearing_degrees, cue.arc_end_bearing_degrees);
  const stepCount = Math.max(1, segments);

  for (let index = 0; index <= stepCount; index += 1) {
    const bearing = normalizeDegrees(cue.arc_start_bearing_degrees + (totalSweep * index) / stepCount);
    points.push(addVectors(cue.mount_position, getBearingVector(cue.max_range_km, bearing)));
  }

  points.push(cue.mount_position);

  return points;
}
