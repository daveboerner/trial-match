# Trial Match — Phase 1: Trial-Search Backend

This is the **standalone, Vim-free** trial-search service. No EHR, no SDK,
no auth flow yet — just a working pipeline from
`{condition, zip, radiusMiles}` to normalized trial results, backed by the
real, documented ClinicalTrials.gov API v2.

## Why standalone first

This is the piece with the most unknowns (query mapping, response shape,
rate limits, distance math) and the least dependency on the slow
Vim-sandbox iteration loop. Get it right in isolation, then wire it up.

## What's in here

```
src/
  types/trial.ts          Shared types (note: no patientId field, anywhere)
  lib/geocode.ts          zip -> {lat,lng} via zippopotam.us, cached by zip
  lib/ctgov-client.ts     ClinicalTrials.gov API v2 client (NOT /api/int/*)
  lib/normalize.ts        Raw study -> flat NormalizedTrial (strips HTML,
                          dedupes duplicate location rows, sorts by distance)
  lib/cache.ts            In-memory TTL cache (swap for Redis before scaling
                          past one instance)
  lib/search-trials.ts    Orchestrates the above + request validation
  app/api/trial-search/route.ts   Next.js route handler wrapping search-trials

test/
  fixtures/sample-study.json   Trimmed real study data, adapted from a
                                clinicaltrials.gov search-UI sample
  normalize.test.ts             Unit tests (no network) for normalize.ts
                                 and request validation
```

## Run it

```bash
npm install
npm run typecheck   # tsc --noEmit across the whole project
npm test            # runs the offline unit test suite (10 tests)
```

`npm test` does **not** hit the network — it exercises `normalizeStudy()`
and `searchTrials()`'s validation against a static fixture. That's
intentional: it means these tests run in CI without depending on
ClinicalTrials.gov's uptime.

## What isn't tested here (and why)

- **`geocode.ts` and `ctgov-client.ts` against live services.** Both call
  external HTTPS endpoints this sandbox can't reach. Before shipping,
  add an integration test (or just a manual smoke test) that runs
  `searchTrials({ conditions: ['heart attack'], zip: '33140', radiusMiles: 500 })`
  against the real network and eyeballs the output.
- **The Next.js route handler itself.** It's a thin wrapper around
  `searchTrials()` — the logic worth testing lives one layer down, where
  it's easier to test without spinning up a Next.js server.

## Known thing to verify before production

In `ctgov-client.ts`, `filter.overallStatus` is joined with commas when
passed multiple statuses. That matches the v2 docs as understood at
write-time, but confirm the exact multi-value syntax against the live
[API reference](https://clinicaltrials.gov/data-api/api) before relying on
it — if a status filter silently stops narrowing results, this is the
first thing to check.

## Privacy-by-construction

`TrialSearchRequest` has no `patientId`, name, or DOB field — by design,
not by validation. The Vim-integration layer (Phase 4) is responsible for
resolving `patientId -> {condition, zip}` *before* calling this service;
this service and everything downstream of it (including
ClinicalTrials.gov) should never see who the patient is. If a future
change adds a patient identifier to this request type, that's a signal to
stop and reconsider the design, not just add a redaction step.

## Next phase

Phase 2: build the trial-card UI against this API (or a static fixture of
its response shape) — still with no Vim SDK involved.
