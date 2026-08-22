import { Router, type IRouter } from "express";
import storageRouter from "./storage";
import meRouter from "./me";
import usersRouter from "./users";
import clientsRouter from "./clients";
import projectsRouter from "./projects";
import dashboardRouter from "./dashboard";
import documentsRouter from "./documents";
import requirementsRouter from "./requirements";
import evidenceRouter from "./evidence";
import defectsRouter from "./defects";
import boqRouter from "./boq";
import { createBoqVerificationRouter } from "./boqVerification";
import riskRouter from "./risk";
import reportsRouter from "./reports";
import auditRouter from "./audit";
import vaultRouter from "./vault";
import capabilityRouter from "./capability";
import sbdRouter from "./sbd";
import operationsRouter from "./operations";
import {
  createDbOperationsSuiteGuards,
  createOperationsSuiteRouter,
} from "./operationsSuite";
import analyticsRouter from "./analytics";
import configRouter from "./config";
import aiOperationsRouter from "./aiOperations";
import intelligenceRouter from "./intelligence";
import { createAddendumImpactRouter } from "./addendumImpact";
import { createTenderContextRouter } from "./tenderContext";
import { createDocumentVersionSnapshotRouter } from "./documentVersionSnapshots";
import { createGrowthSuiteRouter } from "./growthSuite";
import { createClientActionPortalRouter } from "./clientActionPortal";
import { createOpportunitySourceNetworkRouter } from "./opportunitySourceNetwork";
import { createOpportunityPursuitHandoffRouter } from "./opportunityPursuitHandoff";
import { createEvidenceRenewalRouter } from "./evidenceRenewal";
import { createClientActionUploadRouter } from "./clientActionUpload";
import { createProductionAcceptanceRouter } from "./productionAcceptance";
import { createAiShadowProgrammeRouter } from "./aiShadowProgramme";
import { createDisconnectedReconciledCommunicationsRouter } from "./reconciledCommunications";
import { createPrivacyOperationsRouter } from "./privacyOperationsCentre";
import { createCommercialRetainerRouter } from "./commercialRetainer";
import { createDefaultPartnerConsortiumRoomRouter } from "./partnerConsortiumRoom";
import { createClaimsDeskRouter } from "./claimsDesk";
import canonicalEvidenceOptionsRouter from "./canonicalEvidenceOptions";
import workInboxRouter from "./workInbox";
import organisationsRouter from "./organisations";
import partnerRelationshipsRouter from "./partnerRelationships";
import breakGlassRouter from "./breakGlass";
import featureFlagsRouter from "./featureFlags";
import { attachUser } from "../middlewares/auth";
import {
  attachTenantContext,
  auditBreakGlassUse,
  enforceTenantResourceBoundary,
} from "../middlewares/tenancy";
import { attachTenantDatabase } from "../middlewares/databaseTenancy";
import { DrizzleOperationsSuiteStore } from "../lib/operationsSuite/drizzleStore";
import { createDrizzleGrowthSuiteRepository } from "../lib/growthSuite/drizzleRepository";
import { createDrizzleOnboardingProgressRepository } from "../lib/growthSuite/onboardingProgress";
import {
  ClientActionService,
  DrizzleClientActionRepository,
  createDbClientActionAuthority,
} from "../lib/clientActionPortal";
import { AuditProductionAcceptanceRepository } from "../lib/productionAcceptance";
import { createCommercialRetainerService } from "../lib/commercialRetainer/service";
import { createDrizzleCommercialRetainerRepository } from "../lib/commercialRetainer/drizzleRepository";
import { GovernedClientUploadService } from "../lib/storageLifecycle/clientUpload";
import { DrizzleGovernedClientUploadRepository } from "../lib/storageLifecycle/clientUploadRepository";
import { isGovernedClientUploadActivated } from "../lib/storageLifecycle/activation";
import {
  authenticatedActorMutationRateLimiter,
  authenticatedRateLimiter,
} from "../middlewares/authenticatedRateLimit";

const operationsSuiteGuards = createDbOperationsSuiteGuards();
const operationsSuiteRouter = createOperationsSuiteRouter({
  projectGuard: operationsSuiteGuards.projectGuard,
  references: operationsSuiteGuards.references,
  store: new DrizzleOperationsSuiteStore(),
});
const growthSuiteRouter = createGrowthSuiteRouter({
  repository: createDrizzleGrowthSuiteRepository(),
  onboardingProgressRepository: createDrizzleOnboardingProgressRepository(),
});
const clientActionPortalRouter = createClientActionPortalRouter({
  service: new ClientActionService({
    repository: new DrizzleClientActionRepository(),
    authority: createDbClientActionAuthority(),
  }),
});
const opportunitySourceNetworkRouter = createOpportunitySourceNetworkRouter();
const opportunityPursuitHandoffRouter = createOpportunityPursuitHandoffRouter();
const evidenceRenewalRouter = createEvidenceRenewalRouter();
const clientActionUploadRouter = createClientActionUploadRouter({
  service: new GovernedClientUploadService(
    new DrizzleGovernedClientUploadRepository(),
    ({ organisationId }) => isGovernedClientUploadActivated(organisationId),
  ),
});
const productionAcceptanceRouter = createProductionAcceptanceRouter({
  repository: new AuditProductionAcceptanceRepository(),
});
const aiShadowProgrammeRouter = createAiShadowProgrammeRouter();
const reconciledCommunicationsRouter =
  createDisconnectedReconciledCommunicationsRouter();
const privacyOperationsRouter = createPrivacyOperationsRouter();
const commercialRetainerRouter = createCommercialRetainerRouter({
  service: createCommercialRetainerService({
    repository: createDrizzleCommercialRetainerRepository(),
  }),
});
const partnerConsortiumRoomRouter = createDefaultPartnerConsortiumRoomRouter();
const claimsDeskRouter = createClaimsDeskRouter();
const boqVerificationRouter = createBoqVerificationRouter();
const addendumImpactRouter = createAddendumImpactRouter();
const tenderContextRouter = createTenderContextRouter();
const documentVersionSnapshotRouter = createDocumentVersionSnapshotRouter();

const router: IRouter = Router();

// Everything below requires an authenticated, provisioned user.
router.use(attachUser);
// A global actor-only bucket covers tenant-free bootstrap and every privileged
// control-plane mutation. It deliberately does not key on attacker-chosen URL
// segments, so arbitrary unmatched paths cannot create unbounded buckets.
router.use(authenticatedActorMutationRateLimiter);

router.use(meRouter);
// Organisation discovery/bootstrap and emergency-access lifecycle must run
// before selecting a tenant. Each tenant-sensitive endpoint in these routers
// attaches and verifies its own explicit context.
router.use(organisationsRouter);
router.use(partnerRelationshipsRouter);
router.use(breakGlassRouter);
router.use(featureFlagsRouter);

// Every legacy/domain route below operates inside exactly one resolved tenant.
router.use(attachTenantContext);
router.use(auditBreakGlassUse);
// Authenticated mutations consume a durable tenant/actor/operation bucket in
// a short committed RLS transaction. This happens before the business request
// transaction so downstream rollback cannot erase the abuse-control attempt.
router.use(authenticatedRateLimiter);
router.use(attachTenantDatabase);
router.use(enforceTenantResourceBoundary);

router.use(usersRouter);
router.use(clientsRouter);
router.use(dashboardRouter);
router.use(workInboxRouter);
router.use(projectsRouter);
router.use(documentsRouter);
router.use(documentVersionSnapshotRouter);
router.use(canonicalEvidenceOptionsRouter);
router.use(requirementsRouter);
router.use(evidenceRouter);
router.use(defectsRouter);
router.use(boqRouter);
router.use(boqVerificationRouter);
router.use(riskRouter);
router.use(reportsRouter);
router.use(auditRouter);
router.use(vaultRouter);
router.use(capabilityRouter);
router.use(sbdRouter);
router.use(operationsRouter);
router.use(operationsSuiteRouter);
router.use(growthSuiteRouter);
router.use("/commercial-retainer", commercialRetainerRouter);
router.use(clientActionPortalRouter);
router.use(clientActionUploadRouter);
router.use(partnerConsortiumRoomRouter);
router.use(reconciledCommunicationsRouter);
router.use(opportunitySourceNetworkRouter);
router.use(opportunityPursuitHandoffRouter);
router.use(evidenceRenewalRouter);
router.use(productionAcceptanceRouter);
router.use(privacyOperationsRouter);
router.use(claimsDeskRouter);
router.use(analyticsRouter);
router.use(aiOperationsRouter);
router.use(aiShadowProgrammeRouter);
router.use(intelligenceRouter);
router.use(addendumImpactRouter);
router.use(tenderContextRouter);
router.use(configRouter);
router.use(storageRouter);

export default router;
