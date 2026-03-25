import app from "./app.js";
import { logger } from "./lib/logger.js";
import { setupWebhook, startPolling } from "./bot/index.js";
import { startScheduler } from "./scheduler/cron.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  const WEBHOOK_URL = process.env["WEBHOOK_URL"];
  const NODE_ENV = process.env["NODE_ENV"];

  try {
    if (WEBHOOK_URL && NODE_ENV === "production") {
      await setupWebhook(WEBHOOK_URL);
      logger.info("Bot running with webhook");
    } else {
      await startPolling();
      logger.info("Bot running with polling");
    }
  } catch (botErr) {
    logger.error({ botErr }, "Failed to start bot");
  }

  try {
    startScheduler();
    logger.info("Scheduler started");
  } catch (schedErr) {
    logger.error({ schedErr }, "Failed to start scheduler");
  }
});
