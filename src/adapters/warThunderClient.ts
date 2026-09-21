import type { WTIndicatorsRaw, WTMapInfoRaw, WTMapObjectsRaw, WTMissionRaw } from "../domain/types.ts";

export class WarThunderClient {
  private readonly baseUrl: string;
  constructor(baseUrl = "http://127.0.0.1:8111") { this.baseUrl = baseUrl; }

  private async request<T>(pathname: string, timeoutMs = 500): Promise<T> {
    const response = await fetch(new URL(pathname, this.baseUrl), { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`${pathname}: HTTP ${response.status}`);
    return await response.json() as T;
  }

  getMapInfo(): Promise<WTMapInfoRaw> { return this.request("/map_info.json"); }
  getMapObjects(): Promise<WTMapObjectsRaw> { return this.request("/map_obj.json"); }
  getIndicators(): Promise<WTIndicatorsRaw> { return this.request("/indicators"); }
  getMission(): Promise<WTMissionRaw> { return this.request("/mission.json"); }

  async getMapImage(): Promise<{ bytes: Uint8Array; contentType: string }> {
    const response = await fetch(new URL("/map.img", this.baseUrl), { signal: AbortSignal.timeout(2000) });
    if (!response.ok) throw new Error(`/map.img: HTTP ${response.status}`);
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type")?.split(";")[0] ?? "image/png",
    };
  }
}
