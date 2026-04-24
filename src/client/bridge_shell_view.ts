type MatchOutcomePresentation = {
  tone: "victory" | "defeat" | "neutral";
  headline: string;
  detail: string;
  reset_hint: string;
};

type ReadoutStripPresentation = {
  turn_label: string;
  drive_label: string;
  railgun_label: string;
} | null;

type FooterStripPresentation = {
  current_resolution_label: string;
  current_resolution_meta_label: string;
  current_resolution_progress_ratio: number | null;
  combat_feed_items: Array<{
    step_label: string;
    summary: string;
    is_active: boolean;
  }>;
  empty_combat_feed_label: string;
  link_status_label: string;
  bridge_message: string;
  show_host_tools: boolean;
  is_host_tools_open: boolean;
};

type ClaimSeatAction = {
  slot_id: string;
  label: string;
};

type ActionStripPresentation =
  | {
      kind: "waiting";
      note: string;
    }
  | {
      kind: "spectator";
      note: string;
      claim_actions: ClaimSeatAction[];
    }
  | {
      kind: "ended";
      headline: string;
    }
  | {
      kind: "player";
      status_label: string;
      claim_actions: ClaimSeatAction[];
      controls_locked: boolean;
    };

type ZoomPresetPresentation = {
  id: string;
  short_label: string;
  active: boolean;
};

type RenderBridgeShellArgs = {
  phase_label: string;
  turn_label: string;
  station_label: string;
  situational_status: string;
  link_status_label: string;
  is_link_ok: boolean;
  is_aim_mode: boolean;
  schematic_viewport: string;
  tactical_title: string;
  tactical_hint: string;
  camera_controls: string;
  tactical_viewport: string;
  outcome_banner: string;
  readout_strip: string;
  action_strip_controls: string;
  footer_strip: string;
};

function renderHostToolsMenu(showHostTools: boolean, isOpen: boolean): string {
  if (!showHostTools) {
    return "";
  }

  return `
    <details class="host-tools" data-host-tools ${isOpen ? "open" : ""}>
      <summary class="host-tools__toggle" data-host-tools-toggle>
        <span class="host-tools__copy">
          <span class="host-tools__label">Host Tools</span>
          <small class="host-tools__hint">Admin</small>
        </span>
        <span class="host-tools__chevron" aria-hidden="true">▾</span>
      </summary>
      <div class="host-tools__menu">
        <button class="action-button action-button--danger action-button--compact" data-reset-session>
          <span class="action-button__row">
            <span class="action-button__label">Reset Match</span>
            <small class="action-button__hint">Host</small>
          </span>
        </button>
      </div>
    </details>
  `;
}

function renderClaimSeatButtons(claimActions: ClaimSeatAction[]): string {
  return claimActions
    .map(
      (slotState) =>
        `<button class="action-button action-button--secondary" data-claim-slot="${slotState.slot_id}">
          <span class="action-button__row">
            <span class="action-button__label">${slotState.label}</span>
          </span>
        </button>`
    )
    .join("");
}

export function renderReadoutStrip(readout: ReadoutStripPresentation): string {
  if (!readout) {
    return `
      <div class="readout-strip">
        <div class="readout-chip"><span>Turn</span><strong>...</strong></div>
        <div class="readout-chip"><span>Drive</span><strong>...</strong></div>
        <div class="readout-chip"><span>Railgun</span><strong>...</strong></div>
      </div>
    `;
  }

  return `
    <div class="readout-strip">
      <div class="readout-chip">
        <span>Turn</span>
        <strong>${readout.turn_label}</strong>
      </div>
      <div class="readout-chip">
        <span>Drive</span>
        <strong>${readout.drive_label}</strong>
      </div>
      <div class="readout-chip">
        <span>Railgun</span>
        <strong>${readout.railgun_label}</strong>
      </div>
    </div>
  `;
}

export function renderMatchOutcomeBanner(outcome: MatchOutcomePresentation | null): string {
  if (!outcome) {
    return "";
  }

  return `
    <section class="match-outcome-banner match-outcome-banner--${outcome.tone}">
      <div class="match-outcome-banner__copy">
        <span class="section-kicker">Match Outcome</span>
        <strong>${outcome.headline}</strong>
        <p>${outcome.detail}</p>
      </div>
      <div class="match-outcome-banner__hint">${outcome.reset_hint}</div>
    </section>
  `;
}

export function renderFooterStrip(footer: FooterStripPresentation): string {
  const recentResolutionMarkup =
    footer.combat_feed_items.length > 0
      ? `<ul class="resolution-feed">${footer.combat_feed_items
          .map(
            (item) => `<li class="${item.is_active ? "resolution-feed__item resolution-feed__item--active" : "resolution-feed__item"}">
              <span class="resolution-feed__step">${item.step_label}</span>
              <span class="resolution-feed__summary" data-combat-feed-summary>${item.summary}</span>
            </li>`
          )
          .join("")}</ul>`
      : `<div class="resolution-feed resolution-feed--empty">${footer.empty_combat_feed_label}</div>`;
  const progressMarkup =
    footer.current_resolution_progress_ratio !== null
      ? `<div class="resolution-progress" aria-hidden="true">
          <span class="resolution-progress__bar">
            <span class="resolution-progress__fill" style="width:${(footer.current_resolution_progress_ratio * 100).toFixed(
              1
            )}%"></span>
          </span>
        </div>`
      : "";

  return `
    <section class="footer-strip">
      <div class="footer-strip__cell">
        <span class="section-kicker">Current Resolution</span>
        <strong data-current-resolution>${footer.current_resolution_label}</strong>
        <span class="footer-strip__meta" data-current-resolution-meta>${footer.current_resolution_meta_label}</span>
        ${progressMarkup}
      </div>
      <div class="footer-strip__cell">
        <span class="section-kicker">Combat Feed</span>
        ${recentResolutionMarkup}
      </div>
      <div class="footer-strip__cell footer-strip__cell--log">
        <span class="section-kicker">Bridge Link</span>
        <strong>${footer.link_status_label}</strong>
        <span class="footer-strip__meta">${footer.bridge_message}</span>
        ${renderHostToolsMenu(footer.show_host_tools, footer.is_host_tools_open)}
      </div>
    </section>
  `;
}

export function renderTacticalCameraControls(zoomPresets: ZoomPresetPresentation[]): string {
  const zoomMarkup = zoomPresets
    .map(
      (preset) =>
        `<button class="camera-toggle ${preset.active ? "camera-toggle--active" : ""}" data-camera-zoom="${preset.id}">${
          preset.short_label
        }</button>`
    )
    .join("");

  return `
    <div class="camera-controls">
      <div class="camera-controls__group">
        <span class="camera-controls__label">Zoom</span>
        <div class="camera-toggle-row">${zoomMarkup}</div>
      </div>
    </div>
  `;
}

export function renderActionStripControls(actionStrip: ActionStripPresentation): string {
  if (actionStrip.kind === "waiting") {
    return `<p class="action-strip__note">${actionStrip.note}</p>`;
  }

  if (actionStrip.kind === "spectator") {
    return `
      <section class="commit-strip commit-strip--spectator">
        <p class="action-strip__note">${actionStrip.note}</p>
        <div class="commit-strip__actions">
          ${renderClaimSeatButtons(actionStrip.claim_actions)}
        </div>
      </section>
    `;
  }

  if (actionStrip.kind === "ended") {
    return `
      <section class="commit-strip commit-strip--ended">
        <div class="commit-strip__status">
          <span class="section-kicker">Match Status</span>
          <strong data-turn-status>${actionStrip.headline}</strong>
        </div>
      </section>
    `;
  }

  return `
    <section class="commit-strip">
      <div class="commit-strip__status">
        <span class="section-kicker">Turn Status</span>
        <strong data-turn-status>${actionStrip.status_label}</strong>
      </div>
      <div class="commit-strip__actions">
        ${renderClaimSeatButtons(actionStrip.claim_actions)}
        <button class="action-button action-button--secondary" data-reset-plot ${actionStrip.controls_locked ? "disabled" : ""}>
          <span class="action-button__row">
            <span class="action-button__label">Reset Plot</span>
            <small class="action-button__hotkey">R</small>
          </span>
        </button>
        <button class="action-button action-button--primary" data-submit-plot ${actionStrip.controls_locked ? "disabled" : ""}>
          <span class="action-button__row">
            <span class="action-button__label">Submit Plot</span>
            <small class="action-button__hotkey">␣</small>
          </span>
        </button>
      </div>
    </section>
  `;
}

export function renderBridgeShell(args: RenderBridgeShellArgs): string {
  const missionBarClass = `mission-bar${args.is_aim_mode ? " mission-bar--aim" : ""}`;

  return `
    <main class="bridge-shell">
      <header class="${missionBarClass}">
        <div class="mission-bar__mode" data-phase-label>${args.phase_label}</div>
        <div class="mission-bar__meta">
          <span data-turn-number>${args.turn_label}</span>
          <span>${args.station_label}</span>
        </div>
        <div class="mission-bar__status">
          <span>${args.situational_status}</span>
          <span class="${args.is_link_ok ? "status--ok" : "status--warn"}">${args.link_status_label}</span>
        </div>
      </header>
      <section class="bridge-main">
        <article class="bridge-panel bridge-panel--schematic">
          ${args.schematic_viewport}
        </article>
        <article class="bridge-panel bridge-panel--tactical">
          <div class="tactical-panel__header">
            <div>
              <span class="section-kicker">Tactical View</span>
              <h2>${args.tactical_title}</h2>
            </div>
            <div class="tactical-panel__header-right">
              <div class="tactical-panel__meta">
                <span>${args.tactical_hint}</span>
              </div>
              ${args.camera_controls}
            </div>
          </div>
          ${args.tactical_viewport}
        </article>
      </section>
      ${args.outcome_banner}
      <section class="action-strip">
        <div class="action-strip__readouts">
          ${args.readout_strip}
        </div>
        <div class="action-strip__controls">
          ${args.action_strip_controls}
        </div>
      </section>
      ${args.footer_strip}
    </main>
  `;
}
