import { GeoPoint, NormalizedTrial, TrialContact, TrialLocation } from '../types/trial';

/**
 * Transforms a raw ClinicalTrials.gov "study" object (protocolSection-based)
 * into the flat shape the UI actually wants.
 *
 * Also strips any embedded HTML (e.g. <mark class="hl-synonym">...</mark>
 * highlighting spans, which show up on the search-UI-facing endpoints and
 * could plausibly leak into API responses too). We never want raw HTML
 * reaching a React app that might someday render it with
 * dangerouslySetInnerHTML — strip it here, once, at the boundary.
 */

const MAX_NEARBY_LOCATIONS = 5;

export function normalizeStudy(
  study: any,
  origin: GeoPoint,
  matchedCondition: string,
): NormalizedTrial {
  const ps = study?.protocolSection ?? {};
  const id = ps.identificationModule ?? {};
  const status = ps.statusModule ?? {};
  const design = ps.designModule ?? {};
  const sponsor = ps.sponsorCollaboratorsModule ?? {};
  const conditionsModule = ps.conditionsModule ?? {};
  const contactsLocations = ps.contactsLocationsModule ?? {};

  const nctId: string = id.nctId ?? 'UNKNOWN';
  const title = stripHtml(id.briefTitle ?? id.officialTitle ?? '(untitled study)');
  const acronym = id.acronym ? stripHtml(id.acronym) : undefined;

  const conditions: string[] = Array.isArray(conditionsModule.conditions)
    ? conditionsModule.conditions.map(stripHtml)
    : [];

  const centralContact = normalizeContact(contactsLocations.centralContacts?.[0]);

  const allLocations: TrialLocation[] = Array.isArray(contactsLocations.locations)
    ? contactsLocations.locations.map((loc: any) => normalizeLocation(loc, origin))
    : [];

  const nearbyLocations = dedupeAndRank(allLocations);
  const nearestLocation =
    nearbyLocations.find((l) => l.status === 'RECRUITING') ?? nearbyLocations[0];

  return {
    nctId,
    title,
    acronym,
    status: status.overallStatus ?? 'UNKNOWN',
    phases: Array.isArray(design.phases) ? design.phases : [],
    studyType: design.studyType,
    sponsor: sponsor.leadSponsor?.name ? stripHtml(sponsor.leadSponsor.name) : undefined,
    conditions,
    matchedCondition,
    centralContact,
    nearestLocation,
    nearbyLocations,
    url: `https://clinicaltrials.gov/study/${nctId}`,
  };
}

function normalizeContact(raw: any): TrialContact | undefined {
  if (!raw) return undefined;
  return {
    name: raw.name ? stripHtml(raw.name) : undefined,
    phone: raw.phone,
    email: raw.email,
  };
}

function normalizeLocation(raw: any, origin: GeoPoint): TrialLocation {
  const geo = raw?.geoPoint;
  const distanceMiles =
    geo?.lat != null && geo?.lon != null
      ? haversineMiles(origin.lat, origin.lng, geo.lat, geo.lon)
      : undefined;

  return {
    facility: raw?.facility ? stripHtml(raw.facility) : undefined,
    city: raw?.city,
    state: raw?.state,
    zip: raw?.zip,
    status: raw?.status,
    distanceMiles: distanceMiles != null ? round1(distanceMiles) : undefined,
    name: raw?.contacts?.[0]?.name ? stripHtml(raw.contacts[0].name) : undefined,
    phone: raw?.contacts?.[0]?.phone,
    email: raw?.contacts?.[0]?.email,
  };
}

/**
 * The raw API frequently lists the same physical site multiple times, once
 * per historical status (e.g. "NOT_YET_RECRUITING" and "RECRUITING" rows for
 * the same facility/city/zip as the record was updated over time). Keep one
 * entry per facility+city+zip, preferring the RECRUITING copy, then sort by
 * distance and cap the list.
 */
function dedupeAndRank(locations: TrialLocation[]): TrialLocation[] {
  const byKey = new Map<string, TrialLocation>();

  for (const loc of locations) {
    const key = `${loc.facility ?? ''}|${loc.city ?? ''}|${loc.zip ?? ''}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, loc);
      continue;
    }
    if (existing.status !== 'RECRUITING' && loc.status === 'RECRUITING') {
      byKey.set(key, loc);
    }
  }

  return Array.from(byKey.values())
    .sort((a, b) => (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity))
    .slice(0, MAX_NEARBY_LOCATIONS);
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R_MILES = 3958.8;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R_MILES * c;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, '').trim();
}
