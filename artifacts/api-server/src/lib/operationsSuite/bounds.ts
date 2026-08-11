export const OPERATIONS_SUITE_BOUNDS = Object.freeze({
  recordsPerProject: 1_000,
  recordsPerKind: 250,
  commentsPerWorkItem: 100,
  linksPerType: 100,
  dependenciesPerWorkItem: 50,
  evidenceSlotsPerRequest: 50,
  evidenceResponseHistoryPerSlot: 20,
  checklistItemsPerMission: 100,
  proofItemsPerMission: 50,
  visualQaPages: 2_000,
  visualQaCrossReferences: 5_000,
  visualQaSignatures: 250,
  sealIdentifiers: 100,
  statusReasonsPerRecord: 100,
  mobileQueueItems: 250,
  textCodeUnits: 4_096,
  shortTextCodeUnits: 256,
  requestBodyBytes: 1_048_576,
} as const);

export const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
export const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
