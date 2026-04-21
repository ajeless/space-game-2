import type {
  BattleState,
  PlotSubmission,
  ShipInstanceId,
  ShipRuntimeState,
  Vector2,
  WeaponMountSystemConfig
} from "./contracts.js";
import { getShipConfig, getSystemStateAndEffects } from "./derived.js";
import { createPlotDraft, type PlotDraft } from "./plot_authoring.js";
import { buildPlotSubmissionFromDraft, summarizePlotDraft } from "./plot_authoring.js";
import { buildPlannedShots, getPlannedShotKey } from "./resolver/planned_shots.js";
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
  target_ship_instance_id: ShipInstanceId | null;
  charge_pips: number;
  effective_charge_pips: number | null;
  max_range_km: number | null;
  arc_visual_range_km: number;
  mount_position: Vector2;
  target_position: Vector2 | null;
  target_bearing_degrees: number | null;
  arc_center_bearing_degrees: number;
  arc_start_bearing_degrees: number;
  arc_end_bearing_degrees: number;
  target_in_arc: boolean | null;
  target_in_range: boolean | null;
  predicted_hit_probability: number | null;
  best_fire_sub_tick: number | null;
  predicted_bearing_sweep_degrees: number | null;
  firing_enabled: boolean;
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

function buildPreviewPlotsByShip(
  state: BattleState,
  actorShipId: ShipInstanceId,
  actorPlot: PlotSubmission
): Record<ShipInstanceId, PlotSubmission> {
  const plotsByShip: Record<ShipInstanceId, PlotSubmission> = {
    [actorShipId]: actorPlot
  };

  for (const participant of state.match_setup.participants) {
    const ship = state.ships[participant.ship_instance_id];

    if (!ship || ship.status !== "active" || participant.ship_instance_id === actorShipId) {
      continue;
    }

    const idleDraft = createPlotDraft(state, participant.ship_instance_id);
    plotsByShip[participant.ship_instance_id] = buildPlotSubmissionFromDraft(state, idleDraft);
  }

  return plotsByShip;
}

export function buildPlotPreview(state: BattleState, draft: PlotDraft): PlotPreview {
  const summary = summarizePlotDraft(state, draft);
  const plot = buildPlotSubmissionFromDraft(state, summary.draft);
  const previewPlotsByShip = buildPreviewPlotsByShip(state, plot.ship_instance_id, plot);
  const sortedShipIds = state.match_setup.participants
    .map((participant) => participant.ship_instance_id)
    .filter((shipId) => state.ships[shipId]?.status === "active")
    .sort();
  const plannedShots = buildPlannedShots(state, previewPlotsByShip, sortedShipIds);
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

  const weaponCues: PlotPreviewWeaponCue[] = summary.draft.weapons
    .map<PlotPreviewWeaponCue | null>((weapon) => {
      const mount = shipConfig.systems.find((system): system is WeaponMountSystemConfig => {
        return system.id === weapon.mount_id && system.type === "weapon_mount";
      });

      if (!mount) {
        return null;
      }

      const mountState = getSystemStateAndEffects(state, liveShip, mount.id);
      const firingEnabled =
        typeof mountState.effects.firing_enabled === "boolean" ? mountState.effects.firing_enabled : true;
      const visualRangeKm = Math.max(...mount.parameters.charge_table.map((entry) => entry.max_range_km));
      const rangeContext = getWeaponRangeContext(state, liveShip, mount, weapon.charge_pips);
      const targetShip = weapon.target_ship_instance_id ? state.ships[weapon.target_ship_instance_id] : undefined;
      const mountPosition = transformHullLocalPointToWorld(liveShip, mount.physical_position);
      const plannedShot =
        weapon.charge_pips > 0 ? plannedShots[getPlannedShotKey(plot.ship_instance_id, weapon.mount_id)] : undefined;

      if (!targetShip) {
        const arcCenterBearingDegrees = normalizeDegrees(liveShip.pose.heading_degrees + mount.parameters.bearing_degrees);

        return {
          mount_id: mount.id,
          label: mount.render?.label ?? mount.id.replaceAll("_", " "),
          target_ship_instance_id: null,
          charge_pips: weapon.charge_pips,
          effective_charge_pips: rangeContext?.effective_charge_pips ?? null,
          max_range_km: rangeContext?.max_range_km ?? null,
          arc_visual_range_km: visualRangeKm,
          mount_position: mountPosition,
          target_position: null,
          target_bearing_degrees: null,
          arc_center_bearing_degrees: arcCenterBearingDegrees,
          arc_start_bearing_degrees: normalizeDegrees(arcCenterBearingDegrees - mount.parameters.arc_degrees / 2),
          arc_end_bearing_degrees: normalizeDegrees(arcCenterBearingDegrees + mount.parameters.arc_degrees / 2),
          target_in_arc: null,
          target_in_range: null,
          predicted_hit_probability: null,
          best_fire_sub_tick: null,
          predicted_bearing_sweep_degrees: null,
          firing_enabled: firingEnabled
        } satisfies PlotPreviewWeaponCue;
      }

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
        effective_charge_pips: rangeContext?.effective_charge_pips ?? null,
        max_range_km: rangeContext?.max_range_km ?? null,
        arc_visual_range_km: rangeContext?.max_range_km ?? visualRangeKm,
        mount_position: mountPosition,
        target_position: { ...targetShip.pose.position },
        target_bearing_degrees: targetBearingDegrees,
        arc_center_bearing_degrees: arcCenterBearingDegrees,
        arc_start_bearing_degrees: normalizeDegrees(arcCenterBearingDegrees - mount.parameters.arc_degrees / 2),
        arc_end_bearing_degrees: normalizeDegrees(arcCenterBearingDegrees + mount.parameters.arc_degrees / 2),
        target_in_arc: offCenterDegrees <= mount.parameters.arc_degrees / 2,
        target_in_range: rangeContext ? magnitudeOf(delta) <= rangeContext.max_range_km : null,
        predicted_hit_probability: plannedShot?.predicted_hit_probability ?? null,
        best_fire_sub_tick: plannedShot?.fire_sub_tick ?? null,
        predicted_bearing_sweep_degrees: plannedShot?.predicted_bearing_sweep_degrees ?? null,
        firing_enabled: firingEnabled
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
    points.push(addVectors(cue.mount_position, getBearingVector(cue.arc_visual_range_km, bearing)));
  }

  points.push(cue.mount_position);

  return points;
}
