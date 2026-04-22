import {
  clampWorldPointToTacticalViewportEdge,
  getArcPolygonPoints,
  getHeadingDegreesInTacticalCamera,
  getShipConfig,
  getTacticalCameraScaleBarWorldUnits,
  isWorldPointVisibleInTacticalCamera,
  worldToTacticalViewport
} from "../shared/index.js";
import type {
  MatchSessionView,
  PlotDraftSummary,
  PlotPreview,
  ResolverEvent,
  SessionIdentity,
  ShipConfig,
  ShipInstanceId,
  ShipRuntimeState,
  SystemId,
  TacticalCamera,
  Vector2
} from "../shared/index.js";

export const TACTICAL_VIEWPORT = {
  width: 960,
  height: 860,
  padding: 20,
  hullScalePx: 44,
  headingVectorLengthPx: 28,
  markerInsetPx: 22,
  scaleBarTargetPx: 112
} as const;

const TACTICAL_PLOT_HANDLES = {
  thrustRadiusPx: 72,
  headingRadiusPx: 44,
  deadzonePx: 8
} as const;

type WeaponCue = PlotPreview["weapon_cues"][number];

type RenderTacticalBoardArgs = {
  sessionValue: MatchSessionView;
  identityValue: SessionIdentity | null;
  plotSummary: PlotDraftSummary | null;
  plotPreview: PlotPreview | null;
  focusedMountId: SystemId | null;
  camera: TacticalCamera;
  playbackEvent: ResolverEvent | null;
  getContactShortLabel: (shipInstanceId: ShipInstanceId | null) => string;
};

function normalizeDegrees(angle: number): number {
  const normalized = angle % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function formatDistance(value: number): string {
  return `${Math.round(value)} km`;
}

function isArmedWeaponCue(cue: WeaponCue | null | undefined): boolean {
  return Boolean(cue && cue.firing_enabled && cue.charge_pips > 0 && cue.target_ship_instance_id !== null);
}

function getHeadingVector(headingDegrees: number, length: number): Vector2 {
  const radians = (headingDegrees * Math.PI) / 180;

  return {
    x: Math.sin(radians) * length,
    y: -Math.cos(radians) * length
  };
}

function getTacticalShipLabel(
  identityValue: SessionIdentity | null,
  ship: ShipRuntimeState,
  shipConfig: ShipConfig
): string {
  if (identityValue?.role === "player") {
    return identityValue.ship_instance_id === ship.ship_instance_id ? "YOU" : "CONTACT";
  }

  return shipConfig.name.toUpperCase();
}

function shouldRenderTacticalText(camera: TacticalCamera): boolean {
  return camera.selection.zoom_preset_id !== "close";
}

function getShipHullPoints(shipConfig: ShipConfig, center: Vector2): string {
  return shipConfig.hull.silhouette
    .map((point) => {
      const x = center.x + point.x * TACTICAL_VIEWPORT.hullScalePx;
      const y = center.y + point.y * TACTICAL_VIEWPORT.hullScalePx;

      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function renderGuideLines(): string {
  const lines: string[] = [];
  const steps = 4;
  const innerWidth = TACTICAL_VIEWPORT.width - TACTICAL_VIEWPORT.padding * 2;
  const innerHeight = TACTICAL_VIEWPORT.height - TACTICAL_VIEWPORT.padding * 2;

  for (let step = 0; step <= steps; step += 1) {
    const x = TACTICAL_VIEWPORT.padding + (innerWidth * step) / steps;
    const y = TACTICAL_VIEWPORT.padding + (innerHeight * step) / steps;

    lines.push(
      `<line class="tactical-board__grid-line" x1="${x}" y1="${TACTICAL_VIEWPORT.padding}" x2="${x}" y2="${
        TACTICAL_VIEWPORT.height - TACTICAL_VIEWPORT.padding
      }" />`
    );
    lines.push(
      `<line class="tactical-board__grid-line" x1="${TACTICAL_VIEWPORT.padding}" y1="${y}" x2="${
        TACTICAL_VIEWPORT.width - TACTICAL_VIEWPORT.padding
      }" y2="${y}" />`
    );
  }

  return lines.join("");
}

function renderShipGlyph(
  sessionValue: MatchSessionView,
  identityValue: SessionIdentity | null,
  camera: TacticalCamera,
  ship: ShipRuntimeState,
  shipConfig: ShipConfig,
  targetCue: WeaponCue | null,
  isTargeted: boolean,
  isTargetable: boolean,
  playbackTone: "hit" | "destroyed" | "disengaged" | null
): string {
  const center = worldToTacticalViewport(camera, ship.pose.position);
  const hullPoints = getShipHullPoints(shipConfig, center);
  const displayHeadingDegrees = getHeadingDegreesInTacticalCamera(camera, ship.pose.heading_degrees);
  const headingVector = getHeadingVector(displayHeadingDegrees, TACTICAL_VIEWPORT.headingVectorLengthPx);
  const oneTurnDriftSeconds = sessionValue.battle_state.match_setup.rules.turn.duration_seconds;
  const velocityProjection = worldToTacticalViewport(camera, {
    x: ship.pose.position.x + ship.pose.velocity.x * oneTurnDriftSeconds,
    y: ship.pose.position.y + ship.pose.velocity.y * oneTurnDriftSeconds
  });
  const classes = [
    "ship-glyph",
    identityValue?.ship_instance_id === ship.ship_instance_id ? "ship-glyph--self" : "",
    sessionValue.pending_plot_ship_ids.includes(ship.ship_instance_id) ? "ship-glyph--pending" : "",
    isTargeted ? "ship-glyph--targeted" : "",
    playbackTone === "hit" ? "ship-glyph--impact" : "",
    playbackTone === "destroyed" ? "ship-glyph--destroyed" : "",
    playbackTone === "disengaged" ? "ship-glyph--disengaged" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const targetAttribute = isTargetable ? `data-target-ship="${ship.ship_instance_id}"` : "";
  const targetTag =
    targetCue && isArmedWeaponCue(targetCue)
      ? `${targetCue.charge_pips}P · ${
          targetCue.predicted_hit_probability !== null ? `${Math.round(targetCue.predicted_hit_probability * 100)}%` : "locked"
        }`
      : null;
  const label = getTacticalShipLabel(identityValue, ship, shipConfig);
  const showText = shouldRenderTacticalText(camera);

  return `
    <g class="${classes}">
      <circle
        class="ship-glyph__hit ${isTargetable ? "ship-glyph__hit--targetable" : ""}"
        cx="${center.x.toFixed(2)}"
        cy="${center.y.toFixed(2)}"
        r="30"
        ${targetAttribute}
      />
      <line
        class="ship-glyph__velocity"
        x1="${center.x.toFixed(2)}"
        y1="${center.y.toFixed(2)}"
        x2="${velocityProjection.x.toFixed(2)}"
        y2="${velocityProjection.y.toFixed(2)}"
      />
      <polygon class="ship-glyph__hull" points="${hullPoints}" transform="rotate(${displayHeadingDegrees.toFixed(
        2
      )} ${center.x.toFixed(2)} ${center.y.toFixed(2)})" />
      <line
        class="ship-glyph__heading"
        x1="${center.x.toFixed(2)}"
        y1="${center.y.toFixed(2)}"
        x2="${(center.x + headingVector.x).toFixed(2)}"
        y2="${(center.y + headingVector.y).toFixed(2)}"
      />
      <circle class="ship-glyph__core" cx="${center.x.toFixed(2)}" cy="${center.y.toFixed(2)}" r="4" />
      ${
        isTargeted
          ? `<circle class="ship-glyph__target-ring" cx="${center.x.toFixed(2)}" cy="${center.y.toFixed(2)}" r="22" />`
          : ""
      }
      ${showText ? `<text class="ship-glyph__label" x="${center.x.toFixed(2)}" y="${(center.y - 20).toFixed(2)}">${label}</text>` : ""}
      ${
        targetTag && showText
          ? `<text class="ship-glyph__target-tag" x="${center.x.toFixed(2)}" y="${(center.y + 32).toFixed(2)}">TARGET · ${targetTag}</text>`
          : ""
      }
    </g>
  `;
}

function renderPreviewPath(camera: TacticalCamera, plotPreview: PlotPreview): string {
  const points = plotPreview.projected_path
    .map((sample) => {
      const point = worldToTacticalViewport(camera, sample.position);
      return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
    })
    .join(" ");

  if (!points) {
    return "";
  }

  return `<polyline class="plot-preview__path" points="${points}" />`;
}

function renderPreviewGhost(sessionValue: MatchSessionView, camera: TacticalCamera, plotPreview: PlotPreview): string {
  const ship = sessionValue.battle_state.ships[plotPreview.ship_instance_id];

  if (!ship) {
    return "";
  }

  const shipConfig = getShipConfig(sessionValue.battle_state, ship);
  const center = worldToTacticalViewport(camera, plotPreview.projected_pose.position);
  const hullPoints = getShipHullPoints(shipConfig, center);
  const displayHeadingDegrees = getHeadingDegreesInTacticalCamera(camera, plotPreview.projected_pose.heading_degrees);
  const headingVector = getHeadingVector(displayHeadingDegrees, TACTICAL_VIEWPORT.headingVectorLengthPx);
  const labelY = center.y - 22;

  return `
    <g class="plot-preview__ghost">
      <polygon
        class="plot-preview__ghost-hull"
        points="${hullPoints}"
        transform="rotate(${displayHeadingDegrees.toFixed(2)} ${center.x.toFixed(2)} ${center.y.toFixed(2)})"
      />
      <line
        class="plot-preview__ghost-heading"
        x1="${center.x.toFixed(2)}"
        y1="${center.y.toFixed(2)}"
        x2="${(center.x + headingVector.x).toFixed(2)}"
        y2="${(center.y + headingVector.y).toFixed(2)}"
      />
      <circle class="plot-preview__ghost-core" cx="${center.x.toFixed(2)}" cy="${center.y.toFixed(2)}" r="4" />
      ${
        shouldRenderTacticalText(camera)
          ? `<text class="plot-preview__ghost-label" x="${center.x.toFixed(2)}" y="${labelY.toFixed(2)}">${plotPreview.projected_pose.heading_degrees.toFixed(0).padStart(3, "0")}°</text>`
          : ""
      }
    </g>
  `;
}

function renderPlotInteractionHandles(
  sessionValue: MatchSessionView,
  camera: TacticalCamera,
  plotSummary: PlotDraftSummary | null,
  plotPreview: PlotPreview | null
): string {
  if (!plotSummary || !plotPreview) {
    return "";
  }

  const ship = sessionValue.battle_state.ships[plotPreview.ship_instance_id];

  if (!ship) {
    return "";
  }

  if (!isWorldPointVisibleInTacticalCamera(camera, ship.pose.position, 42)) {
    return "";
  }

  const shipAnchor = worldToTacticalViewport(camera, ship.pose.position);
  const thrustDirectionPoint = worldToTacticalViewport(camera, {
    x: ship.pose.position.x + plotSummary.world_thrust_fraction.x,
    y: ship.pose.position.y + plotSummary.world_thrust_fraction.y
  });
  const thrustScreenDelta = {
    x: thrustDirectionPoint.x - shipAnchor.x,
    y: thrustDirectionPoint.y - shipAnchor.y
  };
  const thrustMagnitude = Math.hypot(plotSummary.world_thrust_fraction.x, plotSummary.world_thrust_fraction.y);
  const thrustScreenDistance = Math.hypot(thrustScreenDelta.x, thrustScreenDelta.y);
  const thrustDirection =
    thrustScreenDistance > 0
      ? {
          x: thrustScreenDelta.x / thrustScreenDistance,
          y: thrustScreenDelta.y / thrustScreenDistance
        }
      : {
          x: 0,
          y: -1
        };
  const thrustHandle = {
    x: shipAnchor.x + thrustDirection.x * thrustMagnitude * TACTICAL_PLOT_HANDLES.thrustRadiusPx,
    y: shipAnchor.y + thrustDirection.y * thrustMagnitude * TACTICAL_PLOT_HANDLES.thrustRadiusPx
  };
  const headingAnchor = worldToTacticalViewport(camera, plotPreview.projected_pose.position);
  const displayHeadingDegrees = getHeadingDegreesInTacticalCamera(camera, plotPreview.desired_end_heading_degrees);
  const headingVector = getHeadingVector(displayHeadingDegrees, TACTICAL_PLOT_HANDLES.headingRadiusPx);
  const headingHandle = {
    x: headingAnchor.x + headingVector.x,
    y: headingAnchor.y + headingVector.y
  };
  const thrustRotationDegrees =
    Math.abs(thrustHandle.x - shipAnchor.x) < 0.01 && Math.abs(thrustHandle.y - shipAnchor.y) < 0.01
      ? 0
      : normalizeDegrees((Math.atan2(thrustHandle.x - shipAnchor.x, shipAnchor.y - thrustHandle.y) * 180) / Math.PI);

  return `
    <g class="plot-handles">
      <g class="plot-handles__thrust">
        <circle
          class="plot-handles__guide-ring"
          cx="${shipAnchor.x.toFixed(2)}"
          cy="${shipAnchor.y.toFixed(2)}"
          r="${TACTICAL_PLOT_HANDLES.thrustRadiusPx}"
        />
        <line
          class="plot-handles__vector"
          x1="${shipAnchor.x.toFixed(2)}"
          y1="${shipAnchor.y.toFixed(2)}"
          x2="${thrustHandle.x.toFixed(2)}"
          y2="${thrustHandle.y.toFixed(2)}"
        />
        <circle
          class="plot-handles__hit-target"
          cx="${thrustHandle.x.toFixed(2)}"
          cy="${thrustHandle.y.toFixed(2)}"
          r="18"
          data-plot-drag-handle="thrust"
        />
        <g transform="translate(${thrustHandle.x.toFixed(2)} ${thrustHandle.y.toFixed(2)}) rotate(${thrustRotationDegrees.toFixed(2)})">
          <path
            class="plot-handles__grip plot-handles__grip--thrust"
            d="M0 -12 L8 -2 L3 -2 L3 11 L-3 11 L-3 -2 L-8 -2 Z"
            data-plot-drag-handle="thrust"
          />
        </g>
      </g>
      <g class="plot-handles__heading">
        <circle
          class="plot-handles__guide-ring plot-handles__guide-ring--heading"
          cx="${headingAnchor.x.toFixed(2)}"
          cy="${headingAnchor.y.toFixed(2)}"
          r="${TACTICAL_PLOT_HANDLES.headingRadiusPx}"
        />
        <line
          class="plot-handles__vector plot-handles__vector--heading"
          x1="${headingAnchor.x.toFixed(2)}"
          y1="${headingAnchor.y.toFixed(2)}"
          x2="${headingHandle.x.toFixed(2)}"
          y2="${headingHandle.y.toFixed(2)}"
        />
        <circle
          class="plot-handles__hit-target"
          cx="${headingHandle.x.toFixed(2)}"
          cy="${headingHandle.y.toFixed(2)}"
          r="16"
          data-plot-drag-handle="heading"
        />
        <circle
          class="plot-handles__grip plot-handles__grip--heading"
          cx="${headingHandle.x.toFixed(2)}"
          cy="${headingHandle.y.toFixed(2)}"
          r="9"
          data-plot-drag-handle="heading"
        />
      </g>
    </g>
  `;
}

function renderWeaponCue(
  camera: TacticalCamera,
  plotPreview: PlotPreview,
  focusedMountId: SystemId | null,
  showLabels: boolean,
  getContactShortLabel: (shipInstanceId: ShipInstanceId | null) => string
): string {
  return plotPreview.weapon_cues
    .map((cue) => {
      if (cue.target_position === null) {
        return "";
      }

      const polygonPoints = getArcPolygonPoints(cue, 12)
        .map((point) => {
          const projected = worldToTacticalViewport(camera, point);
          return `${projected.x.toFixed(2)},${projected.y.toFixed(2)}`;
        })
        .join(" ");
      const mountPoint = worldToTacticalViewport(camera, cue.mount_position);
      const targetPoint = worldToTacticalViewport(camera, cue.target_position);
      const isArmed = isArmedWeaponCue(cue);
      const isFocused = cue.mount_id === focusedMountId;
      const cueClass = !isArmed
        ? "plot-preview__cue--idle"
        : cue.target_in_arc && cue.target_in_range
          ? "plot-preview__cue--valid"
          : "plot-preview__cue--warn";
      const targetShortLabel = getContactShortLabel(cue.target_ship_instance_id).toUpperCase();
      const hitText = isArmed
        ? cue.predicted_hit_probability !== null
          ? `${Math.round(cue.predicted_hit_probability * 100)}%`
          : "no shot"
        : "standby";

      return `
        <g class="plot-preview__cue ${cueClass}${isFocused ? " plot-preview__cue--focused" : ""}">
          <polygon class="plot-preview__arc" points="${polygonPoints}" />
          ${
            isFocused
              ? `
          <line
            class="plot-preview__target-line"
            x1="${mountPoint.x.toFixed(2)}"
            y1="${mountPoint.y.toFixed(2)}"
            x2="${targetPoint.x.toFixed(2)}"
            y2="${targetPoint.y.toFixed(2)}"
          />
          <circle class="plot-preview__target-reticle" cx="${targetPoint.x.toFixed(2)}" cy="${targetPoint.y.toFixed(2)}" r="18" />
          `
              : ""
          }
          ${
            showLabels && isFocused
              ? `<text class="plot-preview__target-label" x="${targetPoint.x.toFixed(2)}" y="${(targetPoint.y - 24).toFixed(2)}">${cue.label} · ${targetShortLabel} · ${cue.charge_pips}p · ${hitText}</text>`
              : ""
          }
        </g>
      `;
    })
    .join("");
}

function renderPlotPreviewOverlay(
  sessionValue: MatchSessionView,
  camera: TacticalCamera,
  plotPreview: PlotPreview | null,
  focusedMountId: SystemId | null,
  getContactShortLabel: (shipInstanceId: ShipInstanceId | null) => string
): string {
  if (!plotPreview) {
    return "";
  }

  const focusedPreview =
    focusedMountId === null
      ? plotPreview
      : {
          ...plotPreview,
          weapon_cues: plotPreview.weapon_cues.filter((cue) => cue.mount_id === focusedMountId)
        };

  return `
    <g class="plot-preview">
      ${renderPreviewPath(camera, focusedPreview)}
      ${renderWeaponCue(camera, plotPreview, focusedMountId, shouldRenderTacticalText(camera), getContactShortLabel)}
      ${renderPreviewGhost(sessionValue, camera, focusedPreview)}
    </g>
  `;
}

function getOffscreenMarkerTextAnchor(camera: TacticalCamera, anchor: Vector2): "start" | "middle" | "end" {
  if (anchor.x <= camera.drawable.min_x + 40) {
    return "start";
  }

  if (anchor.x >= camera.drawable.max_x - 40) {
    return "end";
  }

  return "middle";
}

function renderOffscreenMarker(
  camera: TacticalCamera,
  viewpointShip: ShipRuntimeState | null,
  ship: ShipRuntimeState,
  label: string,
  targetCue: WeaponCue | null,
  isTargeted: boolean,
  isTargetable: boolean,
  isSelf: boolean,
  playbackTone: "hit" | "destroyed" | "disengaged" | null
): string {
  const anchor = clampWorldPointToTacticalViewportEdge(camera, ship.pose.position, TACTICAL_VIEWPORT.markerInsetPx);
  const targetAttribute = isTargetable ? `data-target-ship="${ship.ship_instance_id}"` : "";
  const labelAnchor = getOffscreenMarkerTextAnchor(camera, anchor);
  const labelX =
    labelAnchor === "start" ? anchor.x + 18 : labelAnchor === "end" ? anchor.x - 18 : anchor.x;
  const bearingDegrees = getHeadingDegreesInTacticalCamera(camera, ship.pose.heading_degrees) - 90;
  const rangeText = viewpointShip
    ? formatDistance(
        Math.hypot(ship.pose.position.x - viewpointShip.pose.position.x, ship.pose.position.y - viewpointShip.pose.position.y)
      )
    : formatDistance(Math.hypot(ship.pose.position.x - camera.center_world.x, ship.pose.position.y - camera.center_world.y));
  const classes = [
    "offscreen-marker",
    isSelf ? "offscreen-marker--self" : "",
    isTargeted ? "offscreen-marker--targeted" : "",
    isTargetable ? "offscreen-marker--targetable" : "",
    playbackTone === "hit" ? "offscreen-marker--impact" : "",
    playbackTone === "destroyed" ? "offscreen-marker--destroyed" : "",
    playbackTone === "disengaged" ? "offscreen-marker--disengaged" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const targetStatus =
    targetCue && isArmedWeaponCue(targetCue)
      ? `TARGET · ${targetCue.charge_pips}P${
          targetCue.predicted_hit_probability !== null ? ` · ${Math.round(targetCue.predicted_hit_probability * 100)}%` : ""
        }`
      : null;

  return `
    <g class="${classes}">
      <circle
        class="offscreen-marker__hit"
        cx="${anchor.x.toFixed(2)}"
        cy="${anchor.y.toFixed(2)}"
        r="24"
        ${targetAttribute}
      />
      <g transform="translate(${anchor.x.toFixed(2)} ${anchor.y.toFixed(2)}) rotate(${bearingDegrees.toFixed(2)})">
        <path class="offscreen-marker__arrow" d="M-12 -9 L12 0 L-12 9 Z" />
      </g>
      <circle class="offscreen-marker__core" cx="${anchor.x.toFixed(2)}" cy="${anchor.y.toFixed(2)}" r="4" />
      <text
        class="offscreen-marker__label"
        x="${labelX.toFixed(2)}"
        y="${(anchor.y - 16).toFixed(2)}"
        text-anchor="${labelAnchor}"
      >
        ${label} · ${rangeText}
      </text>
      ${
        targetStatus
          ? `<text class="offscreen-marker__status" x="${labelX.toFixed(2)}" y="${(anchor.y + 20).toFixed(2)}" text-anchor="${labelAnchor}">${targetStatus}</text>`
          : ""
      }
    </g>
  `;
}

function renderResolutionPlaybackOverlay(camera: TacticalCamera, playbackEvent: ResolverEvent | null): string {
  if (!playbackEvent) {
    return "";
  }

  if (playbackEvent.type === "weapon_fired") {
    const mountPoint = worldToTacticalViewport(camera, playbackEvent.details.mountPosition);
    const targetPoint = worldToTacticalViewport(camera, playbackEvent.details.targetPosition);

    return `
      <g class="resolution-playback resolution-playback--shot">
        <circle class="resolution-playback__flash" cx="${mountPoint.x.toFixed(2)}" cy="${mountPoint.y.toFixed(2)}" r="12" />
        <line
          class="resolution-playback__shot-line"
          x1="${mountPoint.x.toFixed(2)}"
          y1="${mountPoint.y.toFixed(2)}"
          x2="${targetPoint.x.toFixed(2)}"
          y2="${targetPoint.y.toFixed(2)}"
        />
      </g>
    `;
  }

  if (playbackEvent.type === "hit_registered") {
    const impactPoint = worldToTacticalViewport(camera, playbackEvent.details.impactPoint);

    return `
      <g class="resolution-playback resolution-playback--impact">
        <circle class="resolution-playback__impact-ring" cx="${impactPoint.x.toFixed(2)}" cy="${impactPoint.y.toFixed(2)}" r="16" />
        <circle class="resolution-playback__impact-core" cx="${impactPoint.x.toFixed(2)}" cy="${impactPoint.y.toFixed(2)}" r="5" />
      </g>
    `;
  }

  if (playbackEvent.type === "ship_destroyed" || playbackEvent.type === "ship_disengaged") {
    const finalPoint = worldToTacticalViewport(camera, playbackEvent.details.finalPosition);
    const label = playbackEvent.type === "ship_destroyed" ? "destroyed" : "boundary disengage";

    return `
      <g class="resolution-playback resolution-playback--terminal">
        <circle class="resolution-playback__terminal-ring" cx="${finalPoint.x.toFixed(2)}" cy="${finalPoint.y.toFixed(2)}" r="26" />
        <text class="resolution-playback__terminal-label" x="${finalPoint.x.toFixed(2)}" y="${(finalPoint.y - 32).toFixed(2)}">${label}</text>
      </g>
    `;
  }

  return "";
}

function renderScaleBar(camera: TacticalCamera): string {
  const worldUnits = getTacticalCameraScaleBarWorldUnits(camera, TACTICAL_VIEWPORT.scaleBarTargetPx);

  if (worldUnits <= 0) {
    return "";
  }

  const pixelWidth = worldUnits / camera.world_units_per_px;
  const right = camera.drawable.max_x - 18;
  const left = right - pixelWidth;
  const baseline = camera.drawable.max_y - 16;

  return `
    <g class="tactical-scale-bar">
      <line class="tactical-scale-bar__line" x1="${left.toFixed(2)}" y1="${baseline.toFixed(2)}" x2="${right.toFixed(
        2
      )}" y2="${baseline.toFixed(2)}" />
      <line class="tactical-scale-bar__tick" x1="${left.toFixed(2)}" y1="${(baseline - 6).toFixed(2)}" x2="${left.toFixed(
        2
      )}" y2="${(baseline + 6).toFixed(2)}" />
      <line class="tactical-scale-bar__tick" x1="${right.toFixed(2)}" y1="${(baseline - 6).toFixed(2)}" x2="${right.toFixed(
        2
      )}" y2="${(baseline + 6).toFixed(2)}" />
      <text class="tactical-scale-bar__label" x="${((left + right) / 2).toFixed(2)}" y="${(baseline - 10).toFixed(2)}">
        ${formatDistance(worldUnits)}
      </text>
    </g>
  `;
}

export function renderTacticalBoard({
  sessionValue,
  identityValue,
  plotSummary,
  plotPreview,
  focusedMountId,
  camera,
  playbackEvent,
  getContactShortLabel
}: RenderTacticalBoardArgs): string {
  const emphasizedCues = (focusedMountId === null
    ? plotPreview?.weapon_cues ?? []
    : plotPreview?.weapon_cues.filter((cue) => cue.mount_id === focusedMountId) ?? []
  ).filter((cue) => cue.target_ship_instance_id !== null);
  const armedCueByTargetShipId = new Map<ShipInstanceId, WeaponCue>();

  for (const cue of emphasizedCues) {
    if (!isArmedWeaponCue(cue) || cue.target_ship_instance_id === null) {
      continue;
    }

    armedCueByTargetShipId.set(cue.target_ship_instance_id, cue);
  }

  const targetedShipIds = new Set(armedCueByTargetShipId.keys());
  const viewpointShip = camera.viewpoint_ship_instance_id
    ? sessionValue.battle_state.ships[camera.viewpoint_ship_instance_id] ?? null
    : null;
  const visibleShips: string[] = [];
  const offscreenMarkers: string[] = [];

  for (const participant of sessionValue.battle_state.match_setup.participants) {
    const ship = sessionValue.battle_state.ships[participant.ship_instance_id];
    const shipConfig = sessionValue.battle_state.match_setup.ship_catalog[participant.ship_config_id];

    if (!ship || !shipConfig) {
      continue;
    }

    const isSelf = identityValue?.ship_instance_id === ship.ship_instance_id;
    const targetCue = armedCueByTargetShipId.get(ship.ship_instance_id) ?? null;
    const isTargeted = targetedShipIds.has(ship.ship_instance_id);
    const isTargetable = focusedMountId !== null && !isSelf;
    const playbackTone = getShipPlaybackTone(playbackEvent, ship.ship_instance_id);
    const visible = isWorldPointVisibleInTacticalCamera(camera, ship.pose.position, 34);
    const label = getTacticalShipLabel(identityValue, ship, shipConfig);

    if (visible) {
      visibleShips.push(
        renderShipGlyph(
          sessionValue,
          identityValue,
          camera,
          ship,
          shipConfig,
          targetCue,
          isTargeted,
          isTargetable,
          playbackTone
        )
      );
    } else {
      offscreenMarkers.push(
        renderOffscreenMarker(
          camera,
          viewpointShip,
          ship,
          label,
          targetCue,
          isTargeted,
          isTargetable,
          isSelf,
          playbackTone
        )
      );
    }
  }

  const overlay = renderPlotPreviewOverlay(sessionValue, camera, plotPreview, focusedMountId, getContactShortLabel);
  const interactionHandles = renderPlotInteractionHandles(sessionValue, camera, plotSummary, plotPreview);
  const playbackOverlay = renderResolutionPlaybackOverlay(camera, playbackEvent);

  return `
    <div class="tactical-board">
      <svg
        viewBox="0 0 ${TACTICAL_VIEWPORT.width} ${TACTICAL_VIEWPORT.height}"
        aria-label="Tactical viewport"
        data-tactical-viewport
      >
        <defs>
          <clipPath id="tactical-plot-clip">
            <rect
              x="${camera.drawable.min_x}"
              y="${camera.drawable.min_y}"
              width="${camera.drawable.width}"
              height="${camera.drawable.height}"
              rx="18"
            />
          </clipPath>
        </defs>
        <rect
          class="tactical-board__frame"
          x="${TACTICAL_VIEWPORT.padding}"
          y="${TACTICAL_VIEWPORT.padding}"
          width="${TACTICAL_VIEWPORT.width - TACTICAL_VIEWPORT.padding * 2}"
          height="${TACTICAL_VIEWPORT.height - TACTICAL_VIEWPORT.padding * 2}"
          rx="18"
        />
        ${renderGuideLines()}
        <line
          class="tactical-board__axis"
          x1="${TACTICAL_VIEWPORT.width / 2}"
          y1="${TACTICAL_VIEWPORT.padding}"
          x2="${TACTICAL_VIEWPORT.width / 2}"
          y2="${TACTICAL_VIEWPORT.height - TACTICAL_VIEWPORT.padding}"
        />
        <line
          class="tactical-board__axis"
          x1="${TACTICAL_VIEWPORT.padding}"
          y1="${TACTICAL_VIEWPORT.height / 2}"
          x2="${TACTICAL_VIEWPORT.width - TACTICAL_VIEWPORT.padding}"
          y2="${TACTICAL_VIEWPORT.height / 2}"
        />
        <g clip-path="url(#tactical-plot-clip)">
          ${overlay}
          ${visibleShips.join("")}
          ${playbackOverlay}
          ${interactionHandles}
        </g>
        ${offscreenMarkers.join("")}
        ${renderScaleBar(camera)}
      </svg>
    </div>
  `;
}

function getShipPlaybackTone(
  playbackEvent: ResolverEvent | null,
  shipInstanceId: ShipInstanceId
): "hit" | "destroyed" | "disengaged" | null {
  if (!playbackEvent) {
    return null;
  }

  if (playbackEvent.type === "ship_destroyed" && playbackEvent.target === shipInstanceId) {
    return "destroyed";
  }

  if (playbackEvent.type === "ship_disengaged" && playbackEvent.target === shipInstanceId) {
    return "disengaged";
  }

  if (playbackEvent.type === "hit_registered" && playbackEvent.target === shipInstanceId) {
    return "hit";
  }

  return null;
}
