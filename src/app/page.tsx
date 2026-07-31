'use client';

import { useState } from 'react';
import { MOCK_ACTIVE_PROBLEMS } from '@/lib/mock-data';
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

export default function Home() {
  const [problemId, setProblemId] = useState(MOCK_ACTIVE_PROBLEMS[0].id);
  const [zip, setZip] = useState('33140');
  const [radiusMiles, setRadiusMiles] = useState(100);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'success'>('idle');
  const [results, setResults] = useState<NormalizedTrial[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedProblem = MOCK_ACTIVE_PROBLEMS.find((p) => p.id === problemId)!;

  async function handleSearch() {
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
        <p className="page-subtitle">
          Phase 3 — live search against the real ClinicalTrials.gov v2 API. Active problem list is still mocked
          (Phase 4 replaces it with the patient&rsquo;s real chart data via the Vim SDK); zip is a stand-in for the
          patient&rsquo;s address until then.
        </p>
      </header>

      <section className="search-panel">
        <label className="field">
          <span>Active problem</span>
          <select value={problemId} onChange={(e) => setProblemId(e.target.value)}>
            {MOCK_ACTIVE_PROBLEMS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Patient zip</span>
          <input
            type="text"
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            placeholder="33140"
            maxLength={10}
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

        <button className="search-btn" onClick={handleSearch} disabled={status === 'loading'}>
          {status === 'loading' ? 'Searching…' : 'Search trials'}
        </button>
      </section>

      <section className="results">
        {status === 'idle' && (
          <p className="results-empty">Select an active problem, zip, and radius, then run a search.</p>
        )}
        {status === 'loading' && <p className="results-empty">Searching ClinicalTrials.gov…</p>}
        {status === 'error' && <p className="results-error">{errorMessage}</p>}
        {status === 'success' && results.length === 0 && (
          <p className="results-empty">
            No recruiting trials found within {radiusMiles} miles for &ldquo;{selectedProblem.searchTerm}&rdquo;. Try
            expanding the radius.
          </p>
        )}
        {status === 'success' && results.length > 0 && (
          <>
            <p className="results-count">
              {results.length} matching trial{results.length > 1 ? 's' : ''}
              {totalCount > results.length && ` (of ${totalCount} total — narrow your search or expand radius for more)`}
            </p>
            <div className="trial-grid">
              {results.map((trial) => (
                <TrialCard key={trial.nctId} trial={trial} />
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
