import type { ShipRuntimeState, Vector2 } from "../contracts.js";

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function addVectors(left: Vector2, right: Vector2): Vector2 {
  return {
    x: left.x + right.x,
    y: left.y + right.y
  };
}

export function subtractVectors(left: Vector2, right: Vector2): Vector2 {
  return {
    x: left.x - right.x,
    y: left.y - right.y
  };
}

export function scaleVector(vector: Vector2, scalar: number): Vector2 {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar
  };
}

export function magnitudeOf(vector: Vector2): number {
  return Math.hypot(vector.x, vector.y);
}

export function distanceBetween(left: Vector2, right: Vector2): number {
  return magnitudeOf(subtractVectors(left, right));
}

export function normalizeDegrees(angle: number): number {
  const normalized = angle % 360;

  return normalized < 0 ? normalized + 360 : normalized;
}

export function shortestSignedAngleDelta(fromDegrees: number, toDegrees: number): number {
  let delta = normalizeDegrees(toDegrees) - normalizeDegrees(fromDegrees);

  if (delta > 180) {
    delta -= 360;
  }

  if (delta < -180) {
    delta += 360;
  }

  return delta;
}

export function getWorldBearingDegrees(vector: Vector2): number {
  return normalizeDegrees((Math.atan2(vector.x, vector.y) * 180) / Math.PI);
}

function getForwardUnitVector(headingDegrees: number): Vector2 {
  const radians = (headingDegrees * Math.PI) / 180;

  return {
    x: Math.sin(radians),
    y: Math.cos(radians)
  };
}

function getStarboardUnitVector(headingDegrees: number): Vector2 {
  const radians = (headingDegrees * Math.PI) / 180;

  return {
    x: Math.cos(radians),
    y: -Math.sin(radians)
  };
}

export function transformHullLocalVectorToWorld(local: Vector2, headingDegrees: number): Vector2 {
  const starboard = getStarboardUnitVector(headingDegrees);
  const forward = getForwardUnitVector(headingDegrees);
  const forwardDistance = -local.y;

  return addVectors(scaleVector(starboard, local.x), scaleVector(forward, forwardDistance));
}

export function transformHullLocalPointToWorld(
  ship: Pick<ShipRuntimeState, "pose">,
  local: Vector2
): Vector2 {
  return addVectors(ship.pose.position, transformHullLocalVectorToWorld(local, ship.pose.heading_degrees));
}

export function transformWorldPointToHullLocal(
  ship: Pick<ShipRuntimeState, "pose">,
  point: Vector2
): Vector2 {
  const delta = subtractVectors(point, ship.pose.position);
  const starboard = getStarboardUnitVector(ship.pose.heading_degrees);
  const forward = getForwardUnitVector(ship.pose.heading_degrees);
  const forwardDistance = delta.x * forward.x + delta.y * forward.y;

  return {
    x: delta.x * starboard.x + delta.y * starboard.y,
    y: -forwardDistance
  };
}
