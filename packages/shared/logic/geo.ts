/**
 * Distance maths for live job tracking. All coordinates are WGS-84 decimal degrees,
 * distances are metres and speeds are km/h. Kept dependency-free so the same
 * functions run on the API (calculation of record) and in the browser.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance in metres between two points (haversine). */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Adds a ping to a trail, ignoring GPS jitter. A point is dropped when it is closer
 * than `minMoveM` to the previous one (stationary drift) and clamped when the implied
 * speed exceeds `maxSpeedKph` (a teleport caused by a bad fix on a new device).
 */
export function appendTrailPoint(
  trail: GeoPoint[],
  point: GeoPoint,
  options: { minMoveM?: number; maxSpeedKph?: number; sinceMs?: number } = {}
): GeoPoint[] {
  const previous = trail[trail.length - 1];
  if (!previous) return [point];
  const moved = distanceMeters(previous, point);
  if (moved < (options.minMoveM ?? 10)) return trail;
  const hours = (options.sinceMs ?? 60_000) / 3_600_000;
  if (hours > 0 && moved / 1000 / hours > (options.maxSpeedKph ?? 160))
    return trail;
  return [...trail, point];
}

/** Total metres walked/driven along a trail. */
export function trailDistanceMeters(trail: GeoPoint[]): number {
  let total = 0;
  for (let index = 1; index < trail.length; index += 1)
    total += distanceMeters(trail[index - 1]!, trail[index]!);
  return total;
}

/** Metres → kilometres rounded to one decimal (the unit used on records). */
export const toKilometres = (metres: number): number =>
  Math.round(metres / 100) / 10;

export const MAX_ACCURACY_M = 200;
