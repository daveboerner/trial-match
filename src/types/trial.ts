/**
 * Types for the standalone trial-search backend (Phase 1).
 *
 * Deliberately excludes any patient-identifying fields (patientId, name, DOB).
 * The Vim SDK layer (Phase 4) resolves patientId -> {conditions, zip} on the
 * frontend/gateway BEFORE calling this service, so this service and everything
 * downstream of it (including ClinicalTrials.gov) never sees who the patient is.
 */

export interface TrialSearchRequest {
  /** Provider-selected condition(s), plain-language text (e.g. "heart attack").
   *  Spec calls for a single provider-picked condition, but the type allows
   *  an array so we're not locked in if that changes later. */
  conditions: string[];
  /** Patient's zip code, used only to derive a lat/lng search origin. */
  zip: string;
  /** Provider-selected search radius in miles. */
  radiusMiles: number;
  /** Defaults to ['RECRUITING'] if omitted. */
  status?: string[];
  pageSize?: number;
}

export interface GeoPoint {
  lat: number;
  lng: number;
  city?: string;
  state?: string;
}

export interface TrialContact {
  name?: string;
  phone?: string;
  email?: string;
}

export interface TrialLocation extends TrialContact {
  facility?: string;
  city?: string;
  state?: string;
  zip?: string;
  status?: string;
  distanceMiles?: number;
}

export interface NormalizedTrial {
  nctId: string;
  title: string;
  acronym?: string;
  status: string;
  phases: string[];
  studyType?: string;
  sponsor?: string;
  conditions: string[];
  matchedCondition: string;
  centralContact?: TrialContact;
  /** Nearest RECRUITING (or otherwise-matching) location, if any. */
  nearestLocation?: TrialLocation;
  /** Up to a handful of nearby locations, sorted by distance. */
  nearbyLocations: TrialLocation[];
  url: string;
}

export interface TrialSearchResponse {
  query: {
    condition: string;
    radiusMiles: number;
    origin: { lat: number; lng: number };
  };
  totalCount: number;
  trials: NormalizedTrial[];
}

export class GeocodeError extends Error {}
export class CtGovApiError extends Error {}
