import { CtGovApiError } from '../types/trial';

/**
 * Client for the DOCUMENTED, PUBLIC ClinicalTrials.gov API v2.
 * https://clinicaltrials.gov/api/v2/studies
 *
 * Deliberately NOT using /api/int/studies (the clinicaltrials.gov *website's*
 * internal, cookie-session-authenticated endpoint) — that one is undocumented,
 * has no stability guarantee, and isn't reachable without a live browser
 * session (pinger_sid/ncbi_sid cookies), which a backend service can't hold.
 */

const CTGOV_BASE = 'https://clinicaltrials.gov/api/v2/studies';

// "Piece" field names per the v2 API — shorthand for the nested
// protocolSection.*Module.* paths. Keep this list narrow; every field you
// add here is bandwidth + parse time on every request.
const FIELDS = [
  'NCTId',
  'BriefTitle',
  'Acronym',
  'OverallStatus',
  'Phase',
  'StudyType',
  'LeadSponsorName',
  'Condition',
  'LocationFacility',
  'LocationCity',
  'LocationState',
  'LocationZip',
  'LocationCountry',
  'LocationStatus',
  'LocationGeoPoint',
  'LocationContactName',
  'LocationContactPhone',
  'LocationContactEMail',
  'CentralContactName',
  'CentralContactPhone',
  'CentralContactEMail',
].join(',');

export interface CtGovQueryParams {
  condition: string;
  lat: number;
  lng: number;
  radiusMiles: number;
  statuses?: string[];
  pageSize?: number;
}

export interface CtGovStudiesResponse {
  studies: unknown[];
  totalCount?: number;
  nextPageToken?: string;
}

const REQUEST_TIMEOUT_MS = 8000;

export async function fetchStudies(params: CtGovQueryParams): Promise<CtGovStudiesResponse> {
  const {
    condition,
    lat,
    lng,
    radiusMiles,
    statuses = ['RECRUITING'],
    pageSize = 10,
  } = params;

  const search = new URLSearchParams({
    'query.cond': condition,
    'filter.geo': `distance(${lat},${lng},${radiusMiles}mi)`,
    // NOTE: verify multi-value syntax against the live API reference before
    // production — this assumes comma-separated values, matching the v2
    // docs at the time this was written. If a status filter silently stops
    // narrowing results, this is the first thing to check.
    'filter.overallStatus': statuses.join(','),
    fields: FIELDS,
    pageSize: String(pageSize),
  });

  const url = `${CTGOV_BASE}?${search.toString()}`;

  const doFetch = async (): Promise<Response> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
    } finally {
      clearTimeout(timeout);
    }
  };

  let res: Response;
  try {
    res = await doFetch();
    if (!res.ok && res.status >= 500) {
      // one retry on transient server errors
      res = await doFetch();
    }
  } catch (err) {
    throw new CtGovApiError(`ClinicalTrials.gov request failed: ${(err as Error).message}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new CtGovApiError(`ClinicalTrials.gov returned ${res.status}: ${body.slice(0, 300)}`);
  }

  return (await res.json()) as CtGovStudiesResponse;
}
