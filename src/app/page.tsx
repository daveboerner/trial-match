'use client';

import { useEffect, useState } from 'react';
import { useChartContext } from '@/lib/use-chart-context';
import { TrialCard } from '@/components/TrialCard';
import type { NormalizedTrial, TrialSearchResponse } from '@/types/trial';

const RADIUS_OPTIONS = [25, 50, 100, 250, 500];

const ERROR_MESSAGES: Record<string, string> = {
  validation_error: 'That search isn’t valid — check the zip code and radius.',
  geocode_failed: 'Could not find that zip code. Double-check it and try again.',
  trial_search_upstream_failed: 'ClinicalTrials.gov is temporarily unavailable. Try again in a moment.',
  invalid_json: 'Something went wrong sending the search. Try again.',
  internal_error: 'Something went wrong. Try again.',
};

const SUBTITLE_BY_STATUS = {
  standalone:
    'Not connected to a Vim chart (local dev) — using a mock active-problem list and a manual zip field.',
  'waiting-for-chart': 'Connected to Vim — waiting for a patient chart to open.',
  'chart-ready': 'Connected to a live patient chart via Vim.',
};

export default function Home() {
  const chart = useChartContext();
  const [problemId, setProblemId] = useState<string | null>(null);
  const [manualZip, setManualZip] = useState('33140');
  const [radiusMiles, setRadiusMiles] = useState(100);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'success'>('idle');
  const [results, setResults] = useState<NormalizedTrial[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset the selection whenever the available problem list changes (e.g.
  // standalone mock list -> real chart-ready list) so a stale id from the
  // previous list can't linger.
  useEffect(() => {
    setProblemId(null);
  }, [chart.status]);

  const selectedProblem = chart.problems.find((p) => p.id === problemId) ?? chart.problems[0] ?? null;
  const zip = chart.status === 'chart-ready' ? chart.zip : manualZip;
  const canSearch = Boolean(selectedProblem && zip) && status !== 'loading';

  async function handleSearch() {
    if (!selectedProblem || !zip) return;
    setStatus('loading');
    setErrorMessage(null);

    try {
      const res = await fetch('/api/trial-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conditions: [selectedProblem.searchTerm],
          zip,
          radiusMiles,
        }),
      });

      const body = await res.json();

      if (!res.ok) {
        setErrorMessage(body.message || ERROR_MESSAGES[body.error] || ERROR_MESSAGES.internal_error);
        setStatus('error');
        return;
      }

      const data = body as TrialSearchResponse;
      setResults(data.trials);
      setTotalCount(data.totalCount);
      setStatus('success');
    } catch {
      setErrorMessage(ERROR_MESSAGES.internal_error);
      setStatus('error');
    }
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>Trial Match</h1>
        <p className="page-subtitle">{SUBTITLE_BY_STATUS[chart.status]}</p>
      </header>

      {chart.status === 'waiting-for-chart' ? (
        <p className="results-empty">Waiting for a patient chart to open in your EHR…</p>
      ) : (
        <>
          <section className="search-panel">
            <label className="field">
              <span>Active problem</span>
              {chart.problems.length > 0 ? (
                <select value={selectedProblem?.id ?? ''} onChange={(e) => setProblemId(e.target.value)}>
                  {chart.problems.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              ) : (
                <select disabled>
                  <option>No active problems on this chart</option>
                </select>
              )}
            </label>

            <label className="field">
              <span>Patient zip</span>
              <input
                type="text"
                value={zip ?? ''}
                onChange={(e) => setManualZip(e.target.value)}
                placeholder="33140"
                maxLength={10}
                readOnly={chart.status === 'chart-ready'}
              />
            </label>

            <label className="field">
              <span>Radius</span>
              <select value={radiusMiles} onChange={(e) => setRadiusMiles(Number(e.target.value))}>
                {RADIUS_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r} miles
                  </option>
                ))}
              </select>
            </label>

            <button className="search-btn" onClick={handleSearch} disabled={!canSearch}>
              {status === 'loading' ? 'Searching…' : 'Search trials'}
            </button>
          </section>

          <section className="results">
            {status === 'idle' && !zip && (
              <p className="results-empty">
                No zip code available for this patient chart, so a search can&rsquo;t run yet.
              </p>
            )}
            {status === 'idle' && zip && (
              <p className="results-empty">Select an active problem and radius, then run a search.</p>
            )}
            {status === 'loading' && <p className="results-empty">Searching ClinicalTrials.gov…</p>}
            {status === 'error' && <p className="results-error">{errorMessage}</p>}
            {status === 'success' && results.length === 0 && (
              <p className="results-empty">
                No recruiting trials found within {radiusMiles} miles for &ldquo;{selectedProblem?.searchTerm}&rdquo;.
                Try expanding the radius.
              </p>
            )}
            {status === 'success' && results.length > 0 && (
              <>
                <p className="results-count">
                  {results.length} matching trial{results.length > 1 ? 's' : ''}
                  {totalCount > results.length &&
                    ` (of ${totalCount} total — narrow your search or expand radius for more)`}
                </p>
                <div className="trial-grid">
                  {results.map((trial) => (
                    <TrialCard
                      key={trial.nctId}
                      trial={trial}
                      encounterOpen={chart.encounterOpen}
                      addTrialToEncounter={chart.addTrialToEncounter}
                    />
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}
