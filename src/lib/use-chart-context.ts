import { useEffect, useRef, useState } from 'react';
import type { VimSDK } from '@vimconnect/app-sdk';
import { MOCK_ACTIVE_PROBLEMS, type ActiveProblem } from './mock-data';
import { beginAuthorize, getStoredAccessToken } from './vim-auth-client';
import { connectVimSDKOnce } from './vim-sdk-connection';

export type ChartStatus = 'standalone' | 'waiting-for-chart' | 'chart-ready';

export interface ChartContextState {
  status: ChartStatus;
  /** Active-problem picklist. Mock data in 'standalone', real chart data in 'chart-ready'. */
  problems: ActiveProblem[];
  /** Patient zip, sourced from the chart_open event. Null until 'chart-ready' (or if the EHR doesn't supply it). */
  zip: string | null;
}

// `problems[].status` has no fixed enum in the SDK — it's passed through verbatim
// from whatever the source EHR sends. This is a best-effort filter, not a verified
// contract; see CLAUDE.md Phase 4 notes.
const INACTIVE_STATUSES = new Set(['resolved', 'inactive', 'remission', 'ruled_out', 'ruled out']);

function isActiveStatus(status?: string): boolean {
  return !status || !INACTIVE_STATUSES.has(status.toLowerCase());
}

const INITIAL_STATE: ChartContextState = {
  status: 'standalone',
  problems: MOCK_ACTIVE_PROBLEMS,
  zip: null,
};

// Tried __overrideEnv: 'staging' here (2026-08-04) to force the core-sdk
// script to core-sdk.stage.getvim.ai, believing "Access token validation
// failed" meant a staging token was being checked against production's
// core-sdk. REMOVED again the same day: that original error very plausibly
// had the same root cause as the later "Launch ID mismatch" bug (a stale,
// wrong-launch token being reused) rather than a real environment mismatch
// — and the override itself started producing a NEW error, "SDK bridge
// initialization failed", with a freshly-obtained, correctly-scoped token.
// See CLAUDE.md Phase 4 notes before reintroducing this.

/**
 * Connects to the Vim SDK and tracks chart_open events. Three cases on mount:
 *  - We already have a stored access token (from a completed authorize
 *    round-trip) -> initVimSDK({ accessToken }) and subscribe for real.
 *  - No token, but the URL has ?launch_id=... (Vim just opened us) -> kick
 *    off the authorize redirect (src/lib/vim-auth-client.ts); this navigates
 *    away, so nothing else here runs.
 *  - Neither -> not launched by Vim at all (local dev) -> stay on the
 *    mock/standalone default (INITIAL_STATE).
 */
export function useChartContext(): ChartContextState {
  const [state, setState] = useState<ChartContextState>(INITIAL_STATE);
  // Holds the connected SDK for window.__trialMatchSdk (debug hook, see below).
  const sdkRef = useRef<VimSDK | null>(null);
  // Guards against the effect running more than once for the same mount
  // (React can double-invoke effects). Without this, beginAuthorize() would
  // fire twice with the same launch_id — Vim's authorize endpoint treats a
  // launch_id as single-use, so the second attempt gets rejected as
  // "invalid or expired launch ID" even though nothing was actually wrong
  // with it. Confirmed against the reference vim-demo-app, which guards the
  // same way for the same stated reason.
  const startedRef = useRef(false);

  // Encounter writeback via `diagnoses` (Dave's initial choice, 2026-08-11)
  // turned out to be a structural dead end, not just awkward — confirmed
  // live: the write mechanism does a real ICD-10 code lookup and overwrites
  // `description` with the code's canonical clinical name, so custom trial
  // text never lands anywhere, and no other writable field exists on this
  // EHR's encounter (see CLAUDE.md Phase 4 notes). Removed the
  // addTrialToEncounter()/encounterOpen machinery that supported it —
  // "Add to chart" is now Tier 3 (copy-to-clipboard) in TrialCard.tsx,
  // which needs no SDK/encounter state at all. sdkRef/window.__trialMatchSdk
  // stay as a general debug hook, independent of this removed feature.

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const launchId = new URLSearchParams(window.location.search).get('launch_id');

    // A launch_id in the URL means Vim just opened us for a fresh launch —
    // always re-authorize for it, even if we already have a stored access
    // token from a previous launch. Access tokens are scoped to the launch
    // they were issued for; reusing an old one against a new launch_id gets
    // rejected by Vim's Hub as "Launch ID mismatch" (hit this for real
    // 2026-08-04 — re-opening the panel/switching charts generates a new
    // launch_id, and the previous session's cached token doesn't match it).
    if (launchId) {
      beginAuthorize(launchId);
      return;
    }

    // No launch_id — either a stored token from completing the authorize
    // round-trip moments ago (the common case, landing back on bare `/`
    // after auth/callback), or truly no Vim context at all (local dev).
    const accessToken = getStoredAccessToken();
    if (!accessToken) {
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let unsubEncounter: (() => void) | undefined;
    let unsubEncounterPatient: (() => void) | undefined;
    let resetTimer: ReturnType<typeof setTimeout> | undefined;

    (async () => {
      let sdk: VimSDK;
      try {
        sdk = await connectVimSDKOnce(accessToken);
      } catch (err) {
        console.warn('[trial-match] Vim SDK failed to connect with stored access token:', err);
        return;
      }
      if (cancelled) return;
      sdkRef.current = sdk;
      // Debug hook so a raw sdk.ehr.context.encounter.update() can be run
      // directly from the console, decoupled from our own encounterOpen
      // gating/state — useful for isolating whether a writeback failure is
      // an EHR/extension-side limitation or something in our own call path.
      // Kept permanently, same reasoning as the manifest log above.
      if (typeof window !== 'undefined') {
        (window as unknown as { __trialMatchSdk?: VimSDK }).__trialMatchSdk = sdk;
      }

      // Tells the Hub we're actually ready — without this it shows a "May
      // not be ready" status even once the SDK has genuinely connected
      // (confirmed 2026-08-05: this exact symptom, in the real sandbox).
      // Part of the official quick-start guide's Step 5, which we'd missed.
      sdk.hub.setActivationStatus('ENABLED');
      console.log('[trial-match] SDK connected');

      // Kept permanently (not just temp debug) — Dave found this genuinely
      // useful for seeing what's actually in context/available during
      // real-sandbox testing, not just when actively chasing a bug.
      // contextWriteback here specifically is what Phase 5 (encounter
      // writeback) needs to know which fields are actually writable for
      // this EHR before assuming a field path — don't hardcode one without
      // checking this first.
      const manifest = sdk.ehr.getManifest();
      console.log('[trial-match] manifest', {
        supportedEvents: manifest.supportedEvents?.map((e) => e.id),
        supportedContexts: manifest.supportedContexts?.map((c) => c.contextKey),
        contextWriteback: manifest.contextWriteback,
      });

      setState({ status: 'waiting-for-chart', problems: [], zip: null });

      // Two separate patient contexts can each carry the patient — chart_open:
      // patient while just a chart is open, encounter_open:patient once an
      // encounter is opened. Confirmed live 2026-08-11: opening an encounter
      // closes chart_open:patient entirely (curr -> undefined). Tracking both
      // independently and only falling back to 'waiting-for-chart' when
      // NEITHER is active avoids resetting the whole picklist/zip on that
      // transition (there's still a brief flicker possible depending on
      // event ordering, but no lasting reset).
      let hasChartPatient = false;
      let hasEncounterPatient = false;

      // Debounced, not immediate. Confirmed 2026-08-11 against the real
      // Sandbox EHR: chart_open:patient closing and encounter_open:patient
      // opening for what is, from the provider's perspective, one
      // continuous "still looking at this patient" transition are NOT
      // atomic — chart_open:patient's close callback fires and
      // hasChartPatient goes false BEFORE encounter_open:patient's open
      // callback has run, so a synchronous check here sees both flags
      // false and wipes state, even though the encounter's patient context
      // is only milliseconds away from becoming active. Waiting briefly and
      // re-reading the (closure-captured, mutable) flags — not a stale
      // snapshot — before actually resetting closes that gap without
      // masking a genuine "no patient anywhere" state, which still resets
      // correctly once the delay elapses.
      function maybeResetToWaiting() {
        if (resetTimer) clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
          if (!hasChartPatient && !hasEncounterPatient) {
            setState({ status: 'waiting-for-chart', problems: [], zip: null });
          }
        }, 500);
      }

      // Shared by both chart_open:patient and encounter_open:patient — same
      // data shape (TypedContextData<Patient>), same fallback needs. context
      // subscriptions sync with the *current* state immediately on
      // subscribing (unlike workflow.on('chart_open', ...), which is a
      // one-shot trigger for the *next* open and would miss a patient already
      // in context — hit this for real 2026-08-05).
      //
      // Confirmed 2026-08-11 against the real Sandbox EHR: inline `problems`
      // is never populated (this EHR needs the dedicated getProblems() API
      // instead), and inline `address` disappears specifically when
      // navigating off the Demographics tab (looks DOM-sourced, not a stable
      // API) — falls back to getPatient(), the same no-arg/context-resolved
      // pattern as getProblems(), which is empirically tab-independent.
      //
      // REVERTED 2026-08-11 (same day introduced): a generation counter used
      // to gate this — discard any call whose generation didn't match the
      // most-recently-DISPATCHED one, to guard against rapid encounter
      // bouncing. That was backwards for a different, more common case:
      // chart_open:patient re-fires on ordinary tab navigation (documented
      // above), and each re-fire's getProblems()/getPatient() round trip
      // through the extension bridge can complete out of dispatch order.
      // "Most recently dispatched" is not the same as "most correct" —
      // confirmed live: a slower call with the CORRECT 2-problem list was
      // getting discarded as "stale" because a later, redundant re-fire's
      // call happened to fail/return-empty and complete first, and THAT
      // empty result won purely by finishing last. Since getProblems()/
      // getPatient() are context-resolved (no id param) rather than tied to
      // whichever event triggered them, a "stale" call isn't resolving
      // wrong-patient data — the sticky fallback below (never let empty
      // clobber non-empty) is sufficient protection on its own, and doesn't
      // have this ordering flaw. Only `cancelled` (unmount) still gates.
      async function resolvePatientFields(fields: {
        problems?: { code?: string; status?: string; description?: string }[];
        address?: { zipCode?: string };
      }) {
        let rawProblems = fields.problems;
        if (!rawProblems || rawProblems.length === 0) {
          try {
            const res = await sdk.ehr.api.patient.getProblems();
            // Full response, not just {success, count} — the TS type only
            // declares {success, data}, but a failure may carry an untyped
            // error/message field at runtime that the type doesn't surface
            // (same lesson as the encounter shape: don't trust the type over
            // what's actually on the wire). JSON.stringify so it pastes fully.
            console.log('[trial-match:getProblems] fallback result', JSON.stringify(res));
            if (res.success) {
              rawProblems = res.data;
            }
          } catch (err) {
            console.warn('[trial-match:getProblems] fallback threw', err);
          }
        }

        let zip = fields.address?.zipCode ?? null;
        if (!zip) {
          try {
            const res = await sdk.ehr.api.patient.getPatient();
            // Full response — see getProblems() comment above. Confirmed
            // 2026-08-11 against the real Sandbox EHR: this 404s
            // ({success:false, statusCode:404}) when only
            // encounter_open:patient is active with no chart_open:patient —
            // getPatient() resolves against a chart context specifically,
            // not an encounter one, even though the encounter carries a
            // patient too. Not fixable client-side; the `zip ?? prevState.zip`
            // fallback below covers the common case (chart opened before the
            // encounter). Only a genuinely chart-never-opened encounter has
            // no zip available at all.
            console.log('[trial-match:getPatient] fallback result', JSON.stringify(res));
            if (res.success) {
              zip = res.data.address?.zipCode ?? null;
            }
          } catch (err) {
            console.warn('[trial-match:getPatient] fallback threw', err);
          }
        }
        if (cancelled) return;

        const problems: ActiveProblem[] = (rawProblems ?? [])
          .filter((p) => p.description && isActiveStatus(p.status))
          .map((p, i) => ({
            id: p.code ?? `problem-${i}`,
            label: p.description as string,
            searchTerm: p.description as string,
          }));

        // Sticky fallback for BOTH fields, not just zip: confirmed 2026-08-11
        // this EHR can throw ("No patient is in the current EHR context")
        // rather than cleanly returning empty/success:false when a
        // fast-moving context transition catches getProblems()/getPatient()
        // between states. Without this, `problems` silently reset to `[]`
        // on every such failure even though the patient's actual problem
        // list hadn't changed — that's what looked like "losing patient
        // context" when opening an encounter. Same reasoning as zip: the
        // data hasn't changed just because this particular call couldn't
        // resolve it, so don't regress a known-good list to empty.
        setState((prevState) => {
          const resolved = {
            status: 'chart-ready' as const,
            problems: problems.length > 0 ? problems : prevState.problems,
            zip: zip ?? prevState.zip,
          };
          // Log the state actually committed, not the raw pre-fallback
          // `zip`/`problems` locals — logging those directly (as this line
          // used to) reads as "still losing context" even when the sticky
          // fallback above is correctly preserving the old values, since a
          // failed resolve always has raw zip:null/problems:[] regardless of
          // what ends up on screen. Confirmed 2026-08-11 this was actively
          // misleading during a real debugging session with Dave.
          console.log('[trial-match:context] resolved state', {
            rawZip: zip,
            rawProblemCount: problems.length,
            committedZip: resolved.zip,
            committedProblemCount: resolved.problems.length,
          });
          return resolved;
        });
      }

      unsubscribe = sdk.ehr.context.onChange('chart_open:patient', async (prev, curr) => {
        console.log('[trial-match:context] chart_open:patient changed', {
          hadPrev: !!prev,
          hasCurr: !!curr,
          inlineAddress: curr?.fields?.address,
          inlineProblemsCount: curr?.fields?.problems?.length,
        });
        hasChartPatient = !!curr;
        if (!curr) {
          maybeResetToWaiting();
          return;
        }
        await resolvePatientFields(curr.fields);
      });

      // The Encounter shape here is what Phase 5 (writeback) needs —
      // cross-reference against manifest.contextWriteback's updatableFields
      // (confirmed for this EHR: encounter.update only allows `diagnoses`
      // and `billingInformation.procedureCodes`, no notes/plan field at all).
      // JSON.stringify so the full contents show in copy-pasted console
      // output — an unexpanded object reference pastes as "{...}", useless.
      unsubEncounter = sdk.ehr.context.onChange('encounter_open:encounter', (prev, curr) => {
        console.log(
          '[trial-match:context] encounter_open:encounter changed',
          JSON.stringify({ hadPrev: !!prev, hasCurr: !!curr, fields: curr?.fields })
        );
      });

      unsubEncounterPatient = sdk.ehr.context.onChange('encounter_open:patient', async (prev, curr) => {
        console.log('[trial-match:context] encounter_open:patient changed', {
          hadPrev: !!prev,
          hasCurr: !!curr,
          inlineAddress: curr?.fields?.address,
          inlineProblemsCount: curr?.fields?.problems?.length,
        });
        hasEncounterPatient = !!curr;
        if (!curr) {
          maybeResetToWaiting();
          return;
        }
        await resolvePatientFields(curr.fields);
      });
    })();

    return () => {
      cancelled = true;
      if (resetTimer) clearTimeout(resetTimer);
      unsubscribe?.();
      unsubEncounter?.();
      unsubEncounterPatient?.();
    };
  }, []);

  return state;
}
