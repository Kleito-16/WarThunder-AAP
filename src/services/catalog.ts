import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AmmoProfile, CatalogBundle, MapCalibration, VehicleAmmoProfile, VehicleProfile } from "../domain/types.ts";

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

export async function loadCatalog(root = process.cwd()): Promise<CatalogBundle> {
  const directory = path.join(root, "config");
  const [vehicles, ammunition, vehicleAmmunition] = await Promise.all([
    readJson<VehicleProfile[]>(path.join(directory, "vehicles.json")),
    readJson<AmmoProfile[]>(path.join(directory, "ammunition.json")),
    readJson<VehicleAmmoProfile[]>(path.join(directory, "vehicle-ammunition.json")),
  ]);
  return { vehicles, ammunition, vehicleAmmunition };
}

export async function loadCalibrations(root = process.cwd()): Promise<Record<string, MapCalibration>> {
  return readJson<Record<string, MapCalibration>>(path.join(root, "config", "map-calibrations.json"));
}

export function resolveVehicle(catalog: CatalogBundle, internalType?: string): VehicleProfile | undefined {
  if (!internalType) return undefined;
  const needle = internalType.toLowerCase();
  return catalog.vehicles.find((vehicle) =>
    vehicle.telemetryAliases.some((alias) => needle === alias.toLowerCase() || needle.includes(alias.toLowerCase()))
  );
}

export function ammoForVehicle(catalog: CatalogBundle, vehicleId?: string): Array<{ profile: VehicleAmmoProfile; ammo: AmmoProfile }> {
  if (!vehicleId) return [];
  return catalog.vehicleAmmunition
    .filter((profile) => profile.vehicleProfileId === vehicleId)
    .map((profile) => ({ profile, ammo: catalog.ammunition.find((ammo) => ammo.id === profile.ammoProfileId)! }))
    .filter((entry) => Boolean(entry.ammo));
}
