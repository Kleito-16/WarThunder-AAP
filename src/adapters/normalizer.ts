import { createBounds, createOrientation, playerHeadingDeg, toFiniteNumber, toFinitePair } from "../domain/geometry.ts";
import type {
  MapCalibration,
  MapImageDescriptor,
  MapMetadata,
  PlayerState,
  WTIndicatorsRaw,
  WTMapInfoRaw,
  WTMapObjectsRaw,
} from "../domain/types.ts";
import { createHash } from "node:crypto";

function stableGeometryId(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

export function normalizeMap(input: {
  raw?: WTMapInfoRaw;
  calibration?: MapCalibration;
  calibrationLookupKey?: string;
  image?: MapImageDescriptor;
  imageRevision?: number;
  observedAt?: string;
}): MapMetadata | undefined {
  if (!input.raw) return undefined;
  const min = toFinitePair(input.raw.map_min) ?? [0, 0];
  const max = toFinitePair(input.raw.map_max) ?? toFinitePair(input.raw.grid_size) ?? [1, 1];
  const bounds = createBounds(min, max, input.calibration);
  if (!bounds) return undefined;
  const orientation = createOrientation(input.calibration);
  const coordinateGeometryId = stableGeometryId({ min, max, calibration: input.calibration?.id, matrix: input.calibration?.orientationMatrix });
  const map: MapMetadata = {
    valid: input.raw.valid !== false,
    imageRevision: input.imageRevision ?? 0,
    coordinateGeometryId,
    bounds,
    orientation,
    observedAt: input.observedAt ?? new Date().toISOString(),
  };
  const hudType = toFiniteNumber(input.raw.hud_type);
  const gridSteps = toFinitePair(input.raw.grid_steps);
  const gridZero = toFinitePair(input.raw.grid_zero);
  if (hudType !== undefined) map.hudType = hudType;
  if (gridSteps) map.gridStepsWorldUnits = gridSteps;
  if (gridZero) map.gridZeroWorldUnits = gridZero;
  if (input.calibrationLookupKey) map.calibrationLookupKey = input.calibrationLookupKey;
  if (input.image) map.image = input.image;
  return map;
}

export function normalizePlayer(objects?: WTMapObjectsRaw, observedAt = new Date().toISOString()): PlayerState | undefined {
  const raw = objects?.find((object) => object.icon?.toLowerCase() === "player" || object.type?.toLowerCase() === "player");
  const u = toFiniteNumber(raw?.x);
  const v = toFiniteNumber(raw?.y);
  if (u === undefined || v === undefined) return undefined;
  const dx = toFiniteNumber(raw?.dx);
  const dy = toFiniteNumber(raw?.dy);
  const direction = dx !== undefined && dy !== undefined ? { dx, dy } : undefined;
  const headingDeg = playerHeadingDeg(direction);
  const player: PlayerState = {
    position: { u, v },
    headingFrameStatus: headingDeg === undefined ? "unavailable" : "calibrated",
    observedAt,
  };
  if (direction) player.direction = direction;
  if (headingDeg !== undefined) player.headingDeg = headingDeg;
  return player;
}

export function normalizeVehicleType(indicators?: WTIndicatorsRaw): string | undefined {
  return typeof indicators?.type === "string" && indicators.type.trim() ? indicators.type.trim() : undefined;
}
