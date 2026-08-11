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
  // Guards against the effect running more than once for the same mount
  // (React can double-invoke effects). Without this, beginAuthorize() would
  // fire twice with the same launch_id — Vim's authorize endpoint treats a
  // launch_id as single-use, so the second attempt gets rejected as
  // "invalid or expired launch ID" even though nothing was actually wrong
  // with it. Confirmed against the reference vim-demo-app, which guards the
  // same way for the same stated reason.
  const startedRef = useRef(false);

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

    (async () => {
      let sdk: VimSDK;
      try {
        sdk = await connectVimSDKOnce(accessToken);
      } catch (err) {
        console.warn('[trial-match] Vim SDK failed to connect with stored access token:', err);
        return;
      }
      if (cancelled) return;

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

      function maybeResetToWaiting() {
        if (!hasChartPatient && !hasEncounterPatient) {
          setState({ status: 'waiting-for-chart', problems: [], zip: null });
        }
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

        console.log('[trial-match:context] resolved state', { zip, problemCount: problems.length });

        // Belt-and-suspenders: if getPatient() somehow also comes back
        // without an address, keep the last known-good zip rather than
        // regressing to null — the patient's zip hasn't actually changed.
        setState((prevState) => ({
          status: 'chart-ready',
          problems,
          zip: zip ?? prevState.zip,
        }));
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
      unsubscribe?.();
      unsubEncounter?.();
      unsubEncounterPatient?.();
    };
  }, []);

  return state;
}
