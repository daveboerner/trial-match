import { GeoPoint, GeocodeError } from '../types/trial';

/**
 * Geocodes a US zip code to a lat/lng using zippopotam.us — free, no API
 * key, no rate-limit auth. Swap this out for Census Geocoder / Google /
 * your org's preferred provider by changing only this function; callers
 * only depend on the GeoPoint shape.
 *
 * IMPORTANT: cache key is the zip code, never the patientId. This function
 * must never be called with (or log) anything more specific than a zip —
 * that's what keeps this service PHI-free.
 */
const geocodeCache = new Map<string, GeoPoint>();

export async function geocodeZip(zip: string): Promise<GeoPoint> {
  const key = normalizeZip(zip);

  const cached = geocodeCache.get(key);
  if (cached) return cached;

  const res = await fetch(`https://api.zippopotam.us/us/${encodeURIComponent(key)}`);
  if (!res.ok) {
    throw new GeocodeError(`Could not geocode zip "${key}" (status ${res.status})`);
  }

  const data = (await res.json()) as {
    places?: Array<{ latitude: string; longitude: string; 'place name'?: string; 'state abbreviation'?: string }>;
  };
  const place = data.places?.[0];
  if (!place) {
    throw new GeocodeError(`No location data returned for zip "${key}"`);
  }

  const point: GeoPoint = {
    lat: parseFloat(place.latitude),
    lng: parseFloat(place.longitude),
    city: place['place name'],
    state: place['state abbreviation'],
  };

  if (Number.isNaN(point.lat) || Number.isNaN(point.lng)) {
    throw new GeocodeError(`Malformed geocode response for zip "${key}"`);
  }

  geocodeCache.set(key, point);
  return point;
}

function normalizeZip(zip: string): string {
  // Accept "33140" or "33140-1234"; ClinicalTrials.gov searches want the
  // 5-digit base.
  const match = zip.trim().match(/^\d{5}/);
  if (!match) throw new GeocodeError(`Invalid zip code format: "${zip}"`);
  return match[0];
}

/** Exposed for tests only. */
export function __clearGeocodeCacheForTests() {
  geocodeCache.clear();
}
