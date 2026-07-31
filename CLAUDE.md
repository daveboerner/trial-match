# Trial Match — Project Context for Claude Code

Clinical trial matching app embedded in EHR workflows via Vim Connect
(`@vimconnect/app-sdk`). A provider opens a patient chart; the app searches
ClinicalTrials.gov for trials matching a selected active problem near the
patient, and lets the provider save a match back to the encounter note.

This file is project memory — read it at the start of every session before
making changes. Update it when a phase completes or a decision changes.

## Current status

**Phases 1, 1.5, and 2 are done.** If you're picking this up fresh, your
first job is Phase 3 (wire the real backend into the Phase 2 UI) — see
"Phase 2 notes" below for what to swap out.

| Phase | What | Status |
|---|---|---|
| 1 | Trial-search backend (geocode, CT.gov v2 client, normalize, cache) | ✅ Done — 10 unit tests passing, typechecks clean |
| 1.5 | Live smoke test against real network | ✅ Done 2026-07-31 — see results below |
| 2 | Trial-card UI, fed by mock/fixture data, no Vim SDK | ✅ Done 2026-07-31 — see Phase 2 notes below |
| 3 | Wire real Phase 1 API into Phase 2 UI | ⬜ **Not started — do this next** |
| 4 | Vim SDK: app registration, OAuth launch flow, `chart_open` handler | ⬜ Not started |
| 5 | Encounter writeback (Tier 1) | ⬜ Not started |
| 6 | Referral pre-fill (Tier 2) + hardening | ⬜ Not started |

## Immediate first task

**Superseded — Phase 1.5 is done.** Live smoke test ran clean on 2026-07-31
against real `zippopotam.us` and `clinicaltrials.gov` endpoints:

- `{"conditions":["heart attack"],"zip":"33140","radiusMiles":500}` → 200,
  10 real recruiting trials near Miami Beach, correctly geocoded
  (25.82, -80.13) and distance-sorted.
- Unmatched condition → 200, `trials: []`.
- Invalid zip (`00000`) → 422 `geocode_failed`.
- Out-of-range radius (`99999`) → 400 `validation_error`.
- `npm test` (10/10) and `npm run typecheck` both clean afterward.

## Phase 2 notes (done 2026-07-31)

Built as a plain Next.js App Router page — no Vim SDK, no network call.

- `src/lib/mock-data.ts` — `MOCK_ACTIVE_PROBLEMS` (stand-in for
  `sdk.ehr.api.patient.getProblems()`) and `MOCK_TRIALS_BY_CONDITION`, a
  handful of real `NormalizedTrial` records adapted verbatim from the
  Phase 1.5 live smoke test response (real NCT IDs/locations, so it's
  representative — not synthetic). Only `'heart attack'` has entries; the
  other two mock problems intentionally have none, to exercise the
  empty-results state.
- `src/app/page.tsx` — problem picklist + radius select + Search button.
  `filterByRadius()` client-side mimics the backend's distance filter +
  nearest-location recompute (see `src/lib/search-trials.ts`,
  `normalize.ts`) purely so the radius control does something meaningful
  against static data — this function goes away in Phase 3.
- `src/components/TrialCard.tsx` — presentational card (status badge,
  phase/type tags, sponsor, matched condition, nearest location + contact,
  collapsible nearby locations, link to CT.gov). Includes a disabled "Add
  to chart" button (title tooltip references Phase 5) so the writeback
  affordance has a home in the layout already — not wired to anything.
- Verified: `npm run typecheck` clean, `npm test` 10/10, dev server
  renders `/` with the picklist and empty-state copy present in the
  initial HTML. The `filterByRadius` logic itself was also exercised
  directly (outside React) against the mock dataset across radius
  25/50/100/500 — counts increase correctly as radius grows. Not verified:
  actual browser interaction (select → click Search → cards render) — no
  browser-automation tool was available in that session; the untested
  surface is React state wiring (`useState`/`onChange`/`onClick`), not the
  filtering logic.
- Added `baseUrl`/`paths` (`@/*` → `./src/*`) and `DOM`/`DOM.Iterable` to
  `lib` in `tsconfig.json` — Phase 1 didn't need either (backend-only,
  no JSX/DOM types), Phase 2 does.

**Phase 3 replaces:** `MOCK_ACTIVE_PROBLEMS` with a real problems source
(mocked API call now, `sdk.ehr.api.patient.getProblems()` later in Phase
4), `MOCK_TRIALS_BY_CONDITION` + `filterByRadius()` with a real fetch to
`/api/trial-search`, using `radiusMiles` as a request param instead of a
client-side re-filter.

## Architecture decisions (and why — don't relitigate these without reason)

- **Use the public ClinicalTrials.gov API v2** (`clinicaltrials.gov/api/v2/studies`),
  never `/api/int/studies`. The internal endpoint is cookie/session-authenticated
  (`pinger_sid`, `ncbi_sid`), undocumented, and has no stability guarantee —
  it's what the clinicaltrials.gov *website* uses internally, not a public
  integration surface.
- **Geocode the patient's address (zip-level), not the clinic's.** We
  considered clinic-address-only for stronger privacy isolation, but decided
  patient address gives real travel-distance accuracy, which is what
  providers actually want. Compromise: geocode to zip/city precision only
  (never full street address), and the geocode cache key is the zip code —
  never the patientId. No patient identifier is ever sent to
  ClinicalTrials.gov or logged alongside a search.
- **`TrialSearchRequest` has no `patientId` field, by design, not by
  redaction.** See `src/types/trial.ts`. If a future change adds a patient
  identifier to this type, stop and reconsider — that's a sign the
  privacy boundary is eroding, not just something to filter out later.
- **Provider picks exactly one active problem to search on**, plus a
  radius, via a picklist UI (Phase 2) — not an automatic search across the
  whole problem list. Keeps result relevance high and gives the provider
  an obvious place to initiate the search.
- **Two workflow events, two jobs** (see Vim SDK section below):
  `chart_open` kicks off the trial search immediately (may run before any
  encounter exists); `encounter_open` is what gates whether the "Add to
  chart" writeback button is enabled. Don't collapse these into one
  listener — a chart can be open for review with no encounter in context.

## Vim SDK reference (`@vimconnect/app-sdk`)

Docs: https://developer-docs.getvim.ai/docs/ — this is the **new** SDK,
distinct from the legacy `docs.getvim.com` VimOS.js docs. Don't mix the two
APIs up if searching for reference material.

Key pages already reviewed:
- `docs/ehr-connectivity/` (overview, workflow-events, context, entity-api, writeback)
- `docs/authentication/` — OAuth 2.0 authorization-code flow, server-side token exchange
- `docs/api-reference/entity-types/` — Patient/Encounter/Order/Referral field lists

Core facts:
- `sdk.ehr.workflow.on('chart_open', handler)` fires once; `event.entities.patient`
  is a **reference only** (`{id, entityType}`), not full data. Follow up with
  `sdk.ehr.api.patient.getProblems({patientId})` / `getDemographics({patientId})`
  to get real data.
- `sdk.ehr.context.onChange(key, (prev, curr) => ...)` fires continuously —
  used for gating UI state (e.g. is an encounter currently in context).
- Writeback is capability-gated per EHR: always call
  `sdk.ehr.context.<entity>.getCapability('update')` before attempting a
  write, and check `hasPermission('update')` /
  `requestPermission('update')` for disruptive operations. Never assume a
  capability exists — build the UI to degrade gracefully when it doesn't.
- Auth: OAuth 2.0 authorization-code flow. Launch URL receives `launch_id`
  — redirect to `/app-auth/authorize` — Vim redirects back with `code` +
  `state` — exchange server-side at `/app-auth/token` (client secret never
  touches the browser) — `initVimSDK({ accessToken })`.

## Writeback plan (Phases 5–6) — three tiers, build in this order

1. **Tier 1 — append to encounter note** (Phase 5, do this first). Lowest
   friction, works on the widest range of EHRs.
   ```ts
   const cap = sdk.ehr.context.encounter.getCapability('update');
   if (cap.available && sdk.ehr.context.encounter.hasPermission('update')) {
     await sdk.ehr.context.encounter.update(
       { assessment: { plan: `Clinical trial candidate: ${trial.title} (NCT${trial.nctId}) — ${trial.site}, ${trial.contactPhone}` } },
       { mode: 'append' }
     );
   }
   ```
2. **Tier 2 — pre-fill a Referral** (Phase 6, opportunistic, EHR-dependent).
   Listen for `referral_start` (fires when the *provider* initiates a
   referral natively in the EHR — the app doesn't spawn referrals on its
   own) and enrich it with the selected trial's site/conditions/notes
   before `referral_save`.
3. **Tier 3 — universal fallback.** Printable/copyable trial summary,
   always available regardless of EHR capability. Never let the whole
   feature depend on writeback support existing — this is the safety net.

## Known unknowns / things to verify, don't just trust

- ~~`filter.overallStatus` unverified against a live call~~ — **resolved
  2026-07-31.** Confirmed working against a real `clinicaltrials.gov`
  v2 call (see Phase 1.5 results above): status filtering, dedup, and
  distance sort all behaved correctly on live data, not just the fixture.
- TypeScript pin: the code as transferred from the original chat still had
  `"typescript": "^7.0.2"` in `package.json` (unpinned), despite the prior
  session's note that it had been fixed to `5.6.3`. Re-applied the pin here
  on 2026-07-31 — confirmed `npx tsc --version` → `5.6.3`, `next dev` boots
  clean, `npm test` (10/10) and `npm run typecheck` both pass. Don't casually
  bump TypeScript without re-confirming `next dev` still boots — that's
  what broke last time.
- `npm audit` reports 3 high-severity transitive vulnerabilities (postcss,
  sharp) pulled in via `next@16.2.12`'s build tooling. The only fix npm
  offers is downgrading to `next@9.3.3` — a large breaking change, not
  applied. Revisit before any production deployment; not a blocker for
  local Phase 2/3 UI work.
- Location dedup in `normalize.ts` keys on `facility+city+zip` and prefers
  a `RECRUITING` status copy over other statuses when duplicates exist —
  this was verified against a realistic fixture
  (`test/fixtures/sample-study.json`) but not against the full diversity
  of location-status combinations CT.gov actually returns in production.

## Repo setup

Lives at `~/trial-match` (moved here from a Downloads export on 2026-07-31),
own git repo, `main` branch, no remote configured yet. `.gitignore` covers
`node_modules/`, `dist/`, `.next/`, `.env*`.

## File manifest (Phase 1, already built)

```
src/types/trial.ts                  Shared types — no patientId field, anywhere
src/lib/geocode.ts                  zip -> {lat,lng}, cached by zip (zippopotam.us)
src/lib/ctgov-client.ts             ClinicalTrials.gov v2 client
src/lib/normalize.ts                Raw study -> NormalizedTrial (HTML-strip, dedup, distance sort)
src/lib/cache.ts                    In-memory TTL cache (swap for Redis before multi-instance)
src/lib/search-trials.ts            Orchestration + request validation
src/app/api/trial-search/route.ts   Next.js route handler
test/fixtures/sample-study.json     Realistic fixture (has duplicate locations by status)
test/normalize.test.ts              10 passing tests, no network required
README.md                           Phase 1-specific setup/testing notes
```

## Testing conventions established so far

- `npm test` — offline unit tests only (normalize + validation logic), no
  network. Should always pass in CI without depending on any external
  service's uptime.
- `npm run typecheck` — `tsc --noEmit` across the whole project.
- Live/network-dependent behavior (geocoding, CT.gov calls, and later, the
  actual Vim sandbox EHR) gets smoke-tested manually via `npm run dev` +
  `curl`, not folded into the automated suite — keep it that way unless
  you set up a mock server for it.
