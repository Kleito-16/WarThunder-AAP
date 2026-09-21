import type { WTIndicatorsRaw, WTMapInfoRaw, WTMapObjectsRaw, WTMissionRaw } from "../domain/types.ts";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000" viewBox="0 0 2000 2000"><defs><pattern id="s" width="100" height="100" patternUnits="userSpaceOnUse"><path d="M100 0H0V100" fill="none" stroke="#52635e" stroke-width="2"/></pattern><pattern id="b" width="500" height="500" patternUnits="userSpaceOnUse"><rect width="500" height="500" fill="url(#s)"/><path d="M500 0H0V500" fill="none" stroke="#81938b" stroke-width="5"/></pattern></defs><rect width="2000" height="2000" fill="#24332f"/><rect width="2000" height="2000" fill="url(#b)"/><path d="M0 1450 Q450 1150 850 1370 T2000 1180" fill="none" stroke="#44726f" stroke-width="65" opacity=".8"/><path d="M180 250 Q700 500 1060 260 T1880 420" fill="none" stroke="#8b7655" stroke-width="35" opacity=".55"/><g fill="#536b55" opacity=".8"><circle cx="450" cy="760" r="190"/><circle cx="1550" cy="920" r="240"/><circle cx="1180" cy="1620" r="180"/></g><g fill="#d3ded7" font-family="monospace" font-size="36" opacity=".75"><text x="25" y="55">A1</text><text x="525" y="55">B1</text><text x="1025" y="55">C1</text><text x="1525" y="55">D1</text></g></svg>`;

export class DemoSource {
  private startedAt = Date.now();
  getMapInfo(): Promise<WTMapInfoRaw> {
    return Promise.resolve({ valid: true, map_min: [0, 0], map_max: [2000, 2000], grid_steps: [500, 500], grid_zero: [0, 0], hud_type: 1, map_generation: 1 });
  }
  getMapObjects(): Promise<WTMapObjectsRaw> {
    const t = (Date.now() - this.startedAt) / 1000;
    const x = 0.27 + Math.sin(t / 16) * 0.035;
    const y = 0.70 + Math.cos(t / 18) * 0.025;
    const dx = Math.cos(t / 16);
    const dy = -Math.sin(t / 18);
    return Promise.resolve([{ icon: "Player", type: "Player", x, y, dx, dy }]);
  }
  getIndicators(): Promise<WTIndicatorsRaw> { return Promise.resolve({ valid: true, type: "demo_artillery" }); }
  getMission(): Promise<WTMissionRaw> { return Promise.resolve({ status: "running", objectives: [] }); }
  getMapImage(): Promise<{ bytes: Uint8Array; contentType: string }> {
    return Promise.resolve({ bytes: new TextEncoder().encode(SVG), contentType: "image/svg+xml" });
  }
}
