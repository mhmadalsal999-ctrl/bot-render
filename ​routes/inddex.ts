import { Router } from "express";
import healthRouter from "./health.js";

const router = Router();

router.use("/", healthRouter);

router.get("/status", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default router;
