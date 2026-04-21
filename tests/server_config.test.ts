import { describe, expect, it } from "vitest";
import { getServerConfig } from "../src/server/config.js";

describe("server config", () => {
  it("uses the documented local defaults", () => {
    expect(getServerConfig({})).toEqual({
      host: "127.0.0.1",
      port: 8000,
      battle_state_fixture_path: "fixtures/battle_states/default_duel_turn_1.json",
      admin_token: null,
      external_origin: null
    });
  });

  it("accepts env overrides for remote hosting", () => {
    expect(
      getServerConfig({
        SG2_HOST: "0.0.0.0",
        SG2_PORT: "8111",
        SG2_BATTLE_STATE_FIXTURE: "fixtures/custom.json",
        SG2_ADMIN_TOKEN: "secret-token",
        SG2_EXTERNAL_ORIGIN: "https://example.trycloudflare.com"
      })
    ).toEqual({
      host: "0.0.0.0",
      port: 8111,
      battle_state_fixture_path: "fixtures/custom.json",
      admin_token: "secret-token",
      external_origin: "https://example.trycloudflare.com"
    });
  });
});
