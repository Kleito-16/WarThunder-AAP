import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { normalizeMap, normalizePlayer, normalizeVehicleType } from "../adapters/normalizer.ts";
import { calculateFiringSolution } from "../domain/geometry.ts";
import type {
  AmmoSelection,
  CatalogBundle,
  MapCalibration,
  MapImageDescriptor,
  SourceFreshness,
  SourceName,
  TargetPoint,
  TelemetrySnapshot,
  UpstreamSample,
  VehicleSelection,
  WTIndicatorsRaw,
  WTMapInfoRaw,
  WTMapObjectsRaw,
  WTMissionRaw,
} from "../domain/types.ts";
import { ammoForVehicle, resolveVehicle } from "./catalog.ts";

export interface TelemetrySource {
  getMapInfo(): Promise<WTMapInfoRaw>;
  getMapObjects(): Promise<WTMapObjectsRaw>;
  getIndicators(): Promise<WTIndicatorsRaw>;
  getMission(): Promise<WTMissionRaw>;
  getMapImage(): Promise<{ bytes: Uint8Array; contentType: string }>;
}

type Samples = {
  mapInfo: UpstreamSample<WTMapInfoRaw>;
  mapObjects: UpstreamSample<WTMapObjectsRaw>;
  indicators: UpstreamSample<WTIndicatorsRaw>;
  mission: UpstreamSample<WTMissionRaw>;
};

export class StateEngine extends EventEmitter {
  readonly serverInstanceId = randomUUID();
  readonly csrfToken = randomUUID();
  readonly images = new Map<string, { bytes: Uint8Array; contentType: string }>();
  private samples: Samples = { mapInfo: {}, mapObjects: {}, indicators: {}, mission: {} };
  private image?: MapImageDescriptor;
  private imageRevision = 0;
  private targets: TargetPoint[] = [];
  private sequence = 0;
  private matchEpoch = randomUUID();
  private lifeEpoch = randomUUID();
  private lastGeometryId?: string;
  private vehicleProfileId?: string;
  private vehicleAmmoProfileId?: string;
  private timers: NodeJS.Timeout[] = [];
  private started = false;
  private readonly source: TelemetrySource;
  readonly mode: "live" | "demo";
  readonly catalog: CatalogBundle;
  private readonly calibrations: Record<string, MapCalibration>;

  constructor(
    source: TelemetrySource,
    mode: "live" | "demo",
    catalog: CatalogBundle,
    calibrations: Record<string, MapCalibration>,
  ) {
    super();
    this.source = source;
    this.mode = mode;
    this.catalog = catalog;
    this.calibrations = calibrations;
    if (mode === "demo") {
      this.vehicleProfileId = "demo-artillery";
      this.vehicleAmmoProfileId = "demo-artillery-demo-he";
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await Promise.allSettled([
      this.poll("mapInfo", () => this.source.getMapInfo()),
      this.poll("mapObjects", () => this.source.getMapObjects()),
      this.poll("indicators", () => this.source.getIndicators()),
      this.poll("mission", () => this.source.getMission()),
      this.pollImage(),
    ]);
    this.timers.push(setInterval(() => void this.poll("mapObjects", () => this.source.getMapObjects()), 200));
    this.timers.push(setInterval(() => void this.poll("indicators", () => this.source.getIndicators()), 200));
    this.timers.push(setInterval(() => void this.poll("mapInfo", () => this.source.getMapInfo()), 1000));
    this.timers.push(setInterval(() => void this.poll("mission", () => this.source.getMission()), 1000));
    this.timers.push(setInterval(() => void this.pollImage(), 5000));
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    this.started = false;
  }

  private async poll<K extends keyof Samples>(name: K, load: () => Promise<NonNullable<Samples[K]["value"]>>): Promise<void> {
    const sample = this.samples[name];
    sample.lastAttemptAt = Date.now();
    try {
      sample.value = await load();
      sample.receivedAt = Date.now();
      delete sample.error;
    } catch (error) {
      sample.error = error instanceof Error ? error.message : String(error);
    }
    this.bump();
  }

  private async pollImage(): Promise<void> {
    try {
      const result = await this.source.getMapImage();
      const hash = createHash("sha256").update(result.bytes).digest("hex");
      if (!this.images.has(hash)) this.images.set(hash, result);
      if (this.image?.contentHash !== hash) this.imageRevision++;
      this.image = {
        url: `/api/v1/map/image/${hash}`,
        contentHash: hash,
        contentType: result.contentType,
        widthPx: 2000,
        heightPx: 2000,
      };
    } catch (error) {
      this.samples.mapInfo.error ??= error instanceof Error ? error.message : String(error);
    }
    this.bump();
  }

  private bump(): void {
    this.sequence++;
    const snapshot = this.getSnapshot();
    const geometryId = snapshot.map?.coordinateGeometryId;
    if (this.lastGeometryId && geometryId && this.lastGeometryId !== geometryId) this.newMatch();
    this.lastGeometryId = geometryId;
    this.emit("snapshot", this.getSnapshot());
  }

  private freshness(sample: UpstreamSample<unknown>, now: number): SourceFreshness {
    if (!sample.receivedAt) return { state: "offline", ...(sample.error ? { lastError: sample.error } : {}) };
    const ageMs = now - sample.receivedAt;
    return {
      state: ageMs < 1500 ? "live" : ageMs < 5000 ? "stale" : "offline",
      lastSuccessAt: new Date(sample.receivedAt).toISOString(),
      ageMs,
      ...(sample.error ? { lastError: sample.error } : {}),
    };
  }

  getSnapshot(): TelemetrySnapshot {
    const now = Date.now();
    const observedAt = new Date(now).toISOString();
    const calibrationKey = this.mode === "demo" ? "demo-grid-v1" : "default-live";
    const map = normalizeMap({
      raw: this.samples.mapInfo.value,
      calibration: this.calibrations[calibrationKey],
      calibrationLookupKey: calibrationKey,
      image: this.image,
      imageRevision: this.imageRevision,
      observedAt,
    });
    const player = normalizePlayer(this.samples.mapObjects.value, observedAt);
    const internalType = normalizeVehicleType(this.samples.indicators.value);
    const resolved = resolveVehicle(this.catalog, internalType);
    const selectedVehicle = this.catalog.vehicles.find((item) => item.id === this.vehicleProfileId);
    const vehicle: VehicleSelection = selectedVehicle
      ? { internalType, profileId: selectedVehicle.id, displayName: selectedVehicle.displayName, source: this.mode === "demo" ? "telemetry" : "manual", confidence: "high" }
      : resolved
        ? { internalType, profileId: resolved.id, displayName: resolved.displayName, source: "telemetry", confidence: "medium" }
        : { internalType, displayName: internalType ?? "Veículo não identificado", source: "unknown", confidence: "none" };
    const selectedPair = this.catalog.vehicleAmmunition.find((item) => item.id === this.vehicleAmmoProfileId);
    const ammoProfile = this.catalog.ammunition.find((item) => item.id === selectedPair?.ammoProfileId);
    const ammo: AmmoSelection = selectedPair && ammoProfile
      ? { vehicleAmmoProfileId: selectedPair.id, displayName: ammoProfile.displayName, source: "manual", confidence: selectedPair.confidence === "verified" ? "high" : "medium" }
      : { displayName: "Munição não selecionada", source: "unknown", confidence: "none" };
    const targets = this.targets.map((target) => ({ ...target, status: target.matchEpoch === this.matchEpoch && target.coordinateGeometryId === map?.coordinateGeometryId ? "active" as const : "stale" as const }));
    const vehicleAmmo = selectedPair;
    const solutions = targets.map((target) => calculateFiringSolution({ target, map, player, vehicleAmmo, ammo: ammoProfile, sequence: this.sequence }));
    const sourceFreshness: Partial<Record<SourceName, SourceFreshness>> = {
      mapInfo: this.freshness(this.samples.mapInfo, now),
      mapObjects: this.freshness(this.samples.mapObjects, now),
      indicators: this.freshness(this.samples.indicators, now),
      mission: this.freshness(this.samples.mission, now),
      mapImage: this.image ? { state: "live", lastSuccessAt: observedAt, ageMs: 0 } : { state: "offline" },
    };
    const ages = Object.values(sourceFreshness).map((item) => item?.ageMs).filter((age): age is number => age !== undefined);
    const lastSuccess = [this.samples.mapInfo.receivedAt, this.samples.mapObjects.receivedAt].filter((value): value is number => value !== undefined).sort().at(-1);
    const connected = Boolean(map && player);
    return {
      schemaVersion: "1.0",
      serverInstanceId: this.serverInstanceId,
      sequence: this.sequence,
      capturedAt: observedAt,
      mode: this.mode,
      csrfToken: this.csrfToken,
      matchEpoch: this.matchEpoch,
      lifeEpoch: this.lifeEpoch,
      ...(map ? { coordinateGeometryId: map.coordinateGeometryId, map } : {}),
      ...(player ? { player } : {}),
      connection: {
        state: connected ? (Math.max(0, ...ages) > 2000 ? "stale" : "live") : (lastSuccess ? "waiting" : "offline"),
        ...(lastSuccess ? { lastSuccessAt: new Date(lastSuccess).toISOString(), ageMs: now - lastSuccess } : {}),
        ...(!connected ? { message: this.mode === "live" ? "Aguardando partida no War Thunder (localhost:8111)" : "Inicializando demonstração" } : {}),
      },
      sourceFreshness,
      vehicle,
      ammo,
      targets,
      solutions,
    };
  }

  setSelection(input: { vehicleProfileId?: string; vehicleAmmoProfileId?: string }): void {
    if (input.vehicleProfileId !== undefined) {
      if (!this.catalog.vehicles.some((item) => item.id === input.vehicleProfileId)) throw new Error("Veículo inválido");
      this.vehicleProfileId = input.vehicleProfileId;
      if (!this.catalog.vehicleAmmunition.some((item) => item.id === this.vehicleAmmoProfileId && item.vehicleProfileId === input.vehicleProfileId)) this.vehicleAmmoProfileId = undefined;
    }
    if (input.vehicleAmmoProfileId !== undefined) {
      const profile = this.catalog.vehicleAmmunition.find((item) => item.id === input.vehicleAmmoProfileId);
      if (!profile || (this.vehicleProfileId && profile.vehicleProfileId !== this.vehicleProfileId)) throw new Error("Munição incompatível");
      this.vehicleAmmoProfileId = input.vehicleAmmoProfileId;
      this.vehicleProfileId ??= profile.vehicleProfileId;
    }
    this.bump();
  }

  createTarget(input: { u: number; v: number; label?: string }): TargetPoint {
    const map = this.getSnapshot().map;
    if (!map?.valid) throw new Error("Mapa indisponível");
    if (![input.u, input.v].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error("Coordenadas devem estar entre 0 e 1");
    const now = new Date().toISOString();
    const target: TargetPoint = {
      id: randomUUID(), trackNumber: (Math.max(0, ...this.targets.map((item) => item.trackNumber)) + 1),
      label: input.label?.trim().slice(0, 40) || `ALVO ${this.targets.length + 1}`,
      position: { u: input.u, v: input.v }, sortOrder: this.targets.length,
      status: "active", matchEpoch: this.matchEpoch, coordinateGeometryId: map.coordinateGeometryId,
      createdAt: now, updatedAt: now,
    };
    this.targets.push(target); this.bump(); return target;
  }

  updateTarget(id: string, input: { u?: number; v?: number; label?: string; sortOrder?: number }): TargetPoint {
    const target = this.targets.find((item) => item.id === id);
    if (!target) throw new Error("Alvo não encontrado");
    const u = input.u ?? target.position.u; const v = input.v ?? target.position.v;
    if (![u, v].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error("Coordenadas inválidas");
    target.position = { u, v };
    if (input.label !== undefined) target.label = input.label.trim().slice(0, 40) || target.label;
    if (input.sortOrder !== undefined && Number.isFinite(input.sortOrder)) target.sortOrder = input.sortOrder;
    target.updatedAt = new Date().toISOString(); this.targets.sort((a, b) => a.sortOrder - b.sortOrder); this.bump(); return target;
  }

  deleteTarget(id: string): boolean {
    const before = this.targets.length; this.targets = this.targets.filter((item) => item.id !== id); this.bump(); return this.targets.length < before;
  }
  clearTargets(): void { this.targets = []; this.bump(); }
  newMatch(): void { this.matchEpoch = randomUUID(); this.lifeEpoch = randomUUID(); this.targets = this.targets.map((item) => ({ ...item, status: "stale" })); this.sequence++; }
  getAmmoForVehicle(vehicleId?: string) { return ammoForVehicle(this.catalog, vehicleId); }
}
