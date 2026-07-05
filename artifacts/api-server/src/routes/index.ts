import { Router, type IRouter } from "express";
import healthRouter from "./health";
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
import { attachUser } from "../middlewares/auth";

const router: IRouter = Router();

// Public: health check.
router.use(healthRouter);

// Everything below requires an authenticated, provisioned user.
router.use(attachUser);

router.use(meRouter);
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
router.use(storageRouter);

export default router;
