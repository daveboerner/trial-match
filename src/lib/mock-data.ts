/**
 * Static mock data for Phase 2 UI iteration — no network calls, no Vim SDK.
 * Trial records are adapted from a real Phase 1.5 smoke-test response
 * (condition "heart attack", zip 33140, radius 500mi) so distances and
 * locations behave realistically when the radius control is adjusted.
 * Phase 3 replaces this module's role with a real call to /api/trial-search.
 */

import type { NormalizedTrial } from '@/types/trial';

export interface ActiveProblem {
  id: string;
  label: string;
  /** Plain-language condition text this problem maps to, sent as `conditions` in TrialSearchRequest. */
  searchTerm: string;
}

/** Stand-in for `sdk.ehr.api.patient.getProblems()` (Phase 4). */
export const MOCK_ACTIVE_PROBLEMS: ActiveProblem[] = [
  { id: 'p1', label: 'Acute myocardial infarction (heart attack)', searchTerm: 'heart attack' },
  { id: 'p2', label: 'Type 2 diabetes mellitus', searchTerm: 'type 2 diabetes' },
  { id: 'p3', label: 'Essential hypertension', searchTerm: 'hypertension' },
];

const HEART_ATTACK_TRIALS: NormalizedTrial[] = [
  {
    nctId: 'NCT06438315',
    title: 'SuperSaturated Oxygen Comprehensive Observational Registry',
    acronym: 'SSCORE',
    status: 'RECRUITING',
    phases: [],
    studyType: 'OBSERVATIONAL',
    sponsor: 'TherOx',
    conditions: ['STEMI - ST Elevation Myocardial Infarction', 'AMI'],
    matchedCondition: 'heart attack',
    centralContact: { name: 'Jennifer Gardner', phone: '949-300-2811', email: 'sscore.zoll@zoll.com' },
    nearestLocation: {
      facility: 'Baptist Health Baptist Hospital',
      city: 'Miami',
      state: 'Florida',
      zip: '33176',
      status: 'RECRUITING',
      distanceMiles: 4.9,
      name: 'Ramon Quesada, MD',
      phone: '(786) 596-1960',
      email: 'DG-MCVIResearchRegulatory@baptisthealth.net',
    },
    nearbyLocations: [
      { facility: 'Baptist Health Baptist Hospital', city: 'Miami', state: 'Florida', zip: '33176', status: 'RECRUITING', distanceMiles: 4.9, name: 'Ramon Quesada, MD', phone: '(786) 596-1960', email: 'DG-MCVIResearchRegulatory@baptisthealth.net' },
      { facility: 'NCH Baker Hospital', city: 'Naples', state: 'Florida', zip: '34102', status: 'RECRUITING', distanceMiles: 105.6, name: 'Mazen Albaghdadi, MD', phone: '2396245000', email: 'mazen.albaghdadi@nchmd.org' },
      { facility: 'NCH North Naples', city: 'Naples', state: 'Florida', zip: '34110', status: 'RECRUITING', distanceMiles: 105.6, name: 'Mazen Albaghdadi, MD', phone: '(239) 624-5000', email: 'mazen.albaghdadi@nchmd.org' },
      { facility: 'Charleston Area Medical Center', city: 'Charleston', state: 'West Virginia', zip: '25304', status: 'RECRUITING', distanceMiles: 870.1, name: 'Elise Anderson, MD', phone: '304-388-5432', email: 'zuser176@vandaliahealth.org' },
      { facility: "St Mary's Medical Center", city: 'Huntington', state: 'West Virginia', zip: '25702', status: 'RECRUITING', distanceMiles: 880.9, name: 'Cheryl Kane' },
    ],
    url: 'https://clinicaltrials.gov/study/NCT06438315',
  },
  {
    nctId: 'NCT05185492',
    title: 'Multi-center Collaborative to Enhance Quality and Outcomes in the Management of Cardiogenic Shock',
    acronym: 'VANQUISH SHOCK',
    status: 'RECRUITING',
    phases: [],
    studyType: 'OBSERVATIONAL',
    sponsor: 'STAVROS G DRAKOS',
    conditions: ['Cardiogenic Shock', 'Acute Myocardial Infarction'],
    matchedCondition: 'heart attack',
    centralContact: { name: 'John Kirk', phone: '801-585-2944', email: 'john.kirk@hsc.utah.edu' },
    nearestLocation: {
      facility: 'Cleveland Clinic Florida',
      city: 'Weston',
      state: 'Florida',
      zip: '33331',
      status: 'RECRUITING',
      distanceMiles: 25.5,
      name: 'Diana Yanez, BSN, RN',
      phone: '954-659-5570',
      email: 'YANEZD@ccf.org',
    },
    nearbyLocations: [
      { facility: 'Cleveland Clinic Florida', city: 'Weston', state: 'Florida', zip: '33331', status: 'RECRUITING', distanceMiles: 25.5, name: 'Diana Yanez, BSN, RN', phone: '954-659-5570', email: 'YANEZD@ccf.org' },
      { facility: 'Inova Heart and Vascular Institute', city: 'Falls Church', state: 'Virginia', zip: '22042', status: 'RECRUITING', distanceMiles: 918.8, name: 'Juan Carlos Ojeda', phone: '703-776-3779', email: 'Juancarlos.Encisoojeda@inova.org' },
      { facility: 'University of Toronto', city: 'Toronto', state: 'Ontario', status: 'RECRUITING', distanceMiles: 1236.6, name: 'Adriana Luk, M.D.', phone: '416-340-4800', email: 'Adriana.luk@uhn.ca' },
    ],
    url: 'https://clinicaltrials.gov/study/NCT05185492',
  },
  {
    nctId: 'NCT07517263',
    title: 'An Open Label Extension (OLE) Study (Following Completion of CTQJ230A12301) to Evaluate Long-term Safety and Tolerability of Pelacarsen (TQJ230)',
    status: 'RECRUITING',
    phases: ['PHASE3'],
    studyType: 'INTERVENTIONAL',
    sponsor: 'Novartis Pharmaceuticals',
    conditions: ['Cardiovascular Disease and Lipoprotein(a)'],
    matchedCondition: 'heart attack',
    centralContact: { name: 'Novartis Pharmaceuticals', phone: '1-888-669-6682', email: 'novartis.email@novartis.com' },
    nearestLocation: {
      facility: 'Excel Medical Clinical Trials LLC',
      city: 'Boca Raton',
      state: 'Florida',
      zip: '33434',
      status: 'RECRUITING',
      distanceMiles: 37.4,
      name: 'Joseph Ramsey',
      phone: '+1 561 756 8206',
      email: 'jramsey@flourishresearch.com',
    },
    nearbyLocations: [
      { facility: 'Excel Medical Clinical Trials LLC', city: 'Boca Raton', state: 'Florida', zip: '33434', status: 'RECRUITING', distanceMiles: 37.4, name: 'Joseph Ramsey', phone: '+1 561 756 8206', email: 'jramsey@flourishresearch.com' },
      { facility: 'Cardiology Partners Clinical Research Institute', city: 'Wellington', state: 'Florida', zip: '33449', status: 'RECRUITING', distanceMiles: 58.3, name: 'Saaima Farooq', phone: '+1 561 537 4778', email: 'saaima.farooq@cardiologypartnerspl.com' },
      { facility: 'Advanced Research for Health Improvement LLC', city: 'Naples', state: 'Florida', zip: '34102', status: 'RECRUITING', distanceMiles: 105.6, name: 'Maria Caceres', phone: '+1 239 300 0586', email: 'maria.caceres@arhiusa.com' },
      { facility: 'Peace River Cardiovascular Center', city: 'Port Charlotte', state: 'Florida', zip: '33952', status: 'RECRUITING', distanceMiles: 145.1, name: 'Karen Mullinax', phone: '+1 941 629 5356', email: 'karen@prcvcfl.com' },
      { facility: 'Bay Area Cardiology Assoc', city: 'Brandon', state: 'Florida', zip: '33511', status: 'RECRUITING', distanceMiles: 197.5, name: 'Leonor Guerra', phone: '+1 813 684 6000', email: 'lguerra@bayareacardiology.com' },
    ],
    url: 'https://clinicaltrials.gov/study/NCT07517263',
  },
  {
    nctId: 'NCT06118281',
    title: 'ARTEMIS - A Research Study to Look at How Ziltivekimab Works Compared to Placebo in People With a Heart Attack',
    acronym: 'ARTEMIS',
    status: 'RECRUITING',
    phases: ['PHASE3'],
    studyType: 'INTERVENTIONAL',
    sponsor: 'Novo Nordisk A/S',
    conditions: ['Cardiovascular Risk', 'Acute Myocardial Infarction (AMI)'],
    matchedCondition: 'heart attack',
    centralContact: { name: 'Novo Nordisk', phone: '(+1) 866-867-7178', email: 'clinicaltrials@novonordisk.com' },
    nearestLocation: {
      facility: 'Memorial Healthcare',
      city: 'Hollywood',
      state: 'Florida',
      zip: '33021',
      status: 'ACTIVE_NOT_RECRUITING',
      distanceMiles: 13.3,
    },
    nearbyLocations: [
      { facility: 'Memorial Healthcare', city: 'Hollywood', state: 'Florida', zip: '33021', status: 'ACTIVE_NOT_RECRUITING', distanceMiles: 13.3 },
      { facility: 'Holy Cross Hospital', city: 'Fort Lauderdale', state: 'Florida', zip: '33308', status: 'ACTIVE_NOT_RECRUITING', distanceMiles: 20.9 },
      { facility: 'Winter Haven Hospital', city: 'Winter Haven', state: 'Florida', zip: '33881', status: 'RECRUITING', distanceMiles: 181.3 },
    ],
    url: 'https://clinicaltrials.gov/study/NCT06118281',
  },
];

/** Keyed by ActiveProblem.searchTerm. Problems with no entry render the empty state. */
export const MOCK_TRIALS_BY_CONDITION: Record<string, NormalizedTrial[]> = {
  'heart attack': HEART_ATTACK_TRIALS,
};
