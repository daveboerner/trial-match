# Trial Match — Project Context for Claude Code

Clinical trial matching app embedded in EHR workflows via Vim Connect
(`@vimconnect/app-sdk`). A provider opens a patient chart; the app searches
ClinicalTrials.gov for trials matching a selected active problem near the
patient, and lets the provider save a match back to the encounter note.

This file is project memory — read it at the start of every session before
making changes. Update it when a phase completes or a decision changes.

## Current status

**Phases 1 through 3 are done. Phase 4 is registered and deployed, but
auth is not yet confirmed working end-to-end.** Registration was
submitted and the app loads correctly inside a real sandbox chart
(`sandbox-ehr.stage.getvim.ai`) — but the *first* real-chart test
(2026-08-03) surfaced that the client-side auth model documented earlier
was wrong: the SDK does not auto-resolve a token on its own, our app has
to actively redirect through Vim's `/app-auth/authorize` first. That's
now implemented (2026-08-04, see Phase 4 / "Vim SDK reference §1" notes)
and typechecks, but **has not yet been re-tested inside the sandbox
chart**. That's the immediate next step, before anything else.

| Phase | What | Status |
|---|---|---|
| 1 | Trial-search backend (geocode, CT.gov v2 client, normalize, cache) | ✅ Done — 10 unit tests passing, typechecks clean |
| 1.5 | Live smoke test against real network | ✅ Done 2026-07-31 — see results below |
| 2 | Trial-card UI, fed by mock/fixture data, no Vim SDK | ✅ Done 2026-07-31 — see Phase 2 notes below |
| 3 | Wire real Phase 1 API into Phase 2 UI | ✅ Done 2026-07-31 — see Phase 3 notes below |
| 4 | Vim SDK: `chart_open` handler, token endpoint, hosting/registration, auth flow | 🟡 Registered + deployed; authorize-redirect flow just rewritten (2026-08-04) — **retest inside the sandbox chart next, this has not been confirmed working yet** |
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

- `src/lib/mock-data.ts` — `MOCK_ACTIVE_PROBLEMS`, stand-in for
  `sdk.ehr.api.patient.getProblems()`. (Originally also had a
  `MOCK_TRIALS_BY_CONDITION` static trial dataset + client-side
  `filterByRadius()`; both were deleted in Phase 3 once the real API was
  wired in — don't recreate them.)
- `src/app/page.tsx` — problem picklist + radius select + Search button.
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

## Phase 3 notes (done 2026-07-31)

Replaced the mock trial dataset with a real `fetch('/api/trial-search')`
call from `src/app/page.tsx`. `MOCK_ACTIVE_PROBLEMS` (the problem
picklist) was **still mocked at this point, on purpose** — that became
Phase 4's job. (Phase 4 note: it now sources the picklist from
`chart_open` directly, not a `getProblems()` call — see Phase 4 notes.)

- Added a **patient zip text input** to the search panel (default
  `33140`). There was no patient chart context yet at this point (that
  came in Phase 4), so this was the temporary stand-in for the zip.
  (Phase 4 note: the input didn't go away — it's still there, editable in
  standalone/dev mode and read-only once a real chart supplies the zip.)
- Added `status` state (`idle | loading | error | success`) and an
  `ERROR_MESSAGES` map keyed by the API's error codes
  (`validation_error`, `geocode_failed`, `trial_search_upstream_failed`,
  `invalid_json`, `internal_error` — see `route.ts`). The UI prefers the
  API's own `message` field when present (validation/geocode errors
  already return a specific, actionable message) and only falls back to
  the generic copy in `ERROR_MESSAGES` for the two error codes that don't
  carry one (502/500).
- `totalCount` vs `trials.length`: if CT.gov's `totalCount` exceeds what
  was returned (default `pageSize` is 10, see `ctgov-client.ts`), the UI
  says so explicitly ("of N total — narrow your search or expand
  radius") rather than silently showing a partial list as if it were
  complete.
- Verified against the live server, not just typecheck: confirmed `/`
  renders the new zip field, sent the *exact* request shape the UI
  builds and got back real CT.gov trials, and separately confirmed the
  `geocode_failed` error path (zip `00000`) returns the shape
  `ERROR_MESSAGES` expects. `npm test` (10/10) and typecheck clean.
  Still not verified: real browser click-through (same gap as Phase 2 —
  no browser-automation tool in that session).

## Phase 4 notes (code done 2026-07-31, app registration still outstanding)

**Before touching this again, re-read the "Vim SDK reference" section
below — it corrects three wrong assumptions from the original chat
transfer** (auth model, event data shape, event names). Don't trust the
old assumptions if you see them referenced anywhere else (e.g. in
scrollback) — the corrected version below is what's actually verified
against `@vimconnect/app-sdk@0.4.50`'s real type definitions.

- `src/lib/use-chart-context.ts` — `useChartContext()` hook. Calls
  `initVimSDK({ handshakeTimeout: 4000 })` on mount; on success,
  subscribes to `chart_open` and derives both the problem picklist *and*
  the zip straight from the event (`patient.problems[]`,
  `patient.address.zipCode`) — no separate `getProblems()`/
  `getDemographics()` call needed for what this app uses. On failure
  (no Vim Hub to connect to), silently stays in the mock/standalone
  fallback — this is the expected path for local dev, not an error state.
- Three UI states now drive `src/app/page.tsx`: `standalone` (mock
  picklist + editable zip, same as Phase 3), `waiting-for-chart`
  (connected to Vim, no chart open yet — search disabled), `chart-ready`
  (real problems + read-only zip from the event).
- Problem-status filtering (`isActiveStatus` in `use-chart-context.ts`)
  is a **best-effort heuristic, not a verified contract** — the SDK's
  `problems[].status` field has no fixed enum, it's whatever string the
  source EHR sends. Currently excludes only a denylist
  (`resolved`/`inactive`/`remission`/`ruled_out`) and keeps anything else
  (including missing status). Revisit once tested against a real EHR
  feed — the denylist may need entries added, or may be wrong entirely
  for some EHRs.
- `zod` was added as a direct dependency (SDK's `peerDependencies` require
  v4+); `@vimconnect/app-sdk` added as a normal dependency.
- Verified: typecheck clean, `npm test` 10/10, dev server renders `/` in
  `standalone` mode with the mock picklist intact (confirms the fallback
  path works when there's no SDK to connect to, which is the only mode
  reachable from local dev). **Not verified:** anything past that —
  no real Vim app registration exists yet, so `waiting-for-chart` and
  `chart-ready` have never actually been exercised against a live
  `initVimSDK()` connection or a real `chart_open` event. Same
  browser-automation gap as Phases 2–3 also applies here.

**What's needed before Phase 4 can be considered done, not just
coded:** register Trial Match as a Vim app (app ID, manifest, sandbox EHR
access) — this happens through Vim's internal process, outside this
repo, and only Dave can drive it. Once that exists: confirm
`initVimSDK()` actually connects inside a real sandboxed chart, confirm a
real `chart_open` event's shape matches what `use-chart-context.ts`
assumes (especially `problems[].status` values — see above), and only
then move to Phase 5 (encounter writeback), since Tier 1 writeback needs
a live encounter in context to test against at all.

### App registration — infra done 2026-07-31; Vim-side registration form still to submit

- **Hosting:** Vercel, connected to the GitHub repo below. Production URL
  (confirmed live 2026-07-31): `https://trial-match-davesboerner-7206s-projects.vercel.app`.
  **Do not use `https://trial-match.vercel.app`** — that name was already
  claimed by an unrelated third-party project ("Cureiosity"); `*.vercel.app`
  names are global, not scoped to our account, and that clean name lost
  the race. Use the team-scoped alias above (no random hash — that part's
  stable across redeploys; the hash-suffixed per-deployment URL isn't).
  Registration form values, from that URL: App URL = it; Launch Endpoint =
  same (root `/`, reads query params itself); Token Endpoint = `<App
  URL>/api/auth/token`; Allowed URLs = it; Worker Launch Endpoint = blank
  (no Worker App).
- **Deployment Protection:** was ON by default (Vercel SSO wall, blocked
  *all* access including production — not just previews). Turned off
  2026-07-31 via Project → Settings → Deployment Protection. If a future
  redeploy or new team project mysteriously 302s to `vercel.com/sso-api`,
  check this setting first.
- **Repo:** https://github.com/daveboerner/trial-match — **public**, by
  explicit choice (not the default recommendation, which was private —
  noting this so a future session doesn't "fix" it back to private
  without asking first).
- **Vim client_id:** `305d7d2a-7f7b-45ae-83db-75c70071d75b` — real value,
  in `.env.local` (gitignored) as both `VIM_CLIENT_ID` (server-only, used
  by `/api/auth/token`) and `NEXT_PUBLIC_VIM_CLIENT_ID` (client-exposed,
  added 2026-08-04 — needed by `src/lib/vim-auth-client.ts` to build the
  authorize redirect URL browser-side). **Both need to be set as Vercel
  env vars, and `NEXT_PUBLIC_` ones specifically require a fresh
  deployment to take effect (inlined at build time).** `.env.example`
  documents all required var names (no real values).
- **Vim client_secret:** issued and configured 2026-07-31 — in
  `.env.local` and as a Vercel env var. **Gotcha hit during setup:**
  adding a Vercel env var does not retroactively apply to an
  already-running deployment — a genuinely new deployment is required
  after adding/changing one. First redeploy attempt still 500'd
  `not_configured`; a second redeploy (after confirming the var name and
  Production-environment scope in the dashboard) fixed it.
- **Token endpoint verified working, 2026-07-31:** `POST
  /api/auth/token` with a fake `{"code":"test"}` against production now
  returns `502 token_exchange_failed` — this is the *correct* result: it
  means `VIM_CLIENT_ID`/`VIM_CLIENT_SECRET` are both present and it
  successfully attempted (and Vim's real server correctly rejected) the
  exchange. A `500 not_configured` would mean the env vars are missing;
  `502` is what a fake/invalid code should produce. Only a real code from
  an actual Vim Hub launch can produce a `200` here — not yet tested,
  since app registration with Vim (the actual form, not just our infra)
  hadn't been confirmed submitted as of this note.
- **Token exchange contract** (confirmed against
  developer-docs.getvim.ai/docs/authentication, not guessed): browser
  POSTs `{code}` to our Token Endpoint; we POST
  `{grant_type: 'authorization_code', code, client_id, client_secret}` to
  `{VIM_BACKEND_URL}/app-auth/token` (`https://api.getvim.ai` prod /
  `https://api.stage.getvim.ai` staging); response is `{access_token,
  token_type, expires_in, scope}`, returned as-is to the browser.

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

**Corrected 2026-07-31 against the real installed package
(`@vimconnect/app-sdk@0.4.50`, its `dist/index.d.ts` and `dist/index.mjs`
read directly) — not just doc pages.** The original chat transfer's notes
(now in `## Architecture decisions` / git history if you look) got three
things wrong. If any future context (old scrollback, a stale summary)
repeats those three claims, this section wins — it's verified against
the actual package, not a doc skim.

Docs: https://developer-docs.getvim.ai/docs/ — this is the **new** SDK,
distinct from the legacy `docs.getvim.com` VimOS.js docs. Don't mix the two
APIs up if searching for reference material.

**1. Auth: the app must actively initiate the authorize redirect.**
**Corrected a third time, 2026-08-04, and this version is the one that's
actually been implemented and typechecked (not yet chart-verified) —
stop here if you're tempted to "simplify" this again without re-reading
it.** Two earlier versions of this note were wrong in opposite
directions: one said no server-side route was needed at all (wrong — app
registration requires one); the next said the *browser* SDK
auto-resolves a token via some `token_endpoint` query-param convention on
its own (also wrong — this was inferred from `SDKInitOptions`'s doc
comment and never actually verified, and it produced the real runtime
error below). The doc comment on `accessToken` in the SDK's own
`.d.ts` — "if omitted, the SDK will look for a token_endpoint query param
in the page URL" — describes a mechanism that, empirically, does not
resolve a token on its own. Confirmed by testing inside a real Vim
sandbox chart (`sandbox-ehr.stage.getvim.ai`) with app registration and
both env vars fully configured: `initVimSDK()` called with no
`accessToken` threw `SDKError: Failed to resolve access token: either
pass accessToken directly to init(), or configure a token_endpoint in
your app manifest` — every time, regardless of registration state.

The actual flow, confirmed against developer-docs.getvim.ai/docs/authentication
with a targeted fetch (the first fetch pass on this page missed the
authorize-initiation step entirely — ask a more specific question next
time a docs page seems to be missing something, don't assume it isn't
there):
1. Vim's Hub opens our **Launch Endpoint** with `?launch_id=...` (query
   param name confirmed as `launch_id`, doc's "Step 1: Handle the
   Launch").
2. **We** (not Vim, not the SDK) redirect the browser to `GET
   {VIM_BACKEND_URL}/app-auth/authorize` with `response_type=code`,
   `client_id`, `launch={launch_id}`, `scope=launch openid`,
   `redirect_uri`, and a CSRF-protected `state` (format
   `{launchId}:{csrfToken}` — we generate the csrfToken and stash it in
   `sessionStorage` before redirecting, since there's nowhere else to
   keep it across the navigation). See `src/lib/vim-auth-client.ts`.
3. Vim redirects back to our **`redirect_uri`** — confirmed to be
   *distinct* from Launch Endpoint, but there is **no separate
   redirect_uri field in app registration**; Dave confirmed (2026-08-04)
   it's validated against **Allowed URLs** at the origin level. We
   registered `src/app/auth/callback/page.tsx` as this path
   (`<origin>/auth/callback`), same origin as everything else, so no
   extra registration was needed beyond what's already in Allowed URLs.
4. The callback page validates `state` against the stashed
   `sessionStorage` value, then POSTs `{code}` to our own
   `/api/auth/token` (unchanged from before — this part was always
   right: server-side exchange with `{VIM_BACKEND_URL}/app-auth/token`
   using client_id + client_secret, never exposed to the browser).
5. We store the resulting `access_token` (`sessionStorage`) and call
   `initVimSDK({ accessToken })` **explicitly** — see
   `use-chart-context.ts`. This is the only thing that actually connects
   the SDK; there is no scenario in which omitting `accessToken` works.

This needs **two new client-exposed env vars** (`NEXT_PUBLIC_VIM_CLIENT_ID`,
`NEXT_PUBLIC_VIM_BACKEND_URL` — same values as their server-only
counterparts, just also readable in the browser bundle since building
the authorize URL happens client-side). `client_id` isn't secret, so this
is fine; the secret never gets a `NEXT_PUBLIC_` var. **`NEXT_PUBLIC_`
vars are inlined at build time** — same "must actually redeploy, not
just add the var" gotcha as before applies here too.

Mechanically, `initVimSDK()` still injects a `<script>` tag that loads
`https://core-sdk.getvim.ai/index.js` (a real network call to Vim's own
CDN) and waits for a postMessage handshake — that part of the earlier
notes was accurate and unaffected by this correction. `sdk.sessionContext.getIdToken()`
is a *different* thing — an OIDC ID token for SSO-ing the Vim-logged-in
user into *our own* backend, not part of this flow.

**Reference implementation:** https://github.com/vimconnect/vim-demo-app
exists and is worth diffing against *before* re-guessing at SDK/auth
behavior next time — it's what caught the bug below, faster than another
round of doc-fetching would have. It uses dedicated `/launch` and `/app`
routes (not root `/` doing double duty like ours), reads `NEXT_PUBLIC_APP_URL`
with a `window.location.origin` fallback for building URLs
(`src/lib/sdk-config.ts`), and serves the token-exchange route at both
`/token` (its stated *default* path "the SDK posts to") and a legacy
`/api/auth/token` alias — worth knowing if a future registration ever
needs the literal default path instead of a custom one like ours.

- **Bug found and fixed 2026-08-04, first real-chart test:** the
  authorize redirect failed with `{"error":"Invalid or expired launch
  ID"}` — confirmed NOT a timing issue (gap was milliseconds, not
  seconds) and NOT a manifest/`redirect_uri` issue (that produces a
  different error class). Root cause, found by diffing against
  vim-demo-app: our `useChartContext()` effect had no guard against
  running more than once, so `beginAuthorize()` could fire twice with the
  *same* `launch_id` — Vim's authorize endpoint treats it as single-use,
  so the second attempt gets rejected even though nothing was actually
  wrong with the ID. vim-demo-app's `/launch` page guards this exact
  thing with a `useRef` and the comment "Prevent duplicate redirects
  (React StrictMode runs effects twice)". Added the same `startedRef`
  guard to both `use-chart-context.ts` and `auth/callback/page.tsx`. Not
  yet re-verified inside the sandbox chart as of this note — that's the
  immediate next test.

**2. `chart_open`'s `entities.patient` is real inline data, not a bare
reference.** Confirmed from `ChartOpenEventSchema` / the shared `Patient`
type in the SDK's own `.d.ts`: the event carries `patient.problems[]`
(`{code, status, system, onSetDate, description}`, all optional),
`patient.address` (`{city, state, zipCode, address1, address2}`, all
optional), plus `demographics`, `allergies`, `insurances`, `labResults`,
`contactInfo`, `identifiers`, `pcp` — all inline, all optional (an EHR may
not populate any given field). This means Phase 4 didn't need a
`getProblems()`/`getDemographics()` follow-up call at all for what Trial
Match uses (see `use-chart-context.ts`). `sdk.ehr.api.patient.getProblems()`
still exists as a real, no-arg (context-resolved) fallback API — worth
adding *only if* a specific EHR turns out not to populate `problems`
inline on `chart_open` (not yet observed either way).
- `sdk.ehr.workflow.on(eventTypes, callback)` takes a *typed* event name
  or array (`'chart_open' | 'encounter_open' | 'referral_start' |
  'referral_save' | 'order_select' | 'order_sign'`, per `EventTypeSchema`)
  and returns an unsubscribe function directly (not a separate `.off()`
  call, though `.off()` also exists).

**3. `sdk.ehr.context.<entityType>` writeback shape** (relevant for Phase
5, confirmed now so it's not re-litigated later): `getCapability('update',
{fields?})` returns `{available: false, reason} | {available: true,
disruptive, permissionState}`; `hasPermission('update', {fields?})` is
sugar for "available && granted"; `requestPermission('update', {fields?})`
resolves `'granted' | 'denied'`; `update(data, {mode?: 'override' |
'append'})` takes a **plain nested object** — dot-notation string keys
(`'assessment.plan'`) throw `INVALID_DATA`. (Note: **no `'merge'` mode** —
only `override`/`append` are valid on the concrete writeback namespace,
despite an older generic type in the same package showing `merge` as an
option. Use `append` for Tier 1, per the writeback plan below.)

Still accurate from the original review:
- `sdk.ehr.context.onChange(key, (prev, curr) => ...)` fires continuously
  — used for gating UI state (e.g. is an encounter currently in context).
- Writeback is capability-gated per EHR: always check
  `getCapability`/`hasPermission` before attempting a write. Never assume
  a capability exists — build the UI to degrade gracefully when it
  doesn't.

## Writeback plan (Phases 5–6) — three tiers, build in this order

1. **Tier 1 — append to encounter note** (Phase 5, do this first). Lowest
   friction, works on the widest range of EHRs.
   ```ts
   const cap = sdk.ehr.context.encounter.getCapability('update');
   if (cap.available && sdk.ehr.context.encounter.hasPermission('update')) {
     await sdk.ehr.context.encounter.update(
       { plan: { generalNotes: `Clinical trial candidate: ${trial.title} (NCT${trial.nctId}) — ${trial.site}, ${trial.contactPhone}` } },
       { mode: 'append' }
     );
   }
   ```
   Field path corrected 2026-07-31: the original chat's `assessment.plan`
   doesn't exist on the real `Encounter` schema — `EncounterOpenEventSchema`
   (in the SDK's `.d.ts`) shows `encounter.plan.generalNotes` instead. Still
   worth double-checking against `getCapability('update')`'s actual
   `updatableFields` at Phase 5 time — that's the authoritative source for
   what's actually writable on a given EHR, not the entity schema alone.
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

## File manifest

```
# Phase 1 — backend
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

# Phase 2/3 — UI + wiring
src/app/layout.tsx                  Root layout, imports globals.css
src/app/globals.css                 Plain CSS, no framework — cards, badges, form controls
src/app/page.tsx                    Main page: picklist, zip, radius, search, results
src/components/TrialCard.tsx        Presentational trial card (status/phase/location/contact)

# Phase 4 — Vim SDK
src/lib/mock-data.ts                MOCK_ACTIVE_PROBLEMS only now (trial mocks removed in Phase 3)
src/lib/use-chart-context.ts        initVimSDK() + chart_open subscription, standalone fallback
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
