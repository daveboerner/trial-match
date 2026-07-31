/**
 * Mock active-problem picklist. Stands in for `sdk.ehr.api.patient.getProblems()`
 * until Phase 4 wires in the real Vim SDK / EHR chart context.
 */

export interface ActiveProblem {
  id: string;
  label: string;
  /** Plain-language condition text this problem maps to, sent as `conditions` in TrialSearchRequest. */
  searchTerm: string;
}

export const MOCK_ACTIVE_PROBLEMS: ActiveProblem[] = [
  { id: 'p1', label: 'Acute myocardial infarction (heart attack)', searchTerm: 'heart attack' },
  { id: 'p2', label: 'Type 2 diabetes mellitus', searchTerm: 'type 2 diabetes' },
  { id: 'p3', label: 'Essential hypertension', searchTerm: 'hypertension' },
];
