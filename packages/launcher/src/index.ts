// The town launcher (CLAUDE.md §10, §10a; docs/plans/M7.md).
export {
  CENSUS_ATTRIBUTION,
  cachedFile,
  censusFiles,
  parseGazetteerCounties,
  parseGazetteerPlaces,
  readAcsPlaces,
  readPlaceCounties,
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
export {
  governmentName,
  nwsPoint,
  resolveFrom,
  resolveTown,
  townSlug,
  type NwsPoint,
  type ResolvedTown,
} from './resolve';
export {
  approvedCandidate,
  DEFAULT_LAUNCH_DIR,
  draftTownYaml,
  LaunchRefused,
  runLaunch,
  type LaunchDeps,
  type LaunchOptions,
  type LaunchResult,
} from './launch';
export {
  archiveYears,
  buyDomain,
  domainOrder,
  newsSignals,
  priorUse,
  registeredInRegistry,
  registrantFromEnv,
  searchDomains,
  type DomainQuote,
  type PriorUse,
  type Purchase,
  type Registrant,
} from './domains';
export {
  domainsFor,
  nameCandidates,
  namePatterns,
  NEIGHBOR_MILES,
  officialSounding,
  patternOf,
  resemblesOutlet,
  siteNameFor,
  type NamePattern,
} from './names';
export {
  DEFAULT_TOWNS_DIR,
  namesReport,
  namesStep,
  type NameDeps,
  type NamesDetail,
  type Proposal,
} from './names-step';
