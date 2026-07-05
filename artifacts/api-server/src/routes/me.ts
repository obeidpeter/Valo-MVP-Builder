import { Router, type IRouter, type Request, type Response } from "express";
import { getLocalUser } from "../middlewares/auth";
import { serializeUser } from "../lib/serializers";

const router: IRouter = Router();

router.get("/me", (req: Request, res: Response) => {
  const user = getLocalUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json(serializeUser(user));
});

export default router;
