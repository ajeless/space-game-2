import { validateBattleState, type BattleState } from "../shared/index.js";

export const RECONNECT_TOKEN_STORAGE_KEY = "sg2_reconnect_token";
export const ADMIN_TOKEN_STORAGE_KEY = "sg2_admin_token";
export const LAST_COMPLETED_RESOLUTION_KEY_STORAGE_KEY = "sg2_last_completed_resolution_key";
export const LAST_RESOLUTION_SOURCE_STORAGE_KEY = "sg2_last_resolution_source_state";

export function readStoredValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStoredValue(key: string, value: string | null): void {
  try {
    if (value === null) {
      window.localStorage.removeItem(key);
      return;
    }

    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage failures in v0.2
  }
}

function readStoredResolutionPlaybackSource(): {
  key: string;
  battle_state: BattleState;
} | null {
  const raw = readStoredValue(LAST_RESOLUTION_SOURCE_STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as {
      key?: unknown;
      battle_state?: unknown;
    };

    if (typeof parsed.key !== "string" || !parsed.battle_state) {
      return null;
    }

    return {
      key: parsed.key,
      battle_state: validateBattleState(parsed.battle_state)
    };
  } catch {
    return null;
  }
}

export function writeStoredResolutionPlaybackSource(key: string | null, battleState: BattleState | null): void {
  if (!key || !battleState) {
    writeStoredValue(LAST_RESOLUTION_SOURCE_STORAGE_KEY, null);
    return;
  }

  try {
    writeStoredValue(
      LAST_RESOLUTION_SOURCE_STORAGE_KEY,
      JSON.stringify({
        key,
        battle_state: battleState
      })
    );
  } catch {
    writeStoredValue(LAST_RESOLUTION_SOURCE_STORAGE_KEY, null);
  }
}

export function getStoredResolutionPlaybackSource(key: string): BattleState | null {
  const stored = readStoredResolutionPlaybackSource();

  return stored?.key === key ? stored.battle_state : null;
}
