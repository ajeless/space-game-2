import { getAvailableReactorPips, getSystemStateAndEffects } from "../shared/index.js";
import type {
  MatchSessionView,
  PlotDraft,
  PlotDraftSummary,
  PlotPreview,
  ResolverEvent,
  SessionIdentity,
  ShipConfig,
  ShipInstanceId,
  ShipRuntimeState,
  ShipSystemConfig,
  SystemId,
  Vector2
} from "../shared/index.js";

const SCHEMATIC_VIEWPORT = {
  width: 420,
  height: 620,
  centerX: 210,
  centerY: 262,
  scalePx: 208,
  hitWidth: 108,
  hitHeight: 38,
  bodyWidth: 76,
  bodyHeight: 28
} as const;

type WeaponCue = PlotPreview["weapon_cues"][number];

type WeaponIntentPresentation = {
  tone: "idle" | "armed" | "warn" | "disabled";
  banner_label: string;
  target_label: string;
  status_label: string;
  system_meta_label: string;
  shot_quality_label: string;
  shot_state_label: string;
  is_armed: boolean;
};

type DisplayedShipContext = {
  participant: MatchSessionView["battle_state"]["match_setup"]["participants"][number];
  ship: ShipRuntimeState;
  shipConfig: ShipConfig;
};

type SelectedSystemContext = {
  ship: ShipRuntimeState;
  system: ShipSystemConfig;
  integrity_percent: number;
  state_label: ReturnType<typeof getSystemStateAndEffects>["state_label"];
};

type OutcomePresentation = {
  headline: string;
  detail: string;
} | null;

type RenderSchematicPanelArgs = {
  sessionValue: MatchSessionView | null;
  identityValue: SessionIdentity | null;
  displayed: DisplayedShipContext | null;
  plotSummary: PlotDraftSummary | null;
  selectedSystemContext: SelectedSystemContext | null;
  plotPreview: PlotPreview | null;
  playbackEvent: ResolverEvent | null;
  selectedSystemId: SystemId | null;
  outcomePresentation: OutcomePresentation;
  getContactLabel: (shipInstanceId: ShipInstanceId | null) => string;
};

function normalizeDegrees(angle: number): number {
  const normalized = angle % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function formatNumber(value: number): string {
  return value.toFixed(3);
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function formatSignedNumber(value: number, digits = 0): string {
  const rounded = value.toFixed(digits);
  return value > 0 ? `+${rounded}` : rounded;
}

function isMatchEnded(sessionValue: MatchSessionView | null): boolean {
  return sessionValue?.battle_state.outcome.end_reason !== null;
}

function isArmedWeaponCue(cue: WeaponCue | null | undefined): boolean {
  return Boolean(cue && cue.firing_enabled && cue.charge_pips > 0 && cue.target_ship_instance_id !== null);
}

function getSystemPlaybackTone(
  playbackEvent: ResolverEvent | null,
  shipInstanceId: ShipInstanceId,
  systemId: SystemId
): "hit" | "critical" | null {
  if (!playbackEvent) {
    return null;
  }

  if (
    playbackEvent.type === "hit_registered" &&
    playbackEvent.target === shipInstanceId &&
    playbackEvent.details.impactSystemId === systemId
  ) {
    return "hit";
  }

  if (
    playbackEvent.type === "subsystem_damaged" &&
    playbackEvent.actor === shipInstanceId &&
    playbackEvent.details.systemId === systemId
  ) {
    return playbackEvent.details.newState === "offline" ? "critical" : "hit";
  }

  return null;
}

function getWeaponIntentPresentation(
  getContactLabel: (shipInstanceId: ShipInstanceId | null) => string,
  weaponDraft: PlotDraft["weapons"][number] | undefined,
  cue: WeaponCue | null,
  firingEnabled: boolean
): WeaponIntentPresentation {
  const chargePips = weaponDraft?.charge_pips ?? 0;
  const targetShipInstanceId = weaponDraft?.target_ship_instance_id ?? null;
  const targetLabel = getContactLabel(targetShipInstanceId);
  const targetShortLabel = targetLabel.toUpperCase();
  const isArmed = firingEnabled && chargePips > 0 && targetShipInstanceId !== null;
  const shotQualityLabel =
    cue?.predicted_hit_probability !== null && cue?.predicted_hit_probability !== undefined
      ? `${Math.round(cue.predicted_hit_probability * 100)}% at T${cue.best_fire_sub_tick}`
      : isArmed
        ? "No legal shot"
        : "Unarmed";
  const shotStateLabel =
    !cue || cue.target_in_arc === null || cue.target_in_range === null
      ? targetShipInstanceId
        ? "Selected contact only"
        : "Await contact selection"
      : `${cue.target_in_arc ? "in arc" : "out of arc"} · ${cue.target_in_range ? "in range" : "out of range"}`;

  if (!firingEnabled) {
    return {
      tone: "disabled",
      banner_label: "MOUNT DISABLED",
      target_label: "none",
      status_label: "Disabled",
      system_meta_label: "DISABLED",
      shot_quality_label: "Mount offline",
      shot_state_label: "No fire control",
      is_armed: false
    };
  }

  if (!targetShipInstanceId) {
    return {
      tone: "idle",
      banner_label: "NO TARGET LOCKED",
      target_label: "none",
      status_label: "Select contact",
      system_meta_label: "SAFE",
      shot_quality_label: "Await contact",
      shot_state_label: shotStateLabel,
      is_armed: false
    };
  }

  if (!isArmed) {
    return {
      tone: "idle",
      banner_label: `TRACKING ${targetShortLabel}`,
      target_label: targetLabel,
      status_label: "Target tracked",
      system_meta_label: "TRACK",
      shot_quality_label: "Hold fire",
      shot_state_label: shotStateLabel,
      is_armed: false
    };
  }

  if (cue?.predicted_hit_probability !== null && cue?.predicted_hit_probability !== undefined) {
    return {
      tone: "armed",
      banner_label: `ARMED ON ${targetShortLabel} · ${chargePips}P`,
      target_label: targetLabel,
      status_label: "Shot armed",
      system_meta_label: `ARM ${chargePips}P`,
      shot_quality_label: shotQualityLabel,
      shot_state_label: shotStateLabel,
      is_armed: true
    };
  }

  return {
    tone: "warn",
    banner_label: `SHOT BLOCKED · ${targetShortLabel}`,
    target_label: targetLabel,
    status_label: "Target tracked · blocked",
    system_meta_label: "NO SHOT",
    shot_quality_label: shotQualityLabel,
    shot_state_label: shotStateLabel,
    is_armed: false
  };
}

function localToSchematic(point: Vector2): Vector2 {
  return {
    x: SCHEMATIC_VIEWPORT.centerX + point.x * SCHEMATIC_VIEWPORT.scalePx,
    y: SCHEMATIC_VIEWPORT.centerY + point.y * SCHEMATIC_VIEWPORT.scalePx
  };
}

function getSystemShortLabel(system: ShipSystemConfig): string {
  const explicit = system.render?.short_label;

  if (explicit) {
    return explicit.toUpperCase();
  }

  const label = (system.render?.label ?? system.id.replaceAll("_", " ")).toUpperCase();

  if (label.length <= 12) {
    return label;
  }

  const words = label.split(/\s+/).filter(Boolean);

  if (words.length > 1) {
    const abbreviated = words
      .map((word, index) => (word.length <= 4 ? word : word.slice(0, index === words.length - 1 ? 5 : 3)))
      .join(" ");

    if (abbreviated.length <= 12) {
      return abbreviated;
    }
  }

  return label.slice(0, 12).trim();
}

function renderHeadingCompass(headingDegrees: number): string {
  const normalized = normalizeDegrees(headingDegrees);

  return `
    <div class="heading-compass">
      <svg viewBox="0 0 84 84" aria-label="Heading compass">
        <circle class="heading-compass__ring" cx="42" cy="42" r="31" />
        <line class="heading-compass__reference" x1="42" y1="7" x2="42" y2="19" />
        <line class="heading-compass__reference" x1="42" y1="65" x2="42" y2="77" />
        <line class="heading-compass__reference" x1="7" y1="42" x2="19" y2="42" />
        <line class="heading-compass__reference" x1="65" y1="42" x2="77" y2="42" />
        <g transform="rotate(${normalized.toFixed(2)} 42 42)">
          <path class="heading-compass__needle" d="M42 14 L49 38 L42 33 L35 38 Z" />
        </g>
      </svg>
      <div class="heading-compass__value">heading ${normalized.toFixed(0).padStart(3, "0")}°</div>
    </div>
  `;
}

function renderSchematicHull(shipConfig: ShipConfig): string {
  const points = shipConfig.hull.silhouette
    .map((point) => {
      const projected = localToSchematic(point);

      return `${projected.x.toFixed(2)},${projected.y.toFixed(2)}`;
    })
    .join(" ");
  const nose = localToSchematic({ x: 0, y: -0.5 });
  const tail = localToSchematic({ x: 0, y: 0.6 });

  return `
    <polygon class="ssd-hull__shape" points="${points}" />
    <line class="ssd-hull__spine" x1="${nose.x.toFixed(2)}" y1="${nose.y.toFixed(2)}" x2="${tail.x.toFixed(
      2
    )}" y2="${tail.y.toFixed(2)}" />
  `;
}

function renderSchematicSystem(
  state: MatchSessionView["battle_state"],
  ship: ShipRuntimeState,
  system: ShipSystemConfig,
  selectedSystemId: SystemId | null,
  weaponIntent: Pick<WeaponIntentPresentation, "is_armed"> | null,
  playbackTone: "hit" | "critical" | null
): string {
  const stateAndEffects = getSystemStateAndEffects(state, ship, system.id);
  const runtimeSystem = ship.systems[system.id];

  if (!runtimeSystem) {
    return "";
  }

  const position = localToSchematic(system.ssd_position ?? system.physical_position);
  const hitX = position.x - SCHEMATIC_VIEWPORT.hitWidth / 2;
  const hitY = position.y - SCHEMATIC_VIEWPORT.hitHeight / 2;
  const bodyX = position.x - SCHEMATIC_VIEWPORT.bodyWidth / 2;
  const bodyY = position.y - SCHEMATIC_VIEWPORT.bodyHeight / 2;
  const integrityPercent = (runtimeSystem.current_integrity / system.max_integrity) * 100;

  const classes = [
    "ssd-system",
    `ssd-system--${system.type}`,
    `ssd-system--${stateAndEffects.state_label}`,
    weaponIntent?.is_armed ? "ssd-system--armed" : "",
    playbackTone === "hit" ? "ssd-system--recent-hit" : "",
    playbackTone === "critical" ? "ssd-system--critical-hit" : "",
    selectedSystemId === system.id ? "ssd-system--selected" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const metaLabel = formatPercent(integrityPercent);

  return `
    <g class="${classes}" data-select-system="${system.id}">
      <rect
        class="ssd-system__hit"
        data-select-system-hit="${system.id}"
        x="${hitX.toFixed(2)}"
        y="${hitY.toFixed(2)}"
        width="${SCHEMATIC_VIEWPORT.hitWidth}"
        height="${SCHEMATIC_VIEWPORT.hitHeight}"
        rx="14"
      />
      <rect class="ssd-system__body" x="${bodyX.toFixed(2)}" y="${bodyY.toFixed(2)}" width="${
        SCHEMATIC_VIEWPORT.bodyWidth
      }" height="${SCHEMATIC_VIEWPORT.bodyHeight}" rx="10" />
      <text class="ssd-system__label" x="${position.x.toFixed(2)}" y="${(position.y - 2).toFixed(2)}">
        ${getSystemShortLabel(system)}
      </text>
      <text class="ssd-system__meta" x="${position.x.toFixed(2)}" y="${(position.y + 10).toFixed(2)}">
        ${metaLabel}
      </text>
    </g>
  `;
}

function renderSchematicControlDeck(
  sessionValue: MatchSessionView | null,
  identityValue: SessionIdentity | null,
  plotSummary: PlotDraftSummary | null,
  selectedSystemContext: SelectedSystemContext | null,
  plotPreview: PlotPreview | null,
  outcomePresentation: OutcomePresentation,
  getContactLabel: (shipInstanceId: ShipInstanceId | null) => string
): string {
  if (!identityValue || identityValue.role !== "player") {
    return "";
  }

  if (isMatchEnded(sessionValue)) {
    return `
      <div class="ssd-control-deck ssd-control-deck--locked">
        <div class="ssd-control-deck__header">
          <div>
            <span class="section-kicker">Plot Controls</span>
            <strong>Locked</strong>
          </div>
          <span class="ssd-control-deck__status ssd-control-deck__status--pending">match over</span>
        </div>
        <div class="ssd-control-deck__note">
          <strong>${outcomePresentation?.headline ?? "Match ended"}</strong><br />
          ${outcomePresentation?.detail ?? "The duel is over."}<br />
          Plotting is disabled until the host resets the duel.
        </div>
      </div>
    `;
  }

  if (!sessionValue || !plotSummary) {
    return `<div class="ssd-control-deck__note">Waiting for a playable ship and battle snapshot before enabling plot authoring.</div>`;
  }

  const { context, draft, power, desired_end_heading_degrees: desiredHeading, world_thrust_fraction: worldThrust } = plotSummary;
  const isPending = sessionValue.pending_plot_ship_ids.includes(context.ship_instance_id);
  let selectedPanel = `<div class="ssd-control-deck__note">Select a system on the SSD. Weapon mounts enter aim mode and use tactical contact clicks for fire intent.</div>`;

  if (selectedSystemContext) {
    if (selectedSystemContext.system.type === "weapon_mount") {
      const mountContext = context.weapon_mounts.find((mount) => mount.mount_id === selectedSystemContext.system.id);
      const weaponDraft = draft.weapons.find((weapon) => weapon.mount_id === selectedSystemContext.system.id);
      const cue = plotPreview?.weapon_cues.find((candidate) => candidate.mount_id === selectedSystemContext.system.id) ?? null;
      const selectedChargePips = weaponDraft?.charge_pips ?? 0;
      const intent = getWeaponIntentPresentation(
        getContactLabel,
        weaponDraft,
        cue,
        mountContext?.firing_enabled ?? false
      );
      const canClearTarget = weaponDraft?.target_ship_instance_id !== null || selectedChargePips > 0;
      const chargeOptions = [
        `<option value="0"${selectedChargePips === 0 ? " selected" : ""}>Hold fire</option>`,
        ...(mountContext?.allowed_charge_pips ?? []).map(
          (pips) => `<option value="${pips}"${selectedChargePips === pips ? " selected" : ""}>${pips} pip</option>`
        )
      ].join("");

      selectedPanel = `
        <section class="ssd-selected-panel ssd-selected-panel--aim">
          <div class="ssd-selected-panel__header">
            <div>
              <span class="section-kicker">Aim Mode</span>
              <strong>${mountContext?.label ?? selectedSystemContext.system.id}</strong>
            </div>
            <button class="action-button action-button--secondary action-button--compact" data-clear-system-selection>
              <span class="action-button__row">
                <span class="action-button__label">Close</span>
                <small class="action-button__hotkey">Esc</small>
              </span>
            </button>
          </div>
          <div class="ssd-selection-banner ssd-selection-banner--${intent.tone}">
            ${intent.banner_label}
          </div>
          <div class="ssd-selected-panel__grid">
            <label class="ssd-inline-field">
              <span>Charge</span>
              <select data-aim-charge="${selectedSystemContext.system.id}" ${!mountContext?.firing_enabled ? "disabled" : ""}>
                ${chargeOptions}
              </select>
            </label>
            <div class="ssd-selected-panel__actions">
              <button
                class="action-button action-button--secondary action-button--compact"
                data-clear-aim-target="${selectedSystemContext.system.id}"
                ${canClearTarget ? "" : "disabled"}
              >
                <span class="action-button__row">
                  <span class="action-button__label">Clear Target</span>
                </span>
              </button>
            </div>
            <div class="ssd-selected-readout ssd-selected-readout--${intent.tone}">
              <span>Target</span>
              <strong>${intent.target_label}</strong>
            </div>
            <div class="ssd-selected-readout ssd-selected-readout--${intent.tone}">
              <span>Fire Control</span>
              <strong>${intent.status_label}</strong>
            </div>
            <div class="ssd-selected-readout ssd-selected-readout--${intent.tone}">
              <span>Solution</span>
              <strong>${intent.shot_quality_label}</strong>
            </div>
            <div class="ssd-selected-readout ssd-selected-readout--${intent.tone}">
              <span>Arc / Range</span>
              <strong>${intent.shot_state_label}</strong>
            </div>
          </div>
          <p class="ssd-control-deck__note">Click an enemy contact in the tactical plot to lock this mount. Click the same contact again or use Clear Target to stand it down.</p>
        </section>
      `;
    } else {
      selectedPanel = `
        <section class="ssd-selected-panel">
          <div class="ssd-selected-panel__header">
            <div>
              <span class="section-kicker">System Detail</span>
              <strong>${selectedSystemContext.system.render?.label ?? selectedSystemContext.system.id}</strong>
            </div>
            <button class="action-button action-button--secondary action-button--compact" data-clear-system-selection>
              <span class="action-button__row">
                <span class="action-button__label">Close</span>
                <small class="action-button__hotkey">Esc</small>
              </span>
            </button>
          </div>
          <div class="ssd-selected-panel__grid">
            <div class="ssd-selected-readout">
              <span>State</span>
              <strong>${selectedSystemContext.state_label.toUpperCase()}</strong>
            </div>
            <div class="ssd-selected-readout">
              <span>Integrity</span>
              <strong>${formatPercent(selectedSystemContext.integrity_percent)}</strong>
            </div>
          </div>
          <p class="ssd-control-deck__note">Non-weapon systems are read-only in v0.1. Weapon mounts enter aim mode.</p>
        </section>
      `;
    }
  }

  return `
    <div class="ssd-control-deck">
      <div class="ssd-control-deck__header">
        <div>
          <span class="section-kicker">Plot Controls</span>
          <strong>Turn ${context.turn_number}</strong>
        </div>
        <span class="ssd-control-deck__status ${isPending ? "ssd-control-deck__status--pending" : ""}">
          ${isPending ? "submitted" : "editing"}
        </span>
      </div>
      <div class="ssd-control-grid">
        <label class="ssd-slider-card">
          <span>Turn</span>
          <strong>${formatSignedNumber(draft.heading_delta_degrees)}°</strong>
          <small>End ${desiredHeading.toFixed(0).padStart(3, "0")}°</small>
          <input
            type="range"
            min="${-Math.round(context.effective_turn_cap_degrees)}"
            max="${Math.round(context.effective_turn_cap_degrees)}"
            step="1"
            value="${draft.heading_delta_degrees}"
            data-plot-heading
          />
        </label>
        <label class="ssd-slider-card">
          <span>Axial Trim</span>
          <strong>${formatSignedNumber(draft.thrust_input.axial_fraction * 100)}%</strong>
          <small>Stern to bow</small>
          <input
            type="range"
            min="-100"
            max="100"
            step="5"
            value="${Math.round(draft.thrust_input.axial_fraction * 100)}"
            data-plot-axial
          />
        </label>
        <label class="ssd-slider-card">
          <span>Lateral Trim</span>
          <strong>${formatSignedNumber(draft.thrust_input.lateral_fraction * 100)}%</strong>
          <small>Port to starboard</small>
          <input
            type="range"
            min="-100"
            max="100"
            step="5"
            value="${Math.round(draft.thrust_input.lateral_fraction * 100)}"
            data-plot-lateral
          />
        </label>
      </div>
      <p class="ssd-control-deck__hint">Primary controls live on the tactical plot. Use these sliders for fine trim.</p>
      <div class="ssd-control-summary">
        <div class="ssd-summary-chip"><span>Drive</span><strong>${power.drive_pips}</strong></div>
        <div class="ssd-summary-chip"><span>Railgun</span><strong>${power.railgun_pips}</strong></div>
        <div class="ssd-summary-chip"><span>Burn</span><strong>${formatSignedNumber(
          worldThrust.x,
          2
        )}, ${formatSignedNumber(worldThrust.y, 2)}</strong></div>
      </div>
      ${selectedPanel}
    </div>
  `;
}

export function renderSchematicPanel({
  sessionValue,
  identityValue,
  displayed,
  plotSummary,
  selectedSystemContext,
  plotPreview,
  playbackEvent,
  selectedSystemId,
  outcomePresentation,
  getContactLabel
}: RenderSchematicPanelArgs): string {
  if (!displayed || !sessionValue) {
    return "<p>Waiting for ship telemetry before drawing the schematic.</p>";
  }

  const { participant, ship, shipConfig } = displayed;
  const hullPercent = (ship.hull.current_integrity / shipConfig.hull.max_integrity) * 100;
  const reactorPips = getAvailableReactorPips(sessionValue.battle_state, ship);
  const speed = Math.hypot(ship.pose.velocity.x, ship.pose.velocity.y);
  const weaponIntentByMountId = new Map<SystemId, Pick<WeaponIntentPresentation, "is_armed">>();

  if (plotSummary) {
    for (const weapon of plotSummary.draft.weapons) {
      const cue = plotPreview?.weapon_cues.find((candidate) => candidate.mount_id === weapon.mount_id) ?? null;
      const mountContext = plotSummary.context.weapon_mounts.find((candidate) => candidate.mount_id === weapon.mount_id);
      const intent = getWeaponIntentPresentation(getContactLabel, weapon, cue, mountContext?.firing_enabled ?? false);

      weaponIntentByMountId.set(weapon.mount_id, {
        is_armed: intent.is_armed
      });
    }
  }

  const systems = [...shipConfig.systems]
    .sort((left, right) => left.physical_position.y - right.physical_position.y)
    .map((system) =>
      renderSchematicSystem(
        sessionValue.battle_state,
        ship,
        system,
        selectedSystemId,
        system.type === "weapon_mount" ? weaponIntentByMountId.get(system.id) ?? null : null,
        getSystemPlaybackTone(playbackEvent, ship.ship_instance_id, system.id)
      )
    )
    .join("");
  const controlDeck = renderSchematicControlDeck(
    sessionValue,
    identityValue,
    plotSummary,
    selectedSystemContext,
    plotPreview,
    outcomePresentation,
    getContactLabel
  );
  const schematicKicker = identityValue?.role === "player" ? "Your Ship" : participant.slot_id.toUpperCase();
  const displayHeadingDegrees = ship.pose.heading_degrees;

  return `
    <section class="schematic-shell">
      <div class="schematic-shell__header">
        <div class="schematic-shell__header-main">
          <div>
            <span class="section-kicker">${schematicKicker}</span>
            <h2>${shipConfig.name}</h2>
            <p>Fixed-orientation ship schematic</p>
          </div>
          <div class="ssd-status-grid">
            <article class="status-tile">
              <span>Hull</span>
              <strong>${formatPercent(hullPercent)}</strong>
            </article>
            <article class="status-tile">
              <span>Reactor</span>
              <strong>${reactorPips} pips</strong>
            </article>
            <article class="status-tile">
              <span>Velocity</span>
              <strong>${formatNumber(speed)}</strong>
            </article>
          </div>
        </div>
        ${renderHeadingCompass(displayHeadingDegrees)}
      </div>
      <div class="schematic-shell__body">
        <div class="ssd-viewport">
          <svg viewBox="0 0 ${SCHEMATIC_VIEWPORT.width} ${SCHEMATIC_VIEWPORT.height}" aria-label="Ship schematic">
            <rect class="ssd-viewport__frame" x="10" y="10" width="${SCHEMATIC_VIEWPORT.width - 20}" height="${
              SCHEMATIC_VIEWPORT.height - 20
            }" rx="24" />
            ${renderSchematicHull(shipConfig)}
            ${systems}
          </svg>
        </div>
        ${controlDeck}
      </div>
    </section>
  `;
}
