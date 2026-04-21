import {
  SCHEMA_VERSION,
  type BaseSystemConfig,
  type BattleState,
  type HitProfile,
  type MatchRulesConfig,
  type PlotSubmission,
  type ShipConfig,
  type ShipRuntimeState,
  type ShipSystemConfig,
  type Vector2
} from "./contracts.js";
import { getAvailableReactorPips, getShipConfig, getSystemConfig } from "./derived.js";

type RecordValue = Record<string, unknown>;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new ValidationError(message);
  }
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, label: string): RecordValue {
  ensure(isRecord(value), `${label} must be an object`);
  return value;
}

function expectString(value: unknown, label: string): string {
  ensure(typeof value === "string" && value.length > 0, `${label} must be a non-empty string`);
  return value;
}

function expectFiniteNumber(value: unknown, label: string): number {
  ensure(typeof value === "number" && Number.isFinite(value), `${label} must be a finite number`);
  return value;
}

function expectPositiveNumber(value: unknown, label: string): number {
  const numeric = expectFiniteNumber(value, label);
  ensure(numeric > 0, `${label} must be > 0`);
  return numeric;
}

function expectInteger(value: unknown, label: string): number {
  const numeric = expectFiniteNumber(value, label);
  ensure(Number.isInteger(numeric), `${label} must be an integer`);
  return numeric;
}

function expectBoolean(value: unknown, label: string): boolean {
  ensure(typeof value === "boolean", `${label} must be a boolean`);
  return value;
}

function expectArray(value: unknown, label: string): unknown[] {
  ensure(Array.isArray(value), `${label} must be an array`);
  return value;
}

function expectSchemaVersion(value: unknown, label: string): void {
  ensure(value === SCHEMA_VERSION, `${label} must be '${SCHEMA_VERSION}'`);
}

function validateVector2(value: unknown, label: string): Vector2 {
  const record = expectRecord(value, label);

  return {
    x: expectFiniteNumber(record.x, `${label}.x`),
    y: expectFiniteNumber(record.y, `${label}.y`)
  };
}

function validateHitProfile(value: unknown, label: string): HitProfile {
  const record = expectRecord(value, label);
  const shape = expectString(record.shape, `${label}.shape`);

  if (shape === "circle") {
    return {
      shape,
      radius: expectPositiveNumber(record.radius, `${label}.radius`)
    };
  }

  if (shape === "ellipse") {
    return {
      shape,
      radius_x: expectPositiveNumber(record.radius_x, `${label}.radius_x`),
      radius_y: expectPositiveNumber(record.radius_y, `${label}.radius_y`)
    };
  }

  if (shape === "polygon") {
    const points = expectArray(record.points, `${label}.points`).map((point, index) =>
      validateVector2(point, `${label}.points[${index}]`)
    );
    ensure(points.length >= 3, `${label}.points must contain at least 3 points`);

    return { shape, points };
  }

  throw new ValidationError(`${label}.shape must be one of: circle, ellipse, polygon`);
}

function buildRenderConfig(render: RecordValue | undefined): Partial<Pick<BaseSystemConfig, "render">> {
  if (!render) {
    return {};
  }

  const renderConfig: NonNullable<BaseSystemConfig["render"]> = {};

  if (render.label !== undefined) {
    renderConfig.label = String(render.label);
  }

  if (render.short_label !== undefined) {
    renderConfig.short_label = String(render.short_label);
  }

  if (render.style_role !== undefined) {
    renderConfig.style_role = String(render.style_role);
  }

  return Object.keys(renderConfig).length > 0 ? { render: renderConfig } : {};
}

function buildSystemOptionalFields(
  ssdPosition: Vector2 | undefined,
  hitProfile: HitProfile | undefined,
  render: RecordValue | undefined
): Partial<Pick<BaseSystemConfig, "ssd_position" | "hit_profile" | "render">> {
  const optionalFields: Partial<Pick<BaseSystemConfig, "ssd_position" | "hit_profile" | "render">> = {};

  if (ssdPosition !== undefined) {
    optionalFields.ssd_position = ssdPosition;
  }

  if (hitProfile !== undefined) {
    optionalFields.hit_profile = hitProfile;
  }

  return {
    ...optionalFields,
    ...buildRenderConfig(render)
  };
}

function validateSystem(value: unknown, label: string): ShipSystemConfig {
  const record = expectRecord(value, label);
  const type = expectString(record.type, `${label}.type`);
  const base = {
    id: expectString(record.id, `${label}.id`),
    type,
    physical_position: validateVector2(record.physical_position, `${label}.physical_position`),
    max_integrity: expectPositiveNumber(record.max_integrity, `${label}.max_integrity`)
  };

  const ssd_position = record.ssd_position === undefined ? undefined : validateVector2(record.ssd_position, `${label}.ssd_position`);
  const hit_profile = record.hit_profile === undefined ? undefined : validateHitProfile(record.hit_profile, `${label}.hit_profile`);
  const render = record.render === undefined ? undefined : expectRecord(record.render, `${label}.render`);
  const parameters = expectRecord(record.parameters, `${label}.parameters`);

  if (type === "drive") {
    return {
      ...base,
      type,
      ...buildSystemOptionalFields(ssd_position, hit_profile, render),
      parameters: {
        max_thrust: expectPositiveNumber(parameters.max_thrust, `${label}.parameters.max_thrust`)
      }
    };
  }

  if (type === "reactor") {
    return {
      ...base,
      type,
      ...buildSystemOptionalFields(ssd_position, hit_profile, render),
      parameters: {
        discretionary_pips: expectInteger(parameters.discretionary_pips, `${label}.parameters.discretionary_pips`)
      }
    };
  }

  if (type === "bridge") {
    return {
      ...base,
      type,
      ...buildSystemOptionalFields(ssd_position, hit_profile, render),
      parameters: {}
    };
  }

  if (type === "weapon_mount") {
    const chargeTable = expectArray(parameters.charge_table, `${label}.parameters.charge_table`).map((entry, index) => {
      const charge = expectRecord(entry, `${label}.parameters.charge_table[${index}]`);

      return {
        pips: expectInteger(charge.pips, `${label}.parameters.charge_table[${index}].pips`),
        max_range_km: expectPositiveNumber(charge.max_range_km, `${label}.parameters.charge_table[${index}].max_range_km`),
        damage: expectPositiveNumber(charge.damage, `${label}.parameters.charge_table[${index}].damage`)
      };
    });

    ensure(chargeTable.length > 0, `${label}.parameters.charge_table must not be empty`);

    for (let index = 1; index < chargeTable.length; index += 1) {
      const previous = chargeTable[index - 1];
      const current = chargeTable[index];

      ensure(
        previous !== undefined && current !== undefined && previous.pips < current.pips,
        `${label}.parameters.charge_table must be strictly ordered by pips`
      );
    }

    return {
      ...base,
      type,
      ...buildSystemOptionalFields(ssd_position, hit_profile, render),
      parameters: {
        arc_degrees: expectPositiveNumber(parameters.arc_degrees, `${label}.parameters.arc_degrees`),
        bearing_degrees: expectFiniteNumber(parameters.bearing_degrees, `${label}.parameters.bearing_degrees`),
        baseline_track_quality: expectPositiveNumber(
          parameters.baseline_track_quality,
          `${label}.parameters.baseline_track_quality`
        ),
        charge_table: chargeTable
      }
    };
  }

  throw new ValidationError(`${label}.type '${type}' is not recognized in v0.1`);
}

export function validateMatchRulesConfig(value: unknown): MatchRulesConfig {
  const record = expectRecord(value, "MatchRulesConfig");
  expectSchemaVersion(record.schema_version, "MatchRulesConfig.schema_version");
  const turn = expectRecord(record.turn, "MatchRulesConfig.turn");
  const fireControl = expectRecord(record.fire_control, "MatchRulesConfig.fire_control");
  const hitProbability = expectRecord(record.hit_probability, "MatchRulesConfig.hit_probability");
  const rangeFactor = expectRecord(hitProbability.range_factor, "MatchRulesConfig.hit_probability.range_factor");
  const transverseFactor = expectRecord(
    hitProbability.transverse_factor,
    "MatchRulesConfig.hit_probability.transverse_factor"
  );
  const damage = expectRecord(record.damage, "MatchRulesConfig.damage");
  const thresholds = expectRecord(damage.subsystem_state_thresholds, "MatchRulesConfig.damage.subsystem_state_thresholds");
  const localHit = expectRecord(damage.local_hit_resolution, "MatchRulesConfig.damage.local_hit_resolution");
  const victory = expectRecord(record.victory, "MatchRulesConfig.victory");
  const effectsBySystemType = expectRecord(damage.effects_by_system_type, "MatchRulesConfig.damage.effects_by_system_type");

  const operationalMinFraction = expectFiniteNumber(
    thresholds.operational_min_fraction,
    "MatchRulesConfig.damage.subsystem_state_thresholds.operational_min_fraction"
  );
  const degradedMinFraction = expectFiniteNumber(
    thresholds.degraded_min_fraction,
    "MatchRulesConfig.damage.subsystem_state_thresholds.degraded_min_fraction"
  );

  ensure(operationalMinFraction >= degradedMinFraction, "operational threshold must be >= degraded threshold");

  for (const [systemType, states] of Object.entries(effectsBySystemType)) {
    const stateRecord = expectRecord(states, `MatchRulesConfig.damage.effects_by_system_type.${systemType}`);

    for (const label of ["operational", "degraded", "offline"] as const) {
      expectRecord(stateRecord[label], `MatchRulesConfig.damage.effects_by_system_type.${systemType}.${label}`);
    }
  }

  return {
    schema_version: SCHEMA_VERSION,
    id: expectString(record.id, "MatchRulesConfig.id"),
    name: expectString(record.name, "MatchRulesConfig.name"),
    turn: {
      sub_ticks: expectInteger(turn.sub_ticks, "MatchRulesConfig.turn.sub_ticks")
    },
    fire_control: {
      timing_policy:
        expectString(fireControl.timing_policy, "MatchRulesConfig.fire_control.timing_policy") as "best_legal_shot",
      tie_break: expectString(fireControl.tie_break, "MatchRulesConfig.fire_control.tie_break") as "earliest"
    },
    hit_probability: {
      min_probability: expectFiniteNumber(hitProbability.min_probability, "MatchRulesConfig.hit_probability.min_probability"),
      max_probability: expectFiniteNumber(hitProbability.max_probability, "MatchRulesConfig.hit_probability.max_probability"),
      range_factor: {
        max_factor: expectFiniteNumber(rangeFactor.max_factor, "MatchRulesConfig.hit_probability.range_factor.max_factor"),
        min_factor: expectFiniteNumber(rangeFactor.min_factor, "MatchRulesConfig.hit_probability.range_factor.min_factor"),
        slope: expectFiniteNumber(rangeFactor.slope, "MatchRulesConfig.hit_probability.range_factor.slope")
      },
      transverse_factor: {
        max_factor: expectFiniteNumber(
          transverseFactor.max_factor,
          "MatchRulesConfig.hit_probability.transverse_factor.max_factor"
        ),
        min_factor: expectFiniteNumber(
          transverseFactor.min_factor,
          "MatchRulesConfig.hit_probability.transverse_factor.min_factor"
        ),
        reference_bearing_sweep_deg: expectPositiveNumber(
          transverseFactor.reference_bearing_sweep_deg,
          "MatchRulesConfig.hit_probability.transverse_factor.reference_bearing_sweep_deg"
        ),
        measurement_window_sub_ticks: expectInteger(
          transverseFactor.measurement_window_sub_ticks,
          "MatchRulesConfig.hit_probability.transverse_factor.measurement_window_sub_ticks"
        ),
        edge_mode: expectString(transverseFactor.edge_mode, "MatchRulesConfig.hit_probability.transverse_factor.edge_mode") as "clamp"
      }
    },
    damage: {
      subsystem_state_thresholds: {
        operational_min_fraction: operationalMinFraction,
        degraded_min_fraction: degradedMinFraction
      },
      local_hit_resolution: {
        kind: expectString(localHit.kind, "MatchRulesConfig.damage.local_hit_resolution.kind") as "nearest_system_within_radius",
        radius_hull_units: expectPositiveNumber(localHit.radius_hull_units, "MatchRulesConfig.damage.local_hit_resolution.radius_hull_units"),
        subsystem_damage_ratio: expectPositiveNumber(
          localHit.subsystem_damage_ratio,
          "MatchRulesConfig.damage.local_hit_resolution.subsystem_damage_ratio"
        )
      },
      effects_by_system_type: effectsBySystemType as MatchRulesConfig["damage"]["effects_by_system_type"]
    },
    victory: {
      hull_destroyed_at_or_below: expectFiniteNumber(victory.hull_destroyed_at_or_below, "MatchRulesConfig.victory.hull_destroyed_at_or_below"),
      boundary_disengage_enabled: expectBoolean(victory.boundary_disengage_enabled, "MatchRulesConfig.victory.boundary_disengage_enabled")
    }
  };
}

export function validateShipConfig(value: unknown): ShipConfig {
  const record = expectRecord(value, "ShipConfig");
  expectSchemaVersion(record.schema_version, "ShipConfig.schema_version");
  const hull = expectRecord(record.hull, "ShipConfig.hull");
  const dynamics = expectRecord(record.dynamics, "ShipConfig.dynamics");
  const power = expectRecord(record.power, "ShipConfig.power");
  const silhouette = expectArray(hull.silhouette, "ShipConfig.hull.silhouette").map((point, index) =>
    validateVector2(point, `ShipConfig.hull.silhouette[${index}]`)
  );

  ensure(silhouette.length >= 3, "ShipConfig.hull.silhouette must contain at least 3 points");

  const systems = expectArray(record.systems, "ShipConfig.systems").map((system, index) =>
    validateSystem(system, `ShipConfig.systems[${index}]`)
  );
  const systemIds = new Set<string>();

  for (const system of systems) {
    ensure(!systemIds.has(system.id), `ShipConfig.systems contains duplicate system id '${system.id}'`);
    systemIds.add(system.id);
  }

  ensure(systems.some((system) => system.type === "reactor"), "ShipConfig must contain a reactor system");
  ensure(systems.some((system) => system.type === "drive"), "ShipConfig must contain a drive system");

  const discretionaryAllocationIds = expectArray(
    power.discretionary_allocation_ids,
    "ShipConfig.power.discretionary_allocation_ids"
  ).map((entry, index) => expectString(entry, `ShipConfig.power.discretionary_allocation_ids[${index}]`));

  return {
    schema_version: SCHEMA_VERSION,
    id: expectString(record.id, "ShipConfig.id"),
    name: expectString(record.name, "ShipConfig.name"),
    class: expectString(record.class, "ShipConfig.class"),
    hull: {
      silhouette,
      max_integrity: expectPositiveNumber(hull.max_integrity, "ShipConfig.hull.max_integrity")
    },
    dynamics: {
      mass: expectPositiveNumber(dynamics.mass, "ShipConfig.dynamics.mass"),
      max_turn_degrees_per_turn: expectPositiveNumber(
        dynamics.max_turn_degrees_per_turn,
        "ShipConfig.dynamics.max_turn_degrees_per_turn"
      ),
      ...(dynamics.moment_of_inertia === undefined
        ? {}
        : {
            moment_of_inertia: expectPositiveNumber(
              dynamics.moment_of_inertia,
              "ShipConfig.dynamics.moment_of_inertia"
            )
          })
    },
    power: {
      discretionary_allocation_ids: discretionaryAllocationIds
    },
    systems
  };
}

function validateRuntimeShip(value: unknown, label: string, state: BattleState): ShipRuntimeState {
  const record = expectRecord(value, label);
  const shipInstanceId = expectString(record.ship_instance_id, `${label}.ship_instance_id`);
  const shipConfigId = expectString(record.ship_config_id, `${label}.ship_config_id`);
  const shipConfig = state.match_setup.ship_catalog[shipConfigId];

  ensure(shipConfig !== undefined, `${label}.ship_config_id '${shipConfigId}' must exist in match_setup.ship_catalog`);

  const pose = expectRecord(record.pose, `${label}.pose`);
  const hull = expectRecord(record.hull, `${label}.hull`);
  const systems = expectRecord(record.systems, `${label}.systems`);

  for (const system of shipConfig.systems) {
    const runtimeSystem = expectRecord(systems[system.id], `${label}.systems.${system.id}`);
    expectFiniteNumber(runtimeSystem.current_integrity, `${label}.systems.${system.id}.current_integrity`);
  }

  for (const runtimeSystemId of Object.keys(systems)) {
    ensure(
      shipConfig.systems.some((system) => system.id === runtimeSystemId),
      `${label}.systems contains unknown system '${runtimeSystemId}'`
    );
  }

  return {
    ship_instance_id: shipInstanceId,
    ship_config_id: shipConfigId,
    slot_id: expectString(record.slot_id, `${label}.slot_id`),
    status: expectString(record.status, `${label}.status`) as ShipRuntimeState["status"],
    pose: {
      position: validateVector2(pose.position, `${label}.pose.position`),
      velocity: validateVector2(pose.velocity, `${label}.pose.velocity`),
      heading_degrees: expectFiniteNumber(pose.heading_degrees, `${label}.pose.heading_degrees`)
    },
    hull: {
      current_integrity: expectFiniteNumber(hull.current_integrity, `${label}.hull.current_integrity`)
    },
    systems: systems as ShipRuntimeState["systems"]
  };
}

export function validateBattleState(value: unknown): BattleState {
  const record = expectRecord(value, "BattleState");
  expectSchemaVersion(record.schema_version, "BattleState.schema_version");
  const matchSetup = expectRecord(record.match_setup, "BattleState.match_setup");
  const shipCatalogRaw = expectRecord(matchSetup.ship_catalog, "BattleState.match_setup.ship_catalog");
  const shipCatalog: Record<string, ShipConfig> = {};

  for (const [shipConfigId, shipConfigRaw] of Object.entries(shipCatalogRaw)) {
    shipCatalog[shipConfigId] = validateShipConfig(shipConfigRaw);
  }

  const draftState: BattleState = {
    schema_version: SCHEMA_VERSION,
    match_setup: {
      match_id: expectString(matchSetup.match_id, "BattleState.match_setup.match_id"),
      seed_root: expectString(matchSetup.seed_root, "BattleState.match_setup.seed_root"),
      rules: validateMatchRulesConfig(matchSetup.rules),
      ship_catalog: shipCatalog,
      participants: expectArray(matchSetup.participants, "BattleState.match_setup.participants").map((participant, index) => {
        const entry = expectRecord(participant, `BattleState.match_setup.participants[${index}]`);

        return {
          slot_id: expectString(entry.slot_id, `BattleState.match_setup.participants[${index}].slot_id`),
          ship_instance_id: expectString(
            entry.ship_instance_id,
            `BattleState.match_setup.participants[${index}].ship_instance_id`
          ),
          ship_config_id: expectString(
            entry.ship_config_id,
            `BattleState.match_setup.participants[${index}].ship_config_id`
          )
        };
      }),
      battlefield: {
        boundary: (() => {
          const battlefield = expectRecord(matchSetup.battlefield, "BattleState.match_setup.battlefield");
          const boundary = expectRecord(battlefield.boundary, "BattleState.match_setup.battlefield.boundary");

          return {
            kind: expectString(boundary.kind, "BattleState.match_setup.battlefield.boundary.kind") as "rectangle",
            min: validateVector2(boundary.min, "BattleState.match_setup.battlefield.boundary.min"),
            max: validateVector2(boundary.max, "BattleState.match_setup.battlefield.boundary.max")
          };
        })()
      }
    },
    turn_number: expectInteger(record.turn_number, "BattleState.turn_number"),
    ships: {},
    outcome: {
      winner_ship_instance_id:
        record.outcome && expectRecord(record.outcome, "BattleState.outcome").winner_ship_instance_id === null
          ? null
          : (() => {
              const outcome = expectRecord(record.outcome, "BattleState.outcome");
              return outcome.winner_ship_instance_id === null
                ? null
                : expectString(outcome.winner_ship_instance_id, "BattleState.outcome.winner_ship_instance_id");
            })(),
      end_reason: (() => {
        const outcome = expectRecord(record.outcome, "BattleState.outcome");
        return outcome.end_reason === null
          ? null
          : (expectString(outcome.end_reason, "BattleState.outcome.end_reason") as BattleState["outcome"]["end_reason"]);
      })()
    }
  };

  const shipsRaw = expectRecord(record.ships, "BattleState.ships");

  for (const [shipInstanceId, shipRaw] of Object.entries(shipsRaw)) {
    draftState.ships[shipInstanceId] = validateRuntimeShip(shipRaw, `BattleState.ships.${shipInstanceId}`, draftState);
  }

  for (const participant of draftState.match_setup.participants) {
    ensure(
      draftState.match_setup.ship_catalog[participant.ship_config_id] !== undefined,
      `BattleState participant '${participant.slot_id}' references missing ship_config_id '${participant.ship_config_id}'`
    );
    ensure(
      draftState.ships[participant.ship_instance_id] !== undefined,
      `BattleState participant '${participant.slot_id}' references missing runtime ship '${participant.ship_instance_id}'`
    );
  }

  return draftState;
}

export function validatePlotSubmission(value: unknown, state?: BattleState): PlotSubmission {
  const record = expectRecord(value, "PlotSubmission");
  expectSchemaVersion(record.schema_version, "PlotSubmission.schema_version");
  const power = expectRecord(record.power, "PlotSubmission.power");
  const maneuver = expectRecord(record.maneuver, "PlotSubmission.maneuver");
  const translationPlan = expectRecord(maneuver.translation_plan, "PlotSubmission.maneuver.translation_plan");
  const knots = expectArray(translationPlan.knots, "PlotSubmission.maneuver.translation_plan.knots").map((entry, index) => {
    const knot = expectRecord(entry, `PlotSubmission.maneuver.translation_plan.knots[${index}]`);

    return {
      t: expectFiniteNumber(knot.t, `PlotSubmission.maneuver.translation_plan.knots[${index}].t`),
      thrust_fraction: validateVector2(
        knot.thrust_fraction,
        `PlotSubmission.maneuver.translation_plan.knots[${index}].thrust_fraction`
      )
    };
  });

  ensure(knots.length >= 2, "PlotSubmission.maneuver.translation_plan.knots must contain at least 2 knots");
  ensure(knots[0]?.t === 0, "PlotSubmission.maneuver.translation_plan.knots must begin at t = 0");
  ensure(knots[knots.length - 1]?.t === 1, "PlotSubmission.maneuver.translation_plan.knots must end at t = 1");

  for (let index = 1; index < knots.length; index += 1) {
    const previous = knots[index - 1];
    const current = knots[index];

    ensure(
      previous !== undefined && current !== undefined && previous.t < current.t,
      "PlotSubmission.maneuver.translation_plan.knots must be strictly ordered by t"
    );
  }

  const plot: PlotSubmission = {
    schema_version: SCHEMA_VERSION,
    match_id: expectString(record.match_id, "PlotSubmission.match_id"),
    turn_number: expectInteger(record.turn_number, "PlotSubmission.turn_number"),
    ship_instance_id: expectString(record.ship_instance_id, "PlotSubmission.ship_instance_id"),
    power: {
      drive_pips: expectInteger(power.drive_pips, "PlotSubmission.power.drive_pips"),
      railgun_pips: expectInteger(power.railgun_pips, "PlotSubmission.power.railgun_pips")
    },
    maneuver: {
      desired_end_heading_degrees: expectFiniteNumber(
        maneuver.desired_end_heading_degrees,
        "PlotSubmission.maneuver.desired_end_heading_degrees"
      ),
      translation_plan: {
        kind: expectString(translationPlan.kind, "PlotSubmission.maneuver.translation_plan.kind") as "piecewise_linear",
        frame: expectString(translationPlan.frame, "PlotSubmission.maneuver.translation_plan.frame") as "world",
        knots
      }
    },
    weapons: expectArray(record.weapons, "PlotSubmission.weapons").map((entry, index) => {
      const weapon = expectRecord(entry, `PlotSubmission.weapons[${index}]`);

      return {
        mount_id: expectString(weapon.mount_id, `PlotSubmission.weapons[${index}].mount_id`),
        target_ship_instance_id: expectString(
          weapon.target_ship_instance_id,
          `PlotSubmission.weapons[${index}].target_ship_instance_id`
        ),
        fire_mode: expectString(weapon.fire_mode, `PlotSubmission.weapons[${index}].fire_mode`) as "hold" | "best_shot_this_turn",
        charge_pips: expectInteger(weapon.charge_pips, `PlotSubmission.weapons[${index}].charge_pips`)
      };
    })
  };

  const mountIds = new Set<string>();

  for (const weapon of plot.weapons) {
    ensure(!mountIds.has(weapon.mount_id), `PlotSubmission.weapons contains duplicate mount '${weapon.mount_id}'`);
    mountIds.add(weapon.mount_id);
  }

  const totalCharge = plot.weapons.reduce((sum, weapon) => sum + weapon.charge_pips, 0);
  ensure(
    totalCharge === plot.power.railgun_pips,
    "PlotSubmission.weapon charge pips must sum exactly to PlotSubmission.power.railgun_pips"
  );

  if (!state) {
    return plot;
  }

  ensure(plot.match_id === state.match_setup.match_id, "PlotSubmission.match_id must match BattleState.match_setup.match_id");
  ensure(plot.turn_number === state.turn_number, "PlotSubmission.turn_number must match BattleState.turn_number");

  const ship = state.ships[plot.ship_instance_id];
  ensure(ship !== undefined, `PlotSubmission references unknown ship '${plot.ship_instance_id}'`);
  ensure(ship.status === "active", `PlotSubmission ship '${plot.ship_instance_id}' must be active`);

  const availablePips = getAvailableReactorPips(state, ship);
  ensure(
    plot.power.drive_pips + plot.power.railgun_pips === availablePips,
    `PlotSubmission must assign all available reactor pips (${availablePips})`
  );

  const shipConfig = getShipConfig(state, ship);

  for (const weapon of plot.weapons) {
    const system = getSystemConfig(shipConfig, weapon.mount_id);
    ensure(system.type === "weapon_mount", `PlotSubmission mount '${weapon.mount_id}' must reference a weapon_mount`);
    ensure(
      state.ships[weapon.target_ship_instance_id] !== undefined,
      `PlotSubmission target '${weapon.target_ship_instance_id}' must exist in BattleState.ships`
    );
  }

  return plot;
}
