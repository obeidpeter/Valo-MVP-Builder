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
import riskRouter from "./risk";
import reportsRouter from "./reports";
import auditRouter from "./audit";
import vaultRouter from "./vault";
import capabilityRouter from "./capability";
import sbdRouter from "./sbd";
import operationsRouter from "./operations";
import analyticsRouter from "./analytics";
import configRouter from "./config";
import aiOperationsRouter from "./aiOperations";
import intelligenceRouter from "./intelligence";
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

const router: IRouter = Router();

// Everything below requires an authenticated, provisioned user.
router.use(attachUser);

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
router.use(attachTenantDatabase);
router.use(enforceTenantResourceBoundary);

router.use(usersRouter);
router.use(clientsRouter);
router.use(dashboardRouter);
router.use(projectsRouter);
router.use(documentsRouter);
router.use(requirementsRouter);
router.use(evidenceRouter);
router.use(defectsRouter);
router.use(boqRouter);
router.use(riskRouter);
router.use(reportsRouter);
router.use(auditRouter);
router.use(vaultRouter);
router.use(capabilityRouter);
router.use(sbdRouter);
router.use(operationsRouter);
router.use(analyticsRouter);
router.use(aiOperationsRouter);
router.use(intelligenceRouter);
router.use(configRouter);
router.use(storageRouter);

export default router;
