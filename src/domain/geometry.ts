import type {
  AmmoProfile,
  AvailableFiringSolution,
  EffectFootprint,
  FiringSolution,
  MapBounds,
  MapCalibration,
  MapMetadata,
  MapOrientation,
  NormalizedPoint,
  PlayerState,
  RangeStatus,
  TargetPoint,
  VehicleAmmoProfile,
} from "./types.ts";

export const EPSILON = 1e-9;

export function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function toFinitePair(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const first = toFiniteNumber(value[0]);
  const second = toFiniteNumber(value[1]);
  return first === undefined || second === undefined ? undefined : [first, second];
}

export function wrap360(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

export function wrap180(angle: number): number {
  return ((angle + 540) % 360) - 180;
}

export function createBounds(
  min: [number, number],
  max: [number, number],
  calibration?: MapCalibration,
): MapBounds | undefined {
  const spanXWorldUnits = max[0] - min[0];
  const spanYWorldUnits = max[1] - min[1];
  if (!(spanXWorldUnits > 0) || !(spanYWorldUnits > 0)) return undefined;

  const scale = calibration && calibration.worldUnitsPerMetre > 0
    ? {
        status: "calibrated" as const,
        worldUnitsPerMetre: calibration.worldUnitsPerMetre,
        spanXMetres: spanXWorldUnits / calibration.worldUnitsPerMetre,
        spanYMetres: spanYWorldUnits / calibration.worldUnitsPerMetre,
        calibrationId: calibration.id,
        source: calibration.source,
      }
    : { status: "unknown" as const };

  return {
    minX: min[0],
    minY: min[1],
    maxX: max[0],
    maxY: max[1],
    spanXWorldUnits,
    spanYWorldUnits,
    scale,
  };
}

export function createOrientation(calibration?: MapCalibration): MapOrientation {
  if (!calibration || !isOrthonormal2d(calibration.orientationMatrix)) {
    return { status: "unknown" };
  }
  return {
    status: "calibrated",
    transformId: calibration.id,
    matrix: calibration.orientationMatrix,
    source: calibration.source,
  };
}

export function isOrthonormal2d(matrix: [number, number, number, number]): boolean {
  const [a, b, c, d] = matrix;
  const row1 = a * a + b * b;
  const row2 = c * c + d * d;
  const dot = a * c + b * d;
  const determinant = a * d - b * c;
  return (
    Math.abs(row1 - 1) < 1e-6 &&
    Math.abs(row2 - 1) < 1e-6 &&
    Math.abs(dot) < 1e-6 &&
    Math.abs(Math.abs(determinant) - 1) < 1e-6
  );
}

export function rawDelta(
  from: NormalizedPoint,
  to: NormalizedPoint,
  bounds: MapBounds,
): [number, number] {
  return [
    (to.u - from.u) * bounds.spanXWorldUnits,
    (to.v - from.v) * bounds.spanYWorldUnits,
  ];
}

export function orientedDelta(
  from: NormalizedPoint,
  to: NormalizedPoint,
  bounds: MapBounds,
  orientation: Extract<MapOrientation, { status: "calibrated" }>,
): { east: number; north: number } {
  const [rawX, rawY] = rawDelta(from, to, bounds);
  const [m00, m01, m10, m11] = orientation.matrix;
  return {
    east: m00 * rawX + m01 * rawY,
    north: m10 * rawX + m11 * rawY,
  };
}

export function worldDistance(
  from: NormalizedPoint,
  to: NormalizedPoint,
  bounds: MapBounds,
): number {
  const [rawX, rawY] = rawDelta(from, to, bounds);
  return Math.hypot(rawX, rawY);
}

export function mapAzimuthDeg(
  from: NormalizedPoint,
  to: NormalizedPoint,
  bounds: MapBounds,
  orientation: Extract<MapOrientation, { status: "calibrated" }>,
): number {
  const { east, north } = orientedDelta(from, to, bounds, orientation);
  return wrap360(Math.atan2(east, north) * 180 / Math.PI);
}

export function playerHeadingDeg(direction: { dx: number; dy: number } | undefined): number | undefined {
  if (!direction || !Number.isFinite(direction.dx) || !Number.isFinite(direction.dy)) return undefined;
  if (Math.hypot(direction.dx, direction.dy) <= 1e-6) return undefined;
  return wrap360(Math.atan2(direction.dx, -direction.dy) * 180 / Math.PI);
}

export function rangeStatus(distanceM: number, profile?: VehicleAmmoProfile): RangeStatus {
  if (!profile) return "unknown";
  if (profile.minRangeM !== undefined && distanceM < profile.minRangeM) return "below-minimum";
  if (profile.maxRangeM !== undefined && distanceM > profile.maxRangeM) return "beyond-maximum";
  if (profile.minRangeM !== undefined || profile.maxRangeM !== undefined) return "within-range";
  return "unknown";
}

export function effectFootprint(
  radiusM: number | undefined,
  bounds: MapBounds,
  confidence: AmmoProfile["confidence"],
): EffectFootprint | undefined {
  if (!(radiusM !== undefined && radiusM > 0) || bounds.scale.status !== "calibrated") return undefined;
  return {
    radiusM,
    areaM2: Math.PI * radiusM * radiusM,
    radiusNormalizedX: radiusM / bounds.scale.spanXMetres,
    radiusNormalizedY: radiusM / bounds.scale.spanYMetres,
    confidence,
  };
}

export function calculateFiringSolution(input: {
  target: TargetPoint;
  map?: MapMetadata;
  player?: PlayerState;
  vehicleAmmo?: VehicleAmmoProfile;
  ammo?: AmmoProfile;
  sequence: number;
}): FiringSolution {
  const calculatedAt = new Date().toISOString();
  const base = {
    targetId: input.target.id,
    calculatedAt,
    inputSequence: input.sequence,
    limitations: ["2D_ONLY", "NO_TERRAIN", "NO_TRAJECTORY"],
  };

  if (!input.map?.valid) return { ...base, status: "unavailable", reason: "MAP_INVALID" };
  if (!input.player) return { ...base, status: "unavailable", reason: "PLAYER_UNAVAILABLE" };
  if (input.target.status === "stale") return { ...base, status: "unavailable", reason: "TARGET_STALE" };
  if (input.target.coordinateGeometryId !== input.map.coordinateGeometryId) {
    return { ...base, status: "unavailable", reason: "INVALID_COORDINATE_GEOMETRY" };
  }

  const distanceWorldUnits = worldDistance(input.player.position, input.target.position, input.map.bounds);
  if (distanceWorldUnits <= EPSILON) {
    return { ...base, status: "unavailable", reason: "COINCIDENT_POINTS" };
  }
  if (input.map.orientation.status !== "calibrated") {
    return { ...base, status: "unavailable", reason: "ORIENTATION_UNCALIBRATED" };
  }

  const azimuthMapDeg = mapAzimuthDeg(
    input.player.position,
    input.target.position,
    input.map.bounds,
    input.map.orientation,
  );
  const relativeBearingDeg = input.player.headingFrameStatus === "calibrated" && input.player.headingDeg !== undefined
    ? wrap180(azimuthMapDeg - input.player.headingDeg)
    : undefined;

  if (input.map.bounds.scale.status !== "calibrated") {
    const solution: AvailableFiringSolution = {
      ...base,
      status: "available",
      distance: { value: distanceWorldUnits, unit: "world-unit", scaleStatus: "unknown" },
      azimuthMapDeg,
      rangeStatus: "unknown",
    };
    if (relativeBearingDeg !== undefined) solution.relativeBearingDeg = relativeBearingDeg;
    return solution;
  }

  const distanceM = distanceWorldUnits / input.map.bounds.scale.worldUnitsPerMetre;
  const radiusM = input.vehicleAmmo?.effectRadiusOverrideM ?? input.ammo?.effectRadiusM;
  const effect = effectFootprint(radiusM, input.map.bounds, input.ammo?.confidence ?? "unknown");
  const solution: AvailableFiringSolution = {
    ...base,
    status: "available",
    distance: { value: distanceM, unit: "m", scaleStatus: "calibrated" },
    azimuthMapDeg,
    rangeStatus: rangeStatus(distanceM, input.vehicleAmmo),
  };
  if (relativeBearingDeg !== undefined) solution.relativeBearingDeg = relativeBearingDeg;
  if (effect) solution.effect = effect;
  return solution;
}

export interface ImageRect {
  offsetX: number;
  offsetY: number;
  drawWidth: number;
  drawHeight: number;
  scale: number;
}

export function computeImageRect(
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number,
): ImageRect {
  if ([containerWidth, containerHeight, imageWidth, imageHeight].some((value) => !(value > 0))) {
    return { offsetX: 0, offsetY: 0, drawWidth: 0, drawHeight: 0, scale: 0 };
  }
  const scale = Math.min(containerWidth / imageWidth, containerHeight / imageHeight);
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  return {
    offsetX: (containerWidth - drawWidth) / 2,
    offsetY: (containerHeight - drawHeight) / 2,
    drawWidth,
    drawHeight,
    scale,
  };
}
