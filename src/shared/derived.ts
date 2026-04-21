import type {
  BattleState,
  MatchRulesConfig,
  ShipConfig,
  ShipRuntimeState,
  SubsystemState,
  SystemEffectValues,
  SystemId
} from "./contracts.js";

export function getShipConfig(state: BattleState, ship: ShipRuntimeState): ShipConfig {
  const config = state.match_setup.ship_catalog[ship.ship_config_id];

  if (!config) {
    throw new Error(`Missing ship config '${ship.ship_config_id}' in battle state catalog`);
  }

  return config;
}

export function getSystemConfig(shipConfig: ShipConfig, systemId: SystemId) {
  const system = shipConfig.systems.find((candidate) => candidate.id === systemId);

  if (!system) {
    throw new Error(`Missing system '${systemId}' on ship config '${shipConfig.id}'`);
  }

  return system;
}

export function deriveSubsystemState(
  currentIntegrity: number,
  maxIntegrity: number,
  rules: MatchRulesConfig
): SubsystemState {
  const fraction = maxIntegrity <= 0 ? 0 : currentIntegrity / maxIntegrity;
  const thresholds = rules.damage.subsystem_state_thresholds;

  if (fraction >= thresholds.operational_min_fraction) {
    return "operational";
  }

  if (fraction >= thresholds.degraded_min_fraction) {
    return "degraded";
  }

  return "offline";
}

export function getSystemEffects(
  rules: MatchRulesConfig,
  systemType: string,
  subsystemState: SubsystemState
): SystemEffectValues {
  const entry = rules.damage.effects_by_system_type[systemType];

  return entry?.[subsystemState] ?? {};
}

export function getRuntimeSystem(ship: ShipRuntimeState, systemId: SystemId) {
  const runtimeSystem = ship.systems[systemId];

  if (!runtimeSystem) {
    throw new Error(`Runtime ship '${ship.ship_instance_id}' is missing system '${systemId}'`);
  }

  return runtimeSystem;
}

export function getSystemStateAndEffects(
  state: BattleState,
  ship: ShipRuntimeState,
  systemId: SystemId
): {
  config: ReturnType<typeof getSystemConfig>;
  state_label: SubsystemState;
  effects: SystemEffectValues;
} {
  const shipConfig = getShipConfig(state, ship);
  const systemConfig = getSystemConfig(shipConfig, systemId);
  const runtimeSystem = getRuntimeSystem(ship, systemId);
  const stateLabel = deriveSubsystemState(
    runtimeSystem.current_integrity,
    systemConfig.max_integrity,
    state.match_setup.rules
  );

  return {
    config: systemConfig,
    state_label: stateLabel,
    effects: getSystemEffects(state.match_setup.rules, systemConfig.type, stateLabel)
  };
}

export function getAvailableReactorPips(state: BattleState, ship: ShipRuntimeState): number {
  const shipConfig = getShipConfig(state, ship);
  const reactor = shipConfig.systems.find((system) => system.type === "reactor");

  if (!reactor || reactor.type !== "reactor") {
    throw new Error(`Ship config '${shipConfig.id}' does not have a reactor`);
  }

  const runtimeSystem = getRuntimeSystem(ship, reactor.id);

  const stateLabel = deriveSubsystemState(
    runtimeSystem.current_integrity,
    reactor.max_integrity,
    state.match_setup.rules
  );
  const effects = getSystemEffects(state.match_setup.rules, reactor.type, stateLabel);
  const base = reactor.parameters.discretionary_pips;
  const override = effects.discretionary_pips_override;

  if (typeof override === "number") {
    return override;
  }

  const factor = typeof effects.discretionary_pips_factor === "number" ? effects.discretionary_pips_factor : 1;
  const rounding = effects.rounding;
  const raw = base * factor;

  if (rounding === "ceil") {
    return Math.ceil(raw);
  }

  if (rounding === "round") {
    return Math.round(raw);
  }

  return Math.floor(raw);
}
