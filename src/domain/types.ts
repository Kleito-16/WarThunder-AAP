export type NumericLike = number | string;
export type Pair<T> = [T, T];

export interface WTMapInfoRaw {
  valid?: boolean;
  grid_size?: Pair<NumericLike>;
  grid_steps?: Pair<NumericLike>;
  grid_zero?: Pair<NumericLike>;
  hud_type?: NumericLike;
  map_generation?: NumericLike;
  map_min?: Pair<NumericLike>;
  map_max?: Pair<NumericLike>;
  [key: string]: unknown;
}

export interface WTMapObjectRaw {
  type?: string;
  icon?: string;
  icon_bg?: string;
  color?: string;
  "color[]"?: number[];
  blink?: number;
  x?: NumericLike;
  y?: NumericLike;
  dx?: NumericLike;
  dy?: NumericLike;
  sx?: NumericLike;
  sy?: NumericLike;
  ex?: NumericLike;
  ey?: NumericLike;
  [key: string]: unknown;
}

export type WTMapObjectsRaw = WTMapObjectRaw[];

export interface WTIndicatorsRaw {
  valid?: boolean;
  army?: string;
  type?: string;
  first_stage_ammo?: NumericLike;
  ammo_counter?: NumericLike;
  [key: string]: unknown;
}

export interface WTMissionRaw {
  status?: string;
  objectives?: Array<{
    text?: string;
    status?: string;
    primary?: boolean;
  }> | null;
  [key: string]: unknown;
}

export interface NormalizedPoint {
  u: number;
  v: number;
}

export type MapScale =
  | { status: "unknown" }
  | {
      status: "calibrated";
      worldUnitsPerMetre: number;
      spanXMetres: number;
      spanYMetres: number;
      calibrationId: string;
      source: string;
    };

export type MapOrientation =
  | { status: "unknown" }
  | {
      status: "calibrated";
      transformId: string;
      matrix: [number, number, number, number];
      source: string;
    };

export interface MapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  spanXWorldUnits: number;
  spanYWorldUnits: number;
  scale: MapScale;
}

export interface MapImageDescriptor {
  url: string;
  contentHash: string;
  contentType: string;
  widthPx: number;
  heightPx: number;
}

export interface MapMetadata {
  valid: boolean;
  imageRevision: number;
  calibrationLookupKey?: string;
  coordinateGeometryId: string;
  hudType?: number;
  bounds: MapBounds;
  orientation: MapOrientation;
  gridStepsWorldUnits?: Pair<number>;
  gridZeroWorldUnits?: Pair<number>;
  image?: MapImageDescriptor;
  observedAt: string;
}

export interface PlayerState {
  position: NormalizedPoint;
  direction?: { dx: number; dy: number };
  headingDeg?: number;
  headingFrameStatus: "calibrated" | "uncalibrated" | "unavailable";
  observedAt: string;
}

export type ResolutionSource = "telemetry" | "manual" | "unknown";
export type Confidence = "high" | "medium" | "low" | "none";

export interface VehicleSelection {
  internalType?: string;
  profileId?: string;
  displayName: string;
  source: ResolutionSource;
  confidence: Confidence;
}

export interface AmmoSelection {
  vehicleAmmoProfileId?: string;
  displayName: string;
  source: ResolutionSource;
  confidence: Confidence;
  telemetryField?: string;
  conflict?: boolean;
}

export interface SourceReference {
  label: string;
  url?: string;
  verifiedAt: string;
}

export interface VehicleProfile {
  id: string;
  displayName: string;
  telemetryAliases: string[];
  vehicleAmmoProfileIds: string[];
  notes?: string;
}

export interface AmmoProfile {
  id: string;
  displayName: string;
  projectileType: "HE" | "HE-VT" | "HEAT" | "SMOKE" | "OTHER";
  effectRadiusM?: number;
  explosiveMassKgTnt?: number;
  source: SourceReference;
  confidence: "verified" | "estimated" | "unknown";
}

export interface VehicleAmmoProfile {
  id: string;
  vehicleProfileId: string;
  ammoProfileId: string;
  weaponMountId: string;
  muzzleVelocityMps?: number;
  minRangeM?: number;
  maxRangeM?: number;
  effectRadiusOverrideM?: number;
  source: SourceReference;
  confidence: "verified" | "estimated" | "unknown";
}

export type TargetStatus = "active" | "stale";

export interface TargetPoint {
  id: string;
  trackNumber: number;
  label: string;
  position: NormalizedPoint;
  sortOrder: number;
  status: TargetStatus;
  matchEpoch: string;
  coordinateGeometryId: string;
  createdAt: string;
  updatedAt: string;
}

export type RangeStatus =
  | "within-range"
  | "below-minimum"
  | "beyond-maximum"
  | "unknown";

export interface EffectFootprint {
  radiusM: number;
  areaM2: number;
  radiusNormalizedX: number;
  radiusNormalizedY: number;
  confidence: AmmoProfile["confidence"];
}

export type DistanceValue =
  | { value: number; unit: "m"; scaleStatus: "calibrated" }
  | { value: number; unit: "world-unit"; scaleStatus: "unknown" };

export interface FiringSolutionBase {
  targetId: string;
  calculatedAt: string;
  inputSequence: number;
  limitations: string[];
}

export type AvailableFiringSolution = FiringSolutionBase & {
  status: "available";
  azimuthMapDeg: number;
  relativeBearingDeg?: number;
} & (
    | {
        distance: Extract<DistanceValue, { unit: "m" }>;
        rangeStatus: RangeStatus;
        effect?: EffectFootprint;
      }
    | {
        distance: Extract<DistanceValue, { unit: "world-unit" }>;
        rangeStatus: "unknown";
        effect?: never;
      }
  );

export type SolutionUnavailableReason =
  | "MAP_INVALID"
  | "PLAYER_UNAVAILABLE"
  | "TARGET_STALE"
  | "COINCIDENT_POINTS"
  | "ORIENTATION_UNCALIBRATED"
  | "INVALID_COORDINATE_GEOMETRY";

export interface UnavailableFiringSolution extends FiringSolutionBase {
  status: "unavailable";
  reason: SolutionUnavailableReason;
}

export type FiringSolution = AvailableFiringSolution | UnavailableFiringSolution;

export type ConnectionState = "connecting" | "waiting" | "live" | "stale" | "offline";
export type SourceName = "mapObjects" | "mapInfo" | "mapImage" | "indicators" | "mission";

export interface SourceFreshness {
  lastSuccessAt?: string;
  ageMs?: number;
  state: "live" | "stale" | "offline";
  lastError?: string;
}

export interface TelemetrySnapshot {
  schemaVersion: "1.0";
  serverInstanceId: string;
  sequence: number;
  capturedAt: string;
  mode: "live" | "demo";
  csrfToken: string;
  matchEpoch: string;
  lifeEpoch: string;
  coordinateGeometryId?: string;
  connection: {
    state: ConnectionState;
    lastSuccessAt?: string;
    ageMs?: number;
    message?: string;
  };
  sourceFreshness: Partial<Record<SourceName, SourceFreshness>>;
  map?: MapMetadata;
  player?: PlayerState;
  vehicle: VehicleSelection;
  ammo: AmmoSelection;
  targets: TargetPoint[];
  solutions: FiringSolution[];
}

export interface CatalogBundle {
  vehicles: VehicleProfile[];
  ammunition: AmmoProfile[];
  vehicleAmmunition: VehicleAmmoProfile[];
}

export interface MapCalibration {
  id: string;
  worldUnitsPerMetre: number;
  orientationMatrix: [number, number, number, number];
  source: string;
}

export interface UpstreamSample<T> {
  value?: T;
  receivedAt?: number;
  lastAttemptAt?: number;
  error?: string;
}
