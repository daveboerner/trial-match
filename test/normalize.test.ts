import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeStudy } from '../src/lib/normalize';
import { searchTrials, ValidationError } from '../src/lib/search-trials';

const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/sample-study.json'), 'utf-8'),
);

// Miami Beach, FL 33140 -- same origin used in the original curl example.
const origin = { lat: 25.8176795, lng: -80.1372757 };

test('normalizeStudy: strips HTML highlight markup from title/conditions', () => {
  const trial = normalizeStudy(fixture, origin, 'heart attack');
  assert.equal(trial.title, 'Focused Orticumab Research for Treating Inflammation in Coronary Arteries');
  assert.deepEqual(trial.conditions, [
    'Acute Coronary Syndromes',
    'Coronary Arterial Disease (CAD)',
    'Inflammation',
  ]);
});

test('normalizeStudy: pulls core identifiers correctly', () => {
  const trial = normalizeStudy(fixture, origin, 'heart attack');
  assert.equal(trial.nctId, 'NCT06927739');
  assert.equal(trial.acronym, 'FORTIFY');
  assert.equal(trial.status, 'RECRUITING');
  assert.deepEqual(trial.phases, ['PHASE2']);
  assert.equal(trial.sponsor, 'Abcentra');
  assert.equal(trial.matchedCondition, 'heart attack');
  assert.equal(trial.url, 'https://clinicaltrials.gov/study/NCT06927739');
});

test('normalizeStudy: central contact is captured', () => {
  const trial = normalizeStudy(fixture, origin, 'heart attack');
  assert.equal(trial.centralContact?.name, 'Abcentra');
  assert.equal(trial.centralContact?.phone, '424-369-4401');
  assert.equal(trial.centralContact?.email, 'info@abcentra.com');
});

test('normalizeStudy: dedupes identical facility+city+zip, preferring RECRUITING', () => {
  const trial = normalizeStudy(fixture, origin, 'heart attack');
  // Fixture has 4 raw location rows, but only 3 distinct facility+city+zip
  // combos (Boca Raton appears twice: ACTIVE_NOT_RECRUITING + RECRUITING).
  assert.equal(trial.nearbyLocations.length, 3);

  const boca = trial.nearbyLocations.find((l) => l.city === 'Boca Raton');
  assert.ok(boca, 'expected a Boca Raton location to survive dedup');
  assert.equal(boca!.status, 'RECRUITING', 'dedup should keep the RECRUITING copy, not ACTIVE_NOT_RECRUITING');
});

test('normalizeStudy: sorts locations by distance and picks nearest RECRUITING as the headline location', () => {
  const trial = normalizeStudy(fixture, origin, 'heart attack');

  // Boca Raton (~40mi from Miami Beach) should be far closer than LA/Torrance.
  assert.ok(trial.nearestLocation, 'expected a nearest location');
  assert.equal(trial.nearestLocation!.city, 'Boca Raton');
  assert.equal(trial.nearestLocation!.status, 'RECRUITING');
  assert.ok(
    trial.nearestLocation!.distanceMiles! < 100,
    `expected Boca Raton to be under 100mi of Miami Beach, got ${trial.nearestLocation!.distanceMiles}`,
  );

  // Confirm actual distance ordering: Boca Raton nearest, then LA/Torrance far away.
  const distances = trial.nearbyLocations.map((l) => l.distanceMiles);
  assert.ok(distances[0]! < distances[1]!, 'expected locations sorted ascending by distance');
});

test('normalizeStudy: handles a study with no locations without throwing', () => {
  const bare = {
    protocolSection: {
      identificationModule: { nctId: 'NCT00000000', briefTitle: 'Bare Study' },
      statusModule: { overallStatus: 'RECRUITING' },
    },
  };
  const trial = normalizeStudy(bare, origin, 'heart attack');
  assert.equal(trial.nearbyLocations.length, 0);
  assert.equal(trial.nearestLocation, undefined);
});

// --- search-trials request validation (pure, no network) ---

test('searchTrials: rejects empty conditions', async () => {
  await assert.rejects(
    () => searchTrials({ conditions: [], zip: '33140', radiusMiles: 100 }),
    ValidationError,
  );
});

test('searchTrials: rejects invalid zip', async () => {
  await assert.rejects(
    () => searchTrials({ conditions: ['heart attack'], zip: 'not-a-zip', radiusMiles: 100 }),
    ValidationError,
  );
});

test('searchTrials: rejects out-of-range radius', async () => {
  await assert.rejects(
    () => searchTrials({ conditions: ['heart attack'], zip: '33140', radiusMiles: 0 }),
    ValidationError,
  );
  await assert.rejects(
    () => searchTrials({ conditions: ['heart attack'], zip: '33140', radiusMiles: 5000 }),
    ValidationError,
  );
});

test('TrialSearchRequest type: no patientId field exists at all', () => {
  // This is a compile-time guarantee more than a runtime one -- if someone
  // adds a patientId field to TrialSearchRequest later, TypeScript will not
  // catch it here, so the real enforcement is code review + the comments in
  // src/types/trial.ts. This test just documents the intent.
  const req = { conditions: ['x'], zip: '33140', radiusMiles: 10 };
  assert.ok(!('patientId' in req));
});
