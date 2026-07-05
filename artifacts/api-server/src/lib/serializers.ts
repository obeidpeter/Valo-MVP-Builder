type DateLike = Date | string | null | undefined;

function iso(d: DateLike): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

export function serializeUser(u: any) {
  return {
    id: u.id,
    email: u.email,
    name: u.name ?? null,
    role: u.role,
    status: u.status,
    lastLoginAt: iso(u.lastLoginAt),
    createdAt: iso(u.createdAt) ?? new Date(0).toISOString(),
  };
}

export function serializeClient(c: any, projectCount?: number) {
  return {
    id: c.id,
    name: c.name,
    sector: c.sector ?? null,
    segment: c.segment ?? null,
    contactName: c.contactName ?? null,
    contactEmail: c.contactEmail ?? null,
    ndaStatus: c.ndaStatus,
    notes: c.notes ?? null,
    projectCount: projectCount ?? null,
    createdAt: iso(c.createdAt) ?? new Date(0).toISOString(),
  };
}

export function serializeProject(
  p: any,
  extra: { clientName?: string | null; ndaStatus?: string | null; reviewerName?: string | null } = {},
) {
  return {
    id: p.id,
    clientId: p.clientId,
    clientName: extra.clientName ?? null,
    ndaStatus: extra.ndaStatus ?? null,
    tenderTitle: p.tenderTitle,
    issuingEntity: p.issuingEntity ?? null,
    tenderRef: p.tenderRef ?? null,
    deadline: p.deadline ?? null,
    valueBand: p.valueBand ?? null,
    segment: p.segment ?? null,
    submissionStatus: p.submissionStatus ?? null,
    status: p.status,
    reviewerId: p.reviewerId ?? null,
    reviewerName: extra.reviewerName ?? null,
    riskScore: p.riskScore ?? null,
    riskBand: p.riskBand ?? null,
    riskOverrideBand: p.riskOverrideBand ?? null,
    riskOverrideNote: p.riskOverrideNote ?? null,
    riskOverrideBy: p.riskOverrideBy ?? null,
    outcome: p.outcome,
    scope: p.scope ?? null,
    limitations: p.limitations ?? null,
    responsivenessReview: p.responsivenessReview ?? null,
    responsivenessSuggested: p.responsivenessSuggested ?? false,
    createdAt: iso(p.createdAt) ?? new Date(0).toISOString(),
  };
}

export function serializeDocument(d: any, uploadedByName?: string | null) {
  return {
    id: d.id,
    projectId: d.projectId,
    type: d.type,
    filename: d.filename,
    objectPath: d.objectPath,
    contentType: d.contentType ?? null,
    size: d.size ?? null,
    sha256: d.sha256 ?? null,
    source: d.source ?? null,
    dateReceived: d.dateReceived ?? null,
    redactionStatus: d.redactionStatus,
    uploadedBy: d.uploadedBy ?? null,
    uploadedByName: uploadedByName ?? null,
    contentText: d.contentText ?? null,
    extractedChars: d.extractedChars ?? null,
    extractionStatus: d.extractionStatus ?? null,
    createdAt: iso(d.createdAt) ?? new Date(0).toISOString(),
  };
}

export function serializeRequirement(r: any, sourceDocName?: string | null) {
  return {
    id: r.id,
    projectId: r.projectId,
    sourceDocId: r.sourceDocId ?? null,
    sourceDocName: sourceDocName ?? null,
    pageRef: r.pageRef ?? null,
    clauseRef: r.clauseRef ?? null,
    text: r.text,
    category: r.category,
    expectedEvidence: r.expectedEvidence ?? null,
    isMandatory: r.isMandatory,
    confidence: r.confidence ?? null,
    reviewStatus: r.reviewStatus,
    reviewerNotes: r.reviewerNotes ?? null,
    origin: r.origin ?? null,
    engineText: r.engineText ?? null,
    reviewedByName: r.reviewedByName ?? null,
    reviewedAt: iso(r.reviewedAt),
    createdAt: iso(r.createdAt) ?? new Date(0).toISOString(),
  };
}

export function serializeEvidence(
  e: any,
  extra: { requirementText?: string | null; documentName?: string | null } = {},
) {
  return {
    id: e.id,
    projectId: e.projectId,
    requirementId: e.requirementId,
    requirementText: extra.requirementText ?? null,
    documentId: e.documentId ?? null,
    documentName: extra.documentName ?? null,
    evidenceStatus: e.evidenceStatus,
    excerpt: e.excerpt ?? null,
    notes: e.notes ?? null,
    suggested: e.suggested ?? false,
    confirmedBy: e.confirmedBy ?? null,
    createdAt: iso(e.createdAt) ?? new Date(0).toISOString(),
  };
}

export function serializeDefect(d: any, requirementText?: string | null) {
  return {
    id: d.id,
    projectId: d.projectId,
    requirementId: d.requirementId ?? null,
    requirementText: requirementText ?? null,
    type: d.type,
    severity: d.severity,
    description: d.description,
    evidenceSnapshot: d.evidenceSnapshot ?? null,
    remediation: d.remediation ?? null,
    owner: d.owner ?? null,
    status: d.status,
    suggested: d.suggested ?? false,
    createdAt: iso(d.createdAt) ?? new Date(0).toISOString(),
  };
}

export function serializeBoqCheck(b: any) {
  return {
    id: b.id,
    projectId: b.projectId,
    sourceDocId: b.sourceDocId ?? null,
    lineRef: b.lineRef ?? null,
    description: b.description ?? null,
    quantity: b.quantity ?? null,
    unitRate: b.unitRate ?? null,
    extension: b.extension ?? null,
    computedExtension: b.computedExtension ?? null,
    checkType: b.checkType,
    finding: b.finding,
    severity: b.severity,
    status: b.status,
    createdAt: iso(b.createdAt) ?? new Date(0).toISOString(),
  };
}

export function serializeReport(
  r: any,
  generatedByName?: string | null,
) {
  return {
    id: r.id,
    projectId: r.projectId,
    version: r.version,
    status: r.status,
    docxPath: r.docxPath ?? null,
    reviewerId: r.reviewerId ?? null,
    reviewerName: r.reviewerName ?? null,
    attestation: r.attestation ?? null,
    engineVersion: r.engineVersion ?? null,
    promptPackVersion: r.promptPackVersion ?? null,
    modelId: r.modelId ?? null,
    signedOffAt: iso(r.signedOffAt),
    generatedBy: r.generatedBy ?? null,
    generatedByName: generatedByName ?? null,
    createdAt: iso(r.createdAt) ?? new Date(0).toISOString(),
  };
}

export function serializeVaultItem(
  v: any,
  telemetry: { band: string; daysToExpiry: number | null },
  clientName?: string | null,
) {
  const base = {
    id: v.id,
    clientId: v.clientId,
    artefactType: v.artefactType,
    issuer: v.issuer ?? null,
    issueDate: v.issueDate ?? null,
    expiryDate: v.expiryDate ?? null,
    renewalLeadDays: v.renewalLeadDays ?? null,
    status: v.status,
    expiryBand: telemetry.band,
    daysToExpiry: telemetry.daysToExpiry,
    createdAt: iso(v.createdAt) ?? new Date(0).toISOString(),
  };
  return clientName === undefined ? base : { ...base, clientName: clientName ?? null };
}

export function serializeCapabilityItem(c: any, evidenceDocName?: string | null) {
  return {
    id: c.id,
    clientId: c.clientId,
    claimType: c.claimType,
    description: c.description ?? null,
    evidenceDocId: c.evidenceDocId ?? null,
    evidenceDocName: evidenceDocName ?? null,
    approvedStatus: c.approvedStatus,
    // The anti-fabrication doctrine (TRD I4): a capability claim is only
    // usable in drafts when it is BOTH evidence-linked and approved by a
    // named human. Derived, never stored.
    claimable: c.evidenceDocId != null && c.approvedStatus === "approved",
    createdAt: iso(c.createdAt) ?? new Date(0).toISOString(),
  };
}

export function serializeSbdTemplate(
  t: any,
  extra: { annotationCount?: number } = {},
) {
  return {
    id: t.id,
    code: t.code,
    title: t.title,
    category: t.category,
    version: t.version,
    status: t.status,
    issuingCircular: t.issuingCircular ?? null,
    summary: t.summary ?? null,
    annotationCount: extra.annotationCount ?? null,
    createdAt: iso(t.createdAt) ?? new Date(0).toISOString(),
  };
}

export function serializeSbdAnnotation(a: any) {
  return {
    id: a.id,
    templateId: a.templateId,
    agency: a.agency ?? null,
    section: a.section ?? null,
    kind: a.kind,
    quirk: a.quirk,
    createdAt: iso(a.createdAt) ?? new Date(0).toISOString(),
  };
}

export function serializeAudit(a: any) {
  return {
    id: a.id,
    userId: a.userId ?? null,
    userName: a.userName ?? null,
    projectId: a.projectId ?? null,
    eventType: a.eventType,
    objectType: a.objectType ?? null,
    objectId: a.objectId ?? null,
    details: a.details ?? null,
    createdAt: iso(a.createdAt) ?? new Date(0).toISOString(),
  };
}
