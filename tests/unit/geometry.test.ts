import test from "node:test";
import assert from "node:assert/strict";
import { calculateFiringSolution, computeImageRect, createBounds, createOrientation, mapAzimuthDeg, wrap180, wrap360 } from "../../src/domain/geometry.ts";
import type { MapCalibration, MapMetadata, TargetPoint } from "../../src/domain/types.ts";

const calibration: MapCalibration = { id: "test", worldUnitsPerMetre: 1, orientationMatrix: [1, 0, 0, -1], source: "test" };
const bounds = createBounds([0, 0], [2000, 1000], calibration)!;
const orientation = createOrientation(calibration);
assert.equal(orientation.status, "calibrated");

test("azimutes cardinais respeitam eixo Y invertido da imagem", () => {
  if (orientation.status !== "calibrated") throw new Error("calibração inválida");
  const origin = { u: .5, v: .5 };
  assert.equal(mapAzimuthDeg(origin, { u: .5, v: .25 }, bounds, orientation), 0);
  assert.equal(mapAzimuthDeg(origin, { u: .75, v: .5 }, bounds, orientation), 90);
  assert.equal(mapAzimuthDeg(origin, { u: .5, v: .75 }, bounds, orientation), 180);
  assert.equal(mapAzimuthDeg(origin, { u: .25, v: .5 }, bounds, orientation), 270);
});

test("distância usa spans independentes em mapa retangular", () => {
  const map: MapMetadata = { valid: true, imageRevision: 1, coordinateGeometryId: "g", bounds, orientation, observedAt: new Date().toISOString() };
  const target: TargetPoint = { id: "t", trackNumber: 1, label: "T", position: { u: .75, v: .5 }, sortOrder: 0, status: "active", matchEpoch: "m", coordinateGeometryId: "g", createdAt: "x", updatedAt: "x" };
  const solution = calculateFiringSolution({ target, map, player: { position: { u: .5, v: .5 }, headingFrameStatus: "unavailable", observedAt: "x" }, sequence: 1 });
  assert.equal(solution.status, "available");
  if (solution.status === "available") assert.deepEqual(solution.distance, { value: 500, unit: "m", scaleStatus: "calibrated" });
});

test("pontos coincidentes não produzem azimute enganoso", () => {
  const map: MapMetadata = { valid: true, imageRevision: 1, coordinateGeometryId: "g", bounds, orientation, observedAt: "x" };
  const target: TargetPoint = { id: "t", trackNumber: 1, label: "T", position: { u: .5, v: .5 }, sortOrder: 0, status: "active", matchEpoch: "m", coordinateGeometryId: "g", createdAt: "x", updatedAt: "x" };
  const result = calculateFiringSolution({ target, map, player: { position: { u: .5, v: .5 }, headingFrameStatus: "unavailable", observedAt: "x" }, sequence: 1 });
  assert.equal(result.status, "unavailable"); if (result.status === "unavailable") assert.equal(result.reason, "COINCIDENT_POINTS");
});

test("normalização angular e letterbox", () => {
  assert.equal(wrap360(-90), 270); assert.equal(wrap180(270), -90);
  assert.deepEqual(computeImageRect(1000, 500, 1000, 1000), { offsetX: 250, offsetY: 0, drawWidth: 500, drawHeight: 500, scale: .5 });
});
