import express from "express";
import cors from "cors";
import { logger } from "./lib/logger.js";
import { bot } from "./bot/index.js";
import router from "./routes/index.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, _res, next) => {
  logger.info({ method: req.method, url: req.url }, "Request");
  next();
});

const BOT_TOKEN = process.env["TELEGRAM_BOT_TOKEN"];
if (BOT_TOKEN) {
  const webhookPath = `/bot${BOT_TOKEN}`;
  app.use(bot.webhookCallback(webhookPath));
  logger.info({ webhookPath }, "Bot webhook registered");
}

app.use("/api", router);

app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "AI Animation Series Bot" });
});

export default app;
