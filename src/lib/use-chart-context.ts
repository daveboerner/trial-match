import { useEffect, useState } from 'react';
import { initVimSDK } from '@vimconnect/app-sdk';
import { MOCK_ACTIVE_PROBLEMS, type ActiveProblem } from './mock-data';

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

/**
 * Connects to the Vim SDK and tracks chart_open events. Falls back to mock
 * data (INITIAL_STATE) when there's no Vim Hub to connect to — e.g. local
 * dev, or the app opened outside a chart context — rather than treating
 * that as a fatal error.
 */
export function useChartContext(): ChartContextState {
  const [state, setState] = useState<ChartContextState>(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    (async () => {
      let sdk;
      try {
        // Short handshake timeout: a plain browser tab (no Vim Hub parent
        // frame) will never complete the handshake, so fail fast into the
        // mock/standalone fallback instead of hanging on the default 10s.
        sdk = await initVimSDK({ handshakeTimeout: 4000 });
      } catch (err) {
        console.warn('[trial-match] Vim SDK not connected — using mock patient data:', err);
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
