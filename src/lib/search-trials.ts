import { geocodeZip } from './geocode';
import { fetchStudies } from './ctgov-client';
import { normalizeStudy } from './normalize';
import { TtlCache } from './cache';
import type { TrialSearchRequest, TrialSearchResponse } from '../types/trial';

const FOUR_HOURS_MS = 1000 * 60 * 60 * 4;
const cache = new TtlCache<TrialSearchResponse>(FOUR_HOURS_MS);

export class ValidationError extends Error {}

export async function searchTrials(req: TrialSearchRequest): Promise<TrialSearchResponse> {
  validate(req);

  const condition = req.conditions[0];
  const statuses = req.status ?? ['RECRUITING'];
  const cacheKey = JSON.stringify({
    condition,
    zip: req.zip,
    radiusMiles: req.radiusMiles,
    statuses,
  });

  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const origin = await geocodeZip(req.zip);

  const raw = await fetchStudies({
    condition,
    lat: origin.lat,
    lng: origin.lng,
    radiusMiles: req.radiusMiles,
    statuses,
    pageSize: req.pageSize,
  });

  const trials = (raw.studies ?? []).map((study) => normalizeStudy(study, origin, condition));

  const response: TrialSearchResponse = {
    query: {
      condition,
      radiusMiles: req.radiusMiles,
      origin: { lat: origin.lat, lng: origin.lng },
    },
    totalCount: raw.totalCount ?? trials.length,
    trials,
  };

  cache.set(cacheKey, response);
  return response;
}

function validate(req: TrialSearchRequest): void {
  if (!req.conditions?.length) {
    throw new ValidationError('conditions must be a non-empty array');
  }
  if (!req.zip || !/^\d{5}(-\d{4})?$/.test(req.zip.trim())) {
    throw new ValidationError('zip must be a valid 5-digit US zip code');
  }
  if (!req.radiusMiles || req.radiusMiles <= 0 || req.radiusMiles > 2000) {
    throw new ValidationError('radiusMiles must be between 1 and 2000');
  }
  // Deliberately no patientId/name/DOB fields exist on TrialSearchRequest at
  // all -- there's nothing here to validate away, by design.
}

/** Exposed for tests only. */
export function __getCacheSizeForTests(): number {
  return cache.size();
}
