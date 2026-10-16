// The town launcher (CLAUDE.md §10, §10a; docs/plans/M7.md).
export {
  CENSUS_ATTRIBUTION,
  cachedFile,
  censusFiles,
  parseGazetteerPlaces,
  readAcsPlaces,
  readPopEstimates,
  readZctaPlaces,
  readZipBusiness,
  STATE_FIPS,
  type Place,
  type PopEstimate,
  type ZctaPart,
} from './census';
export {
  establishmentsFor,
  milesBetween,
  percentiles,
  rankPlaces,
  type CandidateRow,
  type RankFacts,
} from './rank';
export {
  findPlace,
  loadRankFacts,
  rankingCsv,
  rankingReport,
  saveCandidates,
  stateFips,
  statePlaces,
  writeRanking,
} from './towns-rank';
export {
  candidateStates,
  CandidateDecisionError,
  decideCandidate,
  listCandidates,
  type Candidate,
} from './candidates';
