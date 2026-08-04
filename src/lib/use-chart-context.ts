import { useEffect, useRef, useState } from 'react';
import { initVimSDK } from '@vimconnect/app-sdk';
import { MOCK_ACTIVE_PROBLEMS, type ActiveProblem } from './mock-data';
import { beginAuthorize, getStoredAccessToken } from './vim-auth-client';

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

// initVimSDK() loads a core-sdk script that defaults to PRODUCTION
// (core-sdk.getvim.ai) regardless of our own VIM_BACKEND_URL — that only
// controls where WE send our own authorize/token calls, not which
// environment the SDK itself validates access tokens against. A
// staging-issued token handed to production's core-sdk fails with
// "Access token validation failed". `__overrideEnv` is an internal,
// undocumented SDKInitOptions field (confirmed via the vim-demo-app
// reference, which does exactly this) — not in the public type, hence the cast.
const IS_STAGING_BACKEND = (process.env.NEXT_PUBLIC_VIM_BACKEND_URL ?? '').includes('stage');

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

    (async () => {
      let sdk;
      try {
        sdk = await initVimSDK({
          accessToken,
          ...(IS_STAGING_BACKEND ? { __overrideEnv: 'staging' } : {}),
        } as Parameters<typeof initVimSDK>[0] & { __overrideEnv?: 'staging' });
      } catch (err) {
        console.warn('[trial-match] Vim SDK failed to connect with stored access token:', err);
        return;
      }
      if (cancelled) return;

      setState({ status: 'waiting-for-chart', problems: [], zip: null });

      unsubscribe = sdk.ehr.workflow.on('chart_open', (event) => {
        const patient = event.entities.patient;
        const problems: ActiveProblem[] = (patient.problems ?? [])
          .filter((p) => p.description && isActiveStatus(p.status))
          .map((p, i) => ({
            id: p.code ?? `problem-${i}`,
            label: p.description as string,
            searchTerm: p.description as string,
          }));

        setState({
          status: 'chart-ready',
          problems,
          zip: patient.address?.zipCode ?? null,
        });
      });
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return state;
}
