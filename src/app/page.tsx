'use client';

import { useState } from 'react';
import { MOCK_ACTIVE_PROBLEMS, MOCK_TRIALS_BY_CONDITION } from '@/lib/mock-data';
import { TrialCard } from '@/components/TrialCard';
import type { NormalizedTrial } from '@/types/trial';

const RADIUS_OPTIONS = [25, 50, 100, 250, 500];

/** Mimics the backend's radius filter + nearest-location recompute (see src/lib/search-trials.ts, normalize.ts). */
function filterByRadius(trials: NormalizedTrial[], radiusMiles: number): NormalizedTrial[] {
  const filtered: NormalizedTrial[] = [];
  for (const trial of trials) {
    const inRange = trial.nearbyLocations.filter(
      (loc) => typeof loc.distanceMiles !== 'number' || loc.distanceMiles <= radiusMiles
    );
    if (inRange.length === 0) continue;
    filtered.push({ ...trial, nearbyLocations: inRange, nearestLocation: inRange[0] });
  }
  return filtered;
}

export default function Home() {
  const [problemId, setProblemId] = useState(MOCK_ACTIVE_PROBLEMS[0].id);
  const [radiusMiles, setRadiusMiles] = useState(100);
  const [results, setResults] = useState<NormalizedTrial[] | null>(null);

  const selectedProblem = MOCK_ACTIVE_PROBLEMS.find((p) => p.id === problemId)!;

  function handleSearch() {
    const trials = MOCK_TRIALS_BY_CONDITION[selectedProblem.searchTerm] ?? [];
    setResults(filterByRadius(trials, radiusMiles));
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>Trial Match</h1>
        <p className="page-subtitle">
          Phase 2 UI — running on static mock data, no live ClinicalTrials.gov call and no Vim SDK connection yet.
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
          <span>Radius</span>
          <select value={radiusMiles} onChange={(e) => setRadiusMiles(Number(e.target.value))}>
            {RADIUS_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r} miles
              </option>
            ))}
          </select>
        </label>

        <button className="search-btn" onClick={handleSearch}>
          Search trials
        </button>
      </section>

      <section className="results">
        {results === null && (
          <p className="results-empty">Select an active problem and radius, then run a search.</p>
        )}
        {results !== null && results.length === 0 && (
          <p className="results-empty">
            No recruiting trials found within {radiusMiles} miles for &ldquo;{selectedProblem.searchTerm}&rdquo;. Try
            expanding the radius.
          </p>
        )}
        {results !== null && results.length > 0 && (
          <>
            <p className="results-count">{results.length} matching trial{results.length > 1 ? 's' : ''}</p>
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
