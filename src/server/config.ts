const DEFAULT_BATTLE_STATE_FIXTURE = "fixtures/battle_states/default_duel_turn_1.json";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8000;
const DEFAULT_RECONNECT_GRACE_MS = 120000;

export interface ServerConfig {
  host: string;
  port: number;
  battle_state_fixture_path: string;
  admin_token: string | null;
  external_origin: string | null;
  reconnect_grace_ms: number;
}

function parsePort(rawValue: string | undefined): number {
  if (!rawValue) {
    return DEFAULT_PORT;
  }

  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid SG2_PORT '${rawValue}'`);
  }

  return parsed;
}

function parseReconnectGraceMs(rawValue: string | undefined): number {
  if (!rawValue) {
    return DEFAULT_RECONNECT_GRACE_MS;
  }

  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid SG2_RECONNECT_GRACE_MS '${rawValue}'`);
  }

  return parsed;
}

export function getServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    host: env.SG2_HOST?.trim() || DEFAULT_HOST,
    port: parsePort(env.SG2_PORT),
    battle_state_fixture_path: env.SG2_BATTLE_STATE_FIXTURE?.trim() || DEFAULT_BATTLE_STATE_FIXTURE,
    admin_token: env.SG2_ADMIN_TOKEN?.trim() || null,
    external_origin: env.SG2_EXTERNAL_ORIGIN?.trim() || null,
    reconnect_grace_ms: parseReconnectGraceMs(env.SG2_RECONNECT_GRACE_MS)
  };
}
