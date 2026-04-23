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
  BattleState,
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
import {
  getContactTelemetry,
  getWeaponCueEngagementLabel,
  getWeaponCueEngagementPriority,
  getWeaponCueEngagementState,
  type ContactTelemetry
} from "./combat_readability.js";
import type { ResolutionPlaybackStep } from "./resolution_playback.js";

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
  battleStateValue: BattleState;
  identityValue: SessionIdentity | null;
  plotSummary: PlotDraftSummary | null;
  plotPreview: PlotPreview | null;
  focusedMountId: SystemId | null;
  camera: TacticalCamera;
  playbackStep: ResolutionPlaybackStep | null;
  playbackEvent: ResolverEvent | null;
};

function normalizeDegrees(angle: number): number {
  const normalized = angle % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function getShortestSignedAngleDelta(fromDegrees: number, toDegrees: number): number {
  const delta = (toDegrees - fromDegrees + 540) % 360 - 180;

  return delta === -180 ? 180 : delta;
}

function formatDistance(value: number): string {
  return `${Math.round(value)} km`;
}

function formatHeading(headingDegrees: number): string {
  return `${normalizeDegrees(headingDegrees).toFixed(0).padStart(3, "0")}°`;
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

function interpolatePoint(start: Vector2, end: Vector2, ratio: number): Vector2 {
  return {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio
  };
}

function renderTargetLock(center: Vector2): string {
  const chevron = `<path class="ship-glyph__target-lock-chevron" d="M-7 -26 L0 -18 L7 -26" />`;

  return `
    <g class="ship-glyph__target-lock" transform="translate(${center.x.toFixed(2)} ${center.y.toFixed(2)})">
      <circle class="ship-glyph__target-lock-ring" cx="0" cy="0" r="18" />
      <g class="ship-glyph__target-lock-rotor">
        <animateTransform attributeName="transform" attributeType="XML" type="rotate" from="0" to="360" dur="6s" repeatCount="indefinite" />
        ${chevron}
        <g transform="rotate(90)">${chevron}</g>
        <g transform="rotate(180)">${chevron}</g>
        <g transform="rotate(270)">${chevron}</g>
      </g>
    </g>
  `;
}

function getTacticalShipLabel(
  identityValue: SessionIdentity | null,
  ship: ShipRuntimeState,
  shipConfig: ShipConfig
): string {
  if (identityValue?.role === "player") {
    return identityValue.ship_instance_id === ship.ship_instance_id ? "" : "CONTACT";
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
  contactTelemetry: string | null,
  isTargetable: boolean,
  playbackTone: "hit" | "destroyed" | "disengaged" | null
): string {
  const center = worldToTacticalViewport(camera, ship.pose.position);
  const hullPoints = getShipHullPoints(shipConfig, center);
  const displayHeadingDegrees = getHeadingDegreesInTacticalCamera(camera, ship.pose.heading_degrees);
  const headingVector = getHeadingVector(displayHeadingDegrees, TACTICAL_VIEWPORT.headingVectorLengthPx);
  const isSelf = identityValue?.ship_instance_id === ship.ship_instance_id;
  const oneTurnDriftSeconds = sessionValue.battle_state.match_setup.rules.turn.duration_seconds;
  const velocityProjection = worldToTacticalViewport(camera, {
    x: ship.pose.position.x + ship.pose.velocity.x * oneTurnDriftSeconds,
    y: ship.pose.position.y + ship.pose.velocity.y * oneTurnDriftSeconds
  });
  const velocityScreenDelta = {
    x: velocityProjection.x - center.x,
    y: velocityProjection.y - center.y
  };
  const velocityScreenDistance = Math.hypot(velocityScreenDelta.x, velocityScreenDelta.y);
  const hasVelocityCue = velocityScreenDistance >= 10;
  const velocityDirection = hasVelocityCue
    ? {
        x: velocityScreenDelta.x / velocityScreenDistance,
        y: velocityScreenDelta.y / velocityScreenDistance
      }
    : null;
  const velocityArrowBase =
    hasVelocityCue && velocityDirection
      ? {
          x: velocityProjection.x - velocityDirection.x * 10,
          y: velocityProjection.y - velocityDirection.y * 10
        }
      : null;
  const velocityArrowPerpendicular =
    hasVelocityCue && velocityDirection
      ? {
          x: -velocityDirection.y,
          y: velocityDirection.x
        }
      : null;
  const engagementState = getWeaponCueEngagementState(targetCue);
  const isTargeted = engagementState !== "none";
  const classes = [
    "ship-glyph",
    isSelf ? "ship-glyph--self" : "",
    sessionValue.pending_plot_ship_ids.includes(ship.ship_instance_id) ? "ship-glyph--pending" : "",
    isTargeted ? `ship-glyph--${engagementState}` : "",
    playbackTone === "hit" ? "ship-glyph--impact" : "",
    playbackTone === "destroyed" ? "ship-glyph--destroyed" : "",
    playbackTone === "disengaged" ? "ship-glyph--disengaged" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const targetAttribute = isTargetable ? `data-target-ship="${ship.ship_instance_id}"` : "";
  const targetTag = getWeaponCueEngagementLabel(targetCue);
  const label = getTacticalShipLabel(identityValue, ship, shipConfig);
  const showText = shouldRenderTacticalText(camera);
  const labelY = contactTelemetry ? center.y - 28 : center.y - 20;
  const metaY = center.y - 14;

  return `
    <g class="${classes}">
      <circle
        class="ship-glyph__hit ${isTargetable ? "ship-glyph__hit--targetable" : ""}"
        cx="${center.x.toFixed(2)}"
        cy="${center.y.toFixed(2)}"
        r="30"
        ${targetAttribute}
      />
      ${
        hasVelocityCue && velocityArrowBase && velocityArrowPerpendicular
          ? `
      <line
        class="ship-glyph__velocity"
        x1="${center.x.toFixed(2)}"
        y1="${center.y.toFixed(2)}"
        x2="${velocityArrowBase.x.toFixed(2)}"
        y2="${velocityArrowBase.y.toFixed(2)}"
      />
      <polygon
        class="ship-glyph__velocity-arrow"
        points="${velocityProjection.x.toFixed(2)},${velocityProjection.y.toFixed(2)} ${(
            velocityArrowBase.x + velocityArrowPerpendicular.x * 4.5
          ).toFixed(2)},${(velocityArrowBase.y + velocityArrowPerpendicular.y * 4.5).toFixed(2)} ${(
            velocityArrowBase.x - velocityArrowPerpendicular.x * 4.5
          ).toFixed(2)},${(velocityArrowBase.y - velocityArrowPerpendicular.y * 4.5).toFixed(2)}"
      />
      `
          : ""
      }
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
      <circle
        class="ship-glyph__core"
        cx="${center.x.toFixed(2)}"
        cy="${center.y.toFixed(2)}"
        r="4"
        data-ship-core="${ship.ship_instance_id}"
      />
      ${
        isTargeted
          ? renderTargetLock(center)
          : ""
      }
      ${showText && label ? `<text class="ship-glyph__label" x="${center.x.toFixed(2)}" y="${labelY.toFixed(2)}">${label}</text>` : ""}
      ${
        showText && label && contactTelemetry
          ? `<text class="ship-glyph__meta" x="${center.x.toFixed(2)}" y="${metaY.toFixed(2)}">${contactTelemetry}</text>`
          : ""
      }
      ${
        targetTag && showText
          ? `<text class="ship-glyph__target-tag" x="${center.x.toFixed(2)}" y="${(center.y + 32).toFixed(2)}">${targetTag}</text>`
          : ""
      }
      ${
        showText && isSelf && hasVelocityCue && velocityDirection
          ? `<text class="ship-glyph__velocity-label" x="${(velocityProjection.x + velocityDirection.x * 22).toFixed(2)}" y="${(velocityProjection.y + velocityDirection.y * 22 - 4).toFixed(2)}">DRIFT</text>`
          : ""
      }
    </g>
  `;
}

function renderPreviewPath(camera: TacticalCamera, plotPreview: PlotPreview): string {
  const projectedPoints = plotPreview.projected_path.map((sample) => worldToTacticalViewport(camera, sample.position));
  const points = projectedPoints.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");

  if (!points) {
    return "";
  }

  const firstPoint = projectedPoints[0] ?? null;
  const lastPoint = projectedPoints.at(-1) ?? null;
  const hasPathTravel = Boolean(
    firstPoint &&
      lastPoint &&
      Math.hypot(lastPoint.x - firstPoint.x, lastPoint.y - firstPoint.y) >= 10
  );

  return `
    <g class="plot-preview__path-layer">
      <polyline class="plot-preview__path" points="${points}" />
      ${
        hasPathTravel && lastPoint
          ? `
      <circle class="plot-preview__path-end-ring" cx="${lastPoint.x.toFixed(2)}" cy="${lastPoint.y.toFixed(2)}" r="12" />
      <circle class="plot-preview__path-end-core" cx="${lastPoint.x.toFixed(2)}" cy="${lastPoint.y.toFixed(2)}" r="4" />
      `
          : ""
      }
    </g>
  `;
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
  const hasProjectedChange =
    Math.hypot(
      plotPreview.projected_pose.position.x - ship.pose.position.x,
      plotPreview.projected_pose.position.y - ship.pose.position.y
    ) >= 0.01 || Math.abs(getShortestSignedAngleDelta(ship.pose.heading_degrees, plotPreview.projected_pose.heading_degrees)) >= 0.1;
  const labelY = center.y - 30;
  const labelX = center.x - 14;

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
        shouldRenderTacticalText(camera) && hasProjectedChange
          ? `<text class="plot-preview__ghost-label" x="${labelX.toFixed(2)}" y="${labelY.toFixed(2)}" text-anchor="end">PROJECTED · ${formatHeading(plotPreview.projected_pose.heading_degrees)}</text>`
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
  const headingDirection = {
    x: headingVector.x / TACTICAL_PLOT_HANDLES.headingRadiusPx,
    y: headingVector.y / TACTICAL_PLOT_HANDLES.headingRadiusPx
  };
  const thrustPerpendicular = {
    x: -thrustDirection.y,
    y: thrustDirection.x
  };
  const headingPerpendicular = {
    x: -headingDirection.y,
    y: headingDirection.x
  };
  const headingHandle = {
    x: headingAnchor.x + headingVector.x,
    y: headingAnchor.y + headingVector.y
  };
  const showLabels = shouldRenderTacticalText(camera);
  const thrustLabelDistance = Math.max(24, thrustMagnitude * TACTICAL_PLOT_HANDLES.thrustRadiusPx * 0.6);
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
        ${
          showLabels
            ? `<text class="plot-handles__label plot-handles__label--thrust" x="${(shipAnchor.x + thrustDirection.x * thrustLabelDistance + thrustPerpendicular.x * 12).toFixed(2)}" y="${(shipAnchor.y + thrustDirection.y * thrustLabelDistance + thrustPerpendicular.y * 12 - 4).toFixed(2)}">BURN</text>`
            : ""
        }
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
        ${
          showLabels
            ? `<text class="plot-handles__label plot-handles__label--heading" x="${(headingHandle.x + headingDirection.x * 18 - headingPerpendicular.x * 10).toFixed(2)}" y="${(headingHandle.y + headingDirection.y * 18 - headingPerpendicular.y * 10 - 4).toFixed(2)}">HEADING</text>`
            : ""
        }
      </g>
    </g>
  `;
}

function renderWeaponCue(
  camera: TacticalCamera,
  plotPreview: PlotPreview,
  focusedMountId: SystemId | null,
  _showLabels: boolean
): string {
  return plotPreview.weapon_cues
    .map((cue) => {
      const polygonPoints = getArcPolygonPoints(cue, 12)
        .map((point) => {
          const projected = worldToTacticalViewport(camera, point);
          return `${projected.x.toFixed(2)},${projected.y.toFixed(2)}`;
        })
        .join(" ");
      const mountPoint = worldToTacticalViewport(camera, cue.mount_position);
      const targetPoint = cue.target_position ? worldToTacticalViewport(camera, cue.target_position) : null;
      const isArmed = isArmedWeaponCue(cue);
      const isFocused = cue.mount_id === focusedMountId;
      const cueClass = !isArmed
        ? "plot-preview__cue--idle"
        : cue.target_in_arc && cue.target_in_range
          ? "plot-preview__cue--valid"
          : "plot-preview__cue--warn";

      return `
        <g class="plot-preview__cue ${cueClass}${isFocused ? " plot-preview__cue--focused" : ""}">
          <polygon class="plot-preview__arc" points="${polygonPoints}" />
          ${
            isFocused && targetPoint
              ? `
          <line
            class="plot-preview__target-line"
            x1="${mountPoint.x.toFixed(2)}"
            y1="${mountPoint.y.toFixed(2)}"
            x2="${targetPoint.x.toFixed(2)}"
            y2="${targetPoint.y.toFixed(2)}"
          />
          `
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
  focusedMountId: SystemId | null
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
      ${renderWeaponCue(camera, plotPreview, focusedMountId, shouldRenderTacticalText(camera))}
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
  contactTelemetry: ContactTelemetry | null,
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
  const rangeText = contactTelemetry?.range_label ?? (viewpointShip
    ? formatDistance(
        Math.hypot(ship.pose.position.x - viewpointShip.pose.position.x, ship.pose.position.y - viewpointShip.pose.position.y)
      )
    : formatDistance(Math.hypot(ship.pose.position.x - camera.center_world.x, ship.pose.position.y - camera.center_world.y)));
  const engagementState = getWeaponCueEngagementState(targetCue);
  const isTargeted = engagementState !== "none";
  const classes = [
    "offscreen-marker",
    isSelf ? "offscreen-marker--self" : "",
    isTargeted ? `offscreen-marker--${engagementState}` : "",
    isTargetable ? "offscreen-marker--targetable" : "",
    playbackTone === "hit" ? "offscreen-marker--impact" : "",
    playbackTone === "destroyed" ? "offscreen-marker--destroyed" : "",
    playbackTone === "disengaged" ? "offscreen-marker--disengaged" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const targetStatus = getWeaponCueEngagementLabel(targetCue);
  const labelText = label ? `${label} · ${rangeText}` : rangeText;
  const statusText = targetStatus ?? (!isSelf && contactTelemetry ? contactTelemetry.closure_label.toUpperCase() : null);

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
        ${labelText}
      </text>
      ${
        statusText
          ? `<text class="offscreen-marker__status" x="${labelX.toFixed(2)}" y="${(anchor.y + 20).toFixed(2)}" text-anchor="${labelAnchor}">${statusText}</text>`
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
    const projectilePoint = interpolatePoint(mountPoint, targetPoint, 0.58);
    const projectileBearingDegrees = (Math.atan2(targetPoint.y - mountPoint.y, targetPoint.x - mountPoint.x) * 180) / Math.PI;

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
        <g
          class="resolution-playback__projectile"
          data-resolution-projectile
          transform="translate(${projectilePoint.x.toFixed(2)} ${projectilePoint.y.toFixed(2)}) rotate(${projectileBearingDegrees.toFixed(2)})"
        >
          <line class="resolution-playback__projectile-streak" x1="-14" y1="0" x2="1" y2="0" />
          <circle class="resolution-playback__projectile-core" cx="2.5" cy="0" r="3.2" />
        </g>
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
  battleStateValue,
  identityValue,
  plotSummary,
  plotPreview,
  focusedMountId,
  camera,
  playbackStep,
  playbackEvent
}: RenderTacticalBoardArgs): string {
  const emphasizedCues = (focusedMountId === null
    ? plotPreview?.weapon_cues ?? []
    : plotPreview?.weapon_cues.filter((cue) => cue.mount_id === focusedMountId) ?? []
  ).filter((cue) => cue.target_ship_instance_id !== null);
  const selectedCueByTargetShipId = new Map<ShipInstanceId, WeaponCue>();

  for (const cue of emphasizedCues) {
    if (cue.target_ship_instance_id === null) {
      continue;
    }

    const existingCue = selectedCueByTargetShipId.get(cue.target_ship_instance_id);

    if (!existingCue || getWeaponCueEngagementPriority(cue) > getWeaponCueEngagementPriority(existingCue)) {
      selectedCueByTargetShipId.set(cue.target_ship_instance_id, cue);
    }
  }

  const viewpointShip = camera.viewpoint_ship_instance_id ? battleStateValue.ships[camera.viewpoint_ship_instance_id] ?? null : null;
  const visibleShips: string[] = [];
  const offscreenMarkers: string[] = [];

  for (const participant of battleStateValue.match_setup.participants) {
    const ship = battleStateValue.ships[participant.ship_instance_id];
    const shipConfig = battleStateValue.match_setup.ship_catalog[participant.ship_config_id];

    if (!ship || !shipConfig) {
      continue;
    }

    const isSelf = identityValue?.ship_instance_id === ship.ship_instance_id;
    const targetCue = selectedCueByTargetShipId.get(ship.ship_instance_id) ?? null;
    const isTargetable = focusedMountId !== null && !isSelf;
    const playbackTone = getShipPlaybackTone(playbackEvent, ship.ship_instance_id);
    const visible = isWorldPointVisibleInTacticalCamera(camera, ship.pose.position, 34);
    const label = getTacticalShipLabel(identityValue, ship, shipConfig);
    const contactTelemetry = getContactTelemetry(viewpointShip, ship);

    if (visible) {
      visibleShips.push(
        renderShipGlyph(
          sessionValue,
          identityValue,
          camera,
          ship,
          shipConfig,
          targetCue,
          contactTelemetry?.summary_label ?? null,
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
          contactTelemetry,
          isTargetable,
          isSelf,
          playbackTone
        )
      );
    }
  }

  const overlay = renderPlotPreviewOverlay(sessionValue, camera, plotPreview, focusedMountId);
  const interactionHandles = renderPlotInteractionHandles(sessionValue, camera, plotSummary, plotPreview);
  const playbackOverlay = renderResolutionPlaybackOverlay(camera, playbackEvent);
  const playbackClass = playbackStep ? " tactical-board--replaying" : "";

  return `
    <div class="tactical-board${focusedMountId !== null ? " tactical-board--aiming" : ""}${playbackClass}">
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
