# Trial Match — Project Context for Claude Code

Clinical trial matching app embedded in EHR workflows via Vim Connect
(`@vimconnect/app-sdk`). A provider opens a patient chart; the app searches
ClinicalTrials.gov for trials matching a selected active problem near the
patient, and lets the provider save a match back to the encounter note.

This file is project memory — read it at the start of every session before
making changes. Update it when a phase completes or a decision changes.

## Current status

**Phases 1 through 4 are done.** Phase 4's OAuth flow, EHR capability
declaration, `chart_open` handling, and Hub activation are all working.
Getting there took a long chain of real, distinct bugs (2026-08-03 →
2026-08-05) — full blow-by-blow preserved in `VIM-OAUTH-TROUBLESHOOTING.md`
(resolved) and `VIM-SDK-BRIDGE-TROUBLESHOOTING.md` (resolved), worth
skimming before touching auth/SDK-connection code again since several
non-obvious traps are documented there (appId vs. client_id look
identical but are different fields; a stored access token must never be
reused across a new `launch_id`; `workflow.on('chart_open', ...)` misses
a patient already in context, use `context.onChange('chart_open:patient', ...)`
instead; call `sdk.hub.setActivationStatus('ENABLED')` after connecting
or the Hub shows "May not be ready" even when genuinely connected).

**The final, most stubborn symptom — intermittent `"SDK bridge
initialization failed"` and the Hub icon sometimes missing entirely —
turned out to be a local Chrome environment issue, not a bug in Trial
Match or Vim's servers at all: a second, conflicting Vim Connect
extension was active in the same Chrome profile.** Two content scripts
racing to bridge into the same EHR page explains the intermittency
exactly. Confirmed via the extension's own exported debug logs (a
genuinely useful diagnostic technique, documented in the troubleshooting
doc's "part 4," for seeing past an app-level error into what the
extension itself is doing). Disabling the conflicting extension fixed
it. `src/lib/vim-sdk-connection.ts` (the module-level connection-promise
guard) is a real, independent improvement from this investigation and
should stay regardless.

| Phase | What | Status |
|---|---|---|
| 1 | Trial-search backend (geocode, CT.gov v2 client, normalize, cache) | ✅ Done — 10 unit tests passing, typechecks clean |
| 1.5 | Live smoke test against real network | ✅ Done 2026-07-31 — see results below |
| 2 | Trial-card UI, fed by mock/fixture data, no Vim SDK | ✅ Done 2026-07-31 — see Phase 2 notes below |
| 3 | Wire real Phase 1 API into Phase 2 UI | ✅ Done 2026-07-31 — see Phase 3 notes below |
| 4 | Vim SDK: `chart_open` handler, token endpoint, hosting/registration, auth flow | ✅ Done 2026-08-05 — see `VIM-SDK-BRIDGE-TROUBLESHOOTING.md` / `VIM-OAUTH-TROUBLESHOOTING.md` for the full debugging history |
| 5 | Encounter writeback (Tier 1, adapted to `diagnoses`) | ✅ Done 2026-08-11 — "Add to chart" writes to `encounter.diagnoses` via `context.encounter.update()`; see Phase 4 notes and "Writeback plan" below |
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

## Phase 4 notes (done — see "Current status" above for the full debugging history)

### Zip: inline address is DOM-sourced and tab-dependent — fall back to getPatient() (found 2026-08-11)

`context.onChange('chart_open:patient', ...)` re-fires when the provider
switches EHR tabs (confirmed via diagnostic logging, since removed —
see git history around this date). On that re-fire, inline `address`
comes back `undefined` while `problems` (resolved via the real
`getProblems()` API call, not an inline context field) stays correct —
strongly suggesting address/zip is sourced by the extension reading the
Demographics tab's rendered DOM (matching the `dom`/`angular`/`ember`/
`backbone` detection drivers seen in the extension's own boot logs),
not a stable, tab-independent API call.

First fix attempt kept the last known-good zip client-side (a
workaround, not a real fix). **Corrected fix:** `getPatient()` is the
same no-arg, context-resolved `PatientApi` pattern as `getProblems()` —
and since `getProblems()` is empirically confirmed tab-independent,
`getPatient()` should be too. `use-chart-context.ts` now falls back to
`getPatient()` for address whenever the inline field is empty, exactly
mirroring the `getProblems()` fallback already in place for problems.
The "keep last known-good zip" logic is still there as a final
belt-and-suspenders layer only, in case `getPatient()` also somehow
lacks address for some reason — not the primary fix anymore.

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

### "resolved state" log was misleading; encounter.update() actually fails via a DOM-automation timeout (found 2026-08-11)

The `[trial-match:context] resolved state` log printed the raw
`zip`/`problems` locals *before* the sticky-fallback logic ran, so every
failed resolution logged `{zip: null, problemCount: 0}` regardless of
what state actually got committed — during a live debugging session this
made the sticky fallback (above) look broken when it may well have been
working. Fixed: the log now runs inside the `setState` callback and
prints both `rawZip`/`rawProblemCount` (pre-fallback) and `committedZip`/
`committedProblemCount` (what actually lands in state) side by side.
Lesson: don't log the ingredients of a fallback calculation as if they
were the result.

Separately, and more importantly: `sdk.ehr.context.encounter.update()`
itself is confirmed **failing outright** for this Sandbox EHR —
`{"success":false,"error":"waitForElement timed out after 3000ms —
element not found: \"body > div[style*=\"9999\"] button\""}`, seen as the
literal `.error` field of the `UpdateResult`, not stray page text.
Confirmed via `grep` that this string exists nowhere in `trial-match` or
`@vimconnect/app-sdk` — it's internal to however this Sandbox EHR
implements writeback. The shape of the error (`waitForElement`, a
`z-index: 9999` selector) strongly suggests this EHR's `update()`
performs the write by finding and clicking a real "Add diagnosis" button
in the EHR's own rendered UI (DOM automation) rather than a pure backend
call — meaning it likely requires the Assessments/diagnoses section of
the encounter to actually be open/visible in the main EHR window at the
moment `update()` is called. Our sidepanel button click has no way to
guarantee that. **Not yet confirmed**: whether opening that section first
fixes it — next test should have the Assessments panel visibly open
before clicking "Add to chart."

### `problems` had no sticky fallback; rapid context bouncing causes a second, different error (found 2026-08-11)

Dave reported still losing patient context on opening an encounter, after
the zip sticky-fallback fix — root cause was different from that earlier
fix: `resolvePatientFields`'s `setState` had `zip: zip ?? prevState.zip`
but just `problems` (no `?? prevState.problems`), so any failed/empty
resolution reset the picklist to `[]` outright, even though the zip fix
looked like it should have covered this. Fixed by mirroring the same
sticky pattern for `problems`.

Also observed in the same session: rapid, seemingly EHR/extension-side
context bouncing (`encounter_open:encounter` opening/closing/reopening
across two different encounters within seconds, `chart_open:patient`
doing the same) causes overlapping in-flight `resolvePatientFields()`
calls — a slower call for an older context can resolve after a newer one
and clobber it. Fixed with a `resolveGeneration` counter: each call
captures its generation number at start and checks it's still current
before calling `setState`, so a stale result is silently dropped instead
of applied.

During this same bouncing, `getProblems()`/`getPatient()` threw a THIRD
distinct error shape not seen before: `SDKError: No "patient" is in the
current EHR context` — a synchronous, client-side guard (thrown from
inside `SDKClient.ts`, not an async backend response), distinct from the
encounter-only 404 documented below. Not yet root-caused whether the
bouncing itself is something in our code triggering it, or purely the EHR
sandbox/extension's own polling (the extension's own console showed
`[RuntimePoll] Backend returned 400` around the same time — worth
watching for again, but nothing conclusively pins it on us). The
sticky-fallback + generation-guard fixes make this failure mode harmless
regardless of its cause, but if it keeps showing up worth a closer look.

### getPatient() 404s inside encounter-only context; real Encounter shape confirmed (found 2026-08-11)

Opening an encounter closes `chart_open:patient` (`curr -> undefined`) but
fires `encounter_open:patient`. In that encounter-only state (no
`chart_open:patient` ever fired, or already closed), `getPatient()`
returns `{success:false, statusCode:404, reason:"HTTP 404 — Not found"}`
— confirmed via full-response logging (`JSON.stringify`, not just
`{success, zip}`, since the typed `ApiResponse<T>` only declares
`{success, data}` and would have hidden this). `getProblems()` in the
same context returns `{success:true, data:[]}` instead of erroring —
ambiguous whether that's a genuinely empty list or the same resolution
gap surfacing differently.

**Conclusion: `getPatient()`/`getProblems()` resolve against a chart
context specifically, not an encounter one, even though the encounter
also carries a patient.** This is a backend/EHR constraint, not
something fixable client-side — don't try to add another fallback layer
for it. The existing `zip: zip ?? prevState.zip` sticky fallback in
`resolvePatientFields` already covers the realistic case (chart opened
at some point before the encounter); only a chart-never-opened encounter
has genuinely no zip available, and that's expected, not a bug.

This also matters for the earlier "why not just call the API directly
instead of subscribing to context" question (Dave, 2026-08-11): the
answer isn't a blanket "always call the API" — direct API resolution
itself is scoped per context type (chart vs. encounter), same as inline
fields are. `context.onChange` is still required both as the
availability/lifecycle signal *and* because which resolution path even
works depends on which context fired.

Real `encounter_open:encounter` shape (finally captured via the
JSON.stringify'd log, unblocking the Phase 5 decision below):

```json
{
  "id": "d2b6720a-217f-41f5-9a5c-179b580cf27a",
  "isSigned": "open",
  "dateOfService": "2026-07-28",
  "cc": "Diabetes follow-up — blood sugar control",
  "type": "follow_up",
  "diagnoses": [{"code": "E11.9", "description": "Type 2 Diabetes Mellitus, without complications"}],
  "identifiers": {"ehrEncounterId": "..."},
  "provider": {"firstName": "Sarah", "lastName": "Chen"}
}
```

`diagnoses: [{code, description}]` matches
`manifest.contextWriteback.encounter.update.updatableFields` (`diagnoses`,
`billingInformation.procedureCodes`) — see "Writeback plan" section below.
No notes/plan/free-text field exists on this entity at all, writable or
not — `cc` is present but not in the writable-fields list.

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
- **Vim client_id — corrected 2026-08-04, this was a real, multi-day bug:**
  the actual OAuth `client_id` is `vim_bd726f3119d1041971c7d7364baee74f`.
  `305d7d2a-7f7b-45ae-83db-75c70071d75b` (used everywhere before this
  correction, including in commit history and the now-stale
  `VIM-OAUTH-TROUBLESHOOTING.md`) is the app's **appId** — a different
  identifier, shown in the same console UI, easy to grab by mistake since
  nothing in the console visually distinguishes which field is which at a
  glance. **`appId` is not `client_id`.** Sending the appId as `client_id`
  in the `/app-auth/authorize` call is why the entire multi-day
  `redirect_uri not authorized for this client` investigation went
  nowhere — Vim's auth service was correctly rejecting it: that "client"
  (the appId, misread as a client_id) was never configured with our
  redirect_uri, no matter how exactly the real app's Allowed URLs matched.
  If a future session sees any client_id-shaped value starting with a
  bare UUID (no `vim_` prefix) anywhere in this OAuth flow, **stop and
  double check it's not the appId again.**
  In `.env.local` (gitignored) as both `VIM_CLIENT_ID` (server-only, used
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

- **`{"error":"Invalid or expired launch ID"}` — hit twice, two different
  causes, both real. Don't assume it's fixed just because the error looks
  identical to before; check which of these actually applies.**
  1. First real-chart test, 2026-08-04: confirmed NOT a timing issue (gap
     was milliseconds) and NOT a manifest/`redirect_uri` issue (different
     error class). Root cause, found by diffing against vim-demo-app: our
     `useChartContext()` effect had no guard against running more than
     once, so `beginAuthorize()` could fire twice with the *same*
     `launch_id` — Vim's authorize endpoint treats it as single-use, so a
     second attempt gets rejected even though nothing was wrong with the
     ID. vim-demo-app's `/launch` page guards this exact thing with a
     `useRef` ("Prevent duplicate redirects — React StrictMode runs
     effects twice"). Added the same `startedRef` guard to both
     `use-chart-context.ts` and `auth/callback/page.tsx` — this is a
     real, legitimate fix, keep it, but **it was not the cause of the
     second occurrence below.**
  2. Same error persisted after that fix. Re-tested with DevTools
     "Preserve log" enabled specifically to rule the double-fire theory
     in or out definitively — confirmed genuinely **one** `launches`
     call, **one** `?launch_id=...` page load, **one** `authorize` call.
     No duplication at all. Actual cause: checked the `launches`
     request's `:authority` request header — `api.stage.getvim.ai`. The
     sandbox (`sandbox-ehr.stage.getvim.ai`) issues `launch_id`s via
     Vim's **staging** backend, but `VIM_BACKEND_URL` /
     `NEXT_PUBLIC_VIM_BACKEND_URL` were both set to **production**
     (`api.getvim.ai`) — production has no record of a staging-issued
     `launch_id`, so it correctly rejects it as invalid. Fixed by
     pointing both env vars at `https://api.stage.getvim.ai` (`.env.local`,
     Vercel env vars — see `.env.example` for the updated default/comment).
     **This isn't environment-aware** — if this app is ever tested against
     a *production* EHR, these need to be flipped back (or, better, made
     to switch automatically based on hostname/config the way
     vim-demo-app's `getEnvironment()`/`getVimBackendUrl()` do — see the
     reference-repo note above). Don't relitigate the double-invoke fix
     if this error resurfaces — check the backend-URL/environment match
     *first*, it's the more likely culprit of the two now.

**2. `chart_open`'s `entities.patient` is real inline data, not a bare
reference.** Confirmed from `ChartOpenEventSchema` / the shared `Patient`
type in the SDK's own `.d.ts`: the event carries `patient.problems[]`
(`{code, status, system, onSetDate, description}`, all optional),
`patient.address` (`{city, state, zipCode, address1, address2}`, all
optional), plus `demographics`, `allergies`, `insurances`, `labResults`,
`contactInfo`, `identifiers`, `pcp` — all inline, all optional (an EHR may
not populate any given field). **Confirmed 2026-08-11 against the real
Sandbox EHR: it does NOT populate `problems` inline** — it was
consistently `undefined` while `address.zipCode` came through fine on
the same event. `use-chart-context.ts` now calls
`sdk.ehr.api.patient.getProblems()` (no-arg, context-resolved) as a
fallback whenever the inline field is empty. Still unverified: whether
any *other* EHR actually does populate `problems` inline — the fallback
is written to prefer the inline value when present, so that case should
still work without the extra round-trip, but hasn't been observed either.
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

   **Confirmed 2026-08-11 against the real Sandbox EHR: Tier 1 as written
   above does not work here.** `manifest.contextWriteback.encounter.update
   .updatableFields` is only `['diagnoses', 'billingInformation
   .procedureCodes']` — no `plan.generalNotes`, no notes/free-text field of
   any kind. The real `encounter_open:encounter` shape (see Phase 4 notes
   above) confirms this: `diagnoses` is `[{code, description}]`, nothing
   resembling a notes field exists on the entity at all for this EHR.

   **Dave's decision: write into `diagnoses` anyway**, accepting the
   semantic mismatch (a trial match isn't a diagnosis) rather than fall
   back to Tier 3 for this EHR. Implemented in `use-chart-context.ts`'s
   `addTrialToEncounter()`: `encounter.update({ diagnoses: [{ description:
   ... }] }, { mode: 'append' })`, gated by `getCapability`/`hasPermission`/
   `requestPermission('update', { fields: ['diagnoses'] })` first. Wired to
   the "Add to chart" button in `TrialCard.tsx`, enabled only while
   `encounterOpen` is true (tracked via the `encounter_open:encounter`
   subscription in `use-chart-context.ts`). Tier 1 stays correct as
   *written* above for EHRs that do expose a notes field — don't delete it,
   it's just not what actually shipped for this EHR.
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
