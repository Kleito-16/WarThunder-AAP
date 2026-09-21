import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMap, normalizePlayer } from "../../src/adapters/normalizer.ts";

test("normaliza números serializados como texto", () => {
  const map = normalizeMap({ raw: { valid: true, map_min: ["0", "0"], map_max: ["2000", "1000"] } });
  assert.equal(map?.bounds.spanXWorldUnits, 2000); assert.equal(map?.bounds.spanYWorldUnits, 1000);
});

test("encontra o jogador e rejeita direção nula", () => {
  const player = normalizePlayer([{ icon: "Player", x: "0.25", y: .75, dx: 0, dy: 0 }], "now");
  assert.deepEqual(player?.position, { u: .25, v: .75 }); assert.equal(player?.headingDeg, undefined); assert.equal(player?.headingFrameStatus, "unavailable");
});
