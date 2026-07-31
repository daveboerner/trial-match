import { NextRequest, NextResponse } from 'next/server';
import { searchTrials, ValidationError } from '../../../lib/search-trials';
import { GeocodeError, CtGovApiError } from '../../../types/trial';
import type { TrialSearchRequest } from '../../../types/trial';

/**
 * POST /api/trial-search
 *
 * Body: TrialSearchRequest — { conditions: string[], zip, radiusMiles, status? }
 *
 * Intentionally has NO patientId parameter. This route (and everything it
 * calls) only ever sees a condition string + a zip code, never who the
 * patient is. Phase 4 (Vim wiring) resolves patientId -> {conditions, zip}
 * upstream of this call and must not pass patientId through here.
 */
export async function POST(req: NextRequest) {
  let body: TrialSearchRequest;
  try {
    body = (await req.json()) as TrialSearchRequest;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  try {
    const result = await searchTrials(body);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: 'validation_error', message: err.message }, { status: 400 });
    }
    if (err instanceof GeocodeError) {
      return NextResponse.json({ error: 'geocode_failed', message: err.message }, { status: 422 });
    }
    if (err instanceof CtGovApiError) {
      console.error('[trial-search] CT.gov error:', err.message);
      return NextResponse.json({ error: 'trial_search_upstream_failed' }, { status: 502 });
    }
    console.error('[trial-search] unexpected error:', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
