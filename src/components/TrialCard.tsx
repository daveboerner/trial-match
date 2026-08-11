import { useState } from 'react';
import type { NormalizedTrial } from '@/types/trial';
import type { WritebackResult } from '@/lib/use-chart-context';

const STATUS_LABEL: Record<string, string> = {
  RECRUITING: 'Recruiting',
  ACTIVE_NOT_RECRUITING: 'Active, not recruiting',
  NOT_YET_RECRUITING: 'Not yet recruiting',
  COMPLETED: 'Completed',
  WITHDRAWN: 'Withdrawn',
};

function statusClass(status: string): string {
  switch (status) {
    case 'RECRUITING':
      return 'status-badge status-recruiting';
    case 'ACTIVE_NOT_RECRUITING':
      return 'status-badge status-active';
    case 'NOT_YET_RECRUITING':
      return 'status-badge status-pending';
    case 'WITHDRAWN':
      return 'status-badge status-withdrawn';
    default:
      return 'status-badge status-default';
  }
}

function formatPhases(phases: string[]): string | null {
  if (phases.length === 0) return null;
  return phases.map((p) => p.replace('PHASE', 'Phase ')).join(', ');
}

interface TrialCardProps {
  trial: NormalizedTrial;
  encounterOpen: boolean;
  addTrialToEncounter: (trial: { nctId: string; title: string; url: string }) => Promise<WritebackResult>;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function TrialCard({ trial, encounterOpen, addTrialToEncounter }: TrialCardProps) {
  const location = trial.nearestLocation;
  const otherCount = trial.nearbyLocations.length - (location ? 1 : 0);
  const phaseLabel = formatPhases(trial.phases);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleAddToChart() {
    setSaveState('saving');
    setSaveError(null);
    const result = await addTrialToEncounter(trial);
    if (result.success) {
      setSaveState('saved');
    } else {
      setSaveState('error');
      setSaveError(result.error ?? 'Failed to add to chart');
    }
  }

  return (
    <article className="trial-card">
      <header className="trial-card-header">
        <h3>
          <a href={trial.url} target="_blank" rel="noreferrer">
            {trial.title}
          </a>
        </h3>
        {trial.acronym && <span className="trial-acronym">{trial.acronym}</span>}
      </header>

      <div className="trial-meta">
        <span className={statusClass(trial.status)}>{STATUS_LABEL[trial.status] ?? trial.status}</span>
        {phaseLabel && <span className="trial-tag">{phaseLabel}</span>}
        {trial.studyType && <span className="trial-tag">{trial.studyType.toLowerCase()}</span>}
      </div>

      {trial.sponsor && <p className="trial-sponsor">Sponsor: {trial.sponsor}</p>}
      <p className="trial-matched">Matched on: {trial.matchedCondition}</p>

      {location ? (
        <div className="trial-location">
          <div className="trial-location-main">
            <strong>{location.facility ?? 'Site location'}</strong>
            <span>
              {[location.city, location.state].filter(Boolean).join(', ')}
              {typeof location.distanceMiles === 'number' && ` · ${location.distanceMiles.toFixed(1)} mi`}
            </span>
          </div>
          {(location.phone || location.email) && (
            <div className="trial-location-contact">
              {location.name && <span>{location.name}</span>}
              {location.phone && <span>{location.phone}</span>}
              {location.email && <span>{location.email}</span>}
            </div>
          )}
        </div>
      ) : (
        trial.centralContact && (
          <div className="trial-location">
            <div className="trial-location-contact">
              <span>{trial.centralContact.name}</span>
              {trial.centralContact.phone && <span>{trial.centralContact.phone}</span>}
              {trial.centralContact.email && <span>{trial.centralContact.email}</span>}
            </div>
          </div>
        )
      )}

      {otherCount > 0 && (
        <details className="trial-nearby">
          <summary>{otherCount} more nearby location{otherCount > 1 ? 's' : ''}</summary>
          <ul>
            {trial.nearbyLocations
              .filter((loc) => loc !== location)
              .map((loc, i) => (
                <li key={i}>
                  {loc.facility}, {[loc.city, loc.state].filter(Boolean).join(', ')}
                  {typeof loc.distanceMiles === 'number' && ` · ${loc.distanceMiles.toFixed(1)} mi`}
                  {' · '}
                  <span className={statusClass(loc.status ?? '')}>{STATUS_LABEL[loc.status ?? ''] ?? loc.status}</span>
                </li>
              ))}
          </ul>
        </details>
      )}

      <footer className="trial-card-footer">
        <a className="trial-link" href={trial.url} target="_blank" rel="noreferrer">
          View on ClinicalTrials.gov ↗
        </a>
        <button
          className="trial-save-btn"
          disabled={!encounterOpen || saveState === 'saving' || saveState === 'saved'}
          title={encounterOpen ? undefined : 'Open a patient encounter in the EHR to add trials to the chart'}
          onClick={handleAddToChart}
        >
          {saveState === 'saving' ? 'Adding…' : saveState === 'saved' ? 'Added ✓' : 'Add to chart'}
        </button>
        {saveState === 'error' && <p className="trial-save-error">{saveError}</p>}
      </footer>
    </article>
  );
}
