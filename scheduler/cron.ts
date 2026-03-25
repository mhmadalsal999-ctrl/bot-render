import cron from "node-cron";
import {
  getActiveSeriesForPublish,
  createEpisode,
  getSeriesEpisodes,
  updateSeries,
  supabase,
} from "../db/supabase.js";
import { runDailyPublish, generateAndPublishNow, generateSeriesScenario } from "../pipeline/index.js";
import { logger } from "../lib/logger.js";

let isRunning = false;

export function startScheduler(): void {
  cron.schedule("0 10 * * *", async () => {
    if (isRunning) {
      logger.warn("Daily publish already running, skipping");
      return;
    }

    isRunning = true;
    logger.info("Starting daily auto-publish job");

    try {
      const activeSeries = await getActiveSeriesForPublish();
      logger.info({ count: activeSeries.length }, "Found active series for auto-publish");

      for (const series of activeSeries) {
        try {
          logger.info({ seriesId: series.id, title: series.title }, "Processing series");

          const episodes = await getSeriesEpisodes(series.id);
          const pendingEpisodes = episodes.filter((e) => e.status === "pending");

          if (pendingEpisodes.length === 0) {
            logger.info({ seriesId: series.id }, "No pending episodes, generating new one");
            const result = await generateAndPublishNow(series.id);

            await supabase.from("auto_publish_log").insert({
              series_id: series.id,
              episode_id: result.episodeId,
              status: result.success ? "success" : "failed",
              error_message: result.error,
              created_at: new Date().toISOString(),
            });
          } else {
            const result = await runDailyPublish(series.id);
            if (result) {
              await supabase.from("auto_publish_log").insert({
                series_id: series.id,
                episode_id: result.episodeId,
                status: result.success ? "success" : "failed",
                error_message: result.error,
                created_at: new Date().toISOString(),
              });
            }
          }

          await new Promise((resolve) => setTimeout(resolve, 5000));
        } catch (err) {
          logger.error({ err, seriesId: series.id }, "Failed to process series in daily job");

          await supabase.from("auto_publish_log").insert({
            series_id: series.id,
            episode_id: null,
            status: "failed",
            error_message: err instanceof Error ? err.message : String(err),
            created_at: new Date().toISOString(),
          });
        }
      }

      logger.info("Daily auto-publish job completed");
    } catch (err) {
      logger.error({ err }, "Daily publish job failed");
    } finally {
      isRunning = false;
    }
  });

  logger.info("Scheduler started: daily publish at 10:00 UTC");
}

export function stopScheduler(): void {
  logger.info("Scheduler stopped");
}
