import {
  getSeries,
  getSeriesEpisodes,
  createEpisode,
  updateEpisode,
  updateSeries,
  getEpisode,
  type Series,
  type Episode,
} from "../db/supabase.js";
import { generateFullScenario, generateSingleEpisode } from "./scenario.js";
import { generateVoice, generateVoiceEdgeTTS } from "./voice.js";
import { generateMultipleScenes } from "./image.js";
import { buildVideo } from "./video.js";
import { uploadToYouTube, buildVideoDescription, isYouTubeConfigured } from "./youtube.js";
import { logger } from "../lib/logger.js";
import * as fs from "fs";

export interface PipelineResult {
  success: boolean;
  episodeId?: number;
  youtubeUrl?: string;
  youtubeSkipped?: boolean;
  error?: string;
}

// ─── Generate full scenario for a series ────────────────────────────────────

export async function generateSeriesScenario(seriesId: number): Promise<void> {
  const series = await getSeries(seriesId);
  if (!series) throw new Error(`Series ${seriesId} not found`);

  logger.info({ seriesId }, "Generating full scenario");

  const result = await generateFullScenario(
    series.title,
    series.genre,
    series.description,
    series.total_episodes
  );

  // Save characters and scenario
  await updateSeries(seriesId, {
    characters: result.characters,
    scenario: result.fullScenario,
    total_episodes: result.episodes.length || series.total_episodes,
  });

  // Create all episode records as pending
  for (const ep of result.episodes) {
    await createEpisode({
      series_id: seriesId,
      episode_number: ep.episodeNumber,
      title: ep.title,
      script: ep.script,
      status: "pending",
    });
  }

  logger.info({ seriesId, episodeCount: result.episodes.length }, "Scenario generated");
}

// ─── Generate and publish a new episode ─────────────────────────────────────

export async function generateAndPublishNow(
  seriesId: number,
  onProgress?: (step: string) => Promise<void>
): Promise<PipelineResult> {
  const series = await getSeries(seriesId);
  if (!series) return { success: false, error: "Series not found" };

  try {
    // Find next pending episode
    const episodes = await getSeriesEpisodes(seriesId);
    let episode = episodes.find((e) => e.status === "pending");

    // If no pending episode, generate a new one
    if (!episode) {
      await onProgress?.("📝 كتابة سيناريو الحلقة...");

      const previousSummaries = episodes
        .filter((e) => e.status === "published")
        .slice(-3)
        .map((e) => e.title || "");

      const episodeScript = await generateSingleEpisode(
        series.title,
        series.genre,
        series.characters,
        previousSummaries,
        episodes.length + 1
      );

      const newEpisode = await createEpisode({
        series_id: seriesId,
        episode_number: episodeScript.episodeNumber,
        title: episodeScript.title,
        script: episodeScript.script,
        status: "pending",
      });

      if (!newEpisode) return { success: false, error: "Failed to create episode" };
      episode = newEpisode;
    }

    return await processEpisode(seriesId, episode.id, onProgress);
  } catch (err) {
    logger.error({ err, seriesId }, "generateAndPublishNow failed");
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Process a specific episode (generate media + publish) ──────────────────

export async function processEpisode(
  seriesId: number,
  episodeId: number,
  onProgress?: (step: string) => Promise<void>
): Promise<PipelineResult> {
  const series = await getSeries(seriesId);
  const episode = await getEpisode(episodeId);

  if (!series || !episode) {
    return { success: false, error: "Series or episode not found" };
  }

  await updateEpisode(episodeId, { status: "generating" });

  const tempFiles: string[] = [];

  try {
    // Step 1: Generate voice
    await onProgress?.("🎙️ توليد الصوت...");
    let audioPath: string;

    try {
      if (process.env["ELEVENLABS_API_KEY"]) {
        audioPath = await generateVoice(episode.script, series.voice_id);
      } else {
        audioPath = await generateVoiceEdgeTTS(episode.script);
      }
      tempFiles.push(audioPath);
      logger.info({ episodeId }, "Voice generated");
    } catch (voiceErr) {
      logger.warn({ voiceErr }, "Voice generation failed, using silent");
      audioPath = "";
    }

    // Step 2: Generate scene images
    await onProgress?.("🎨 توليد مشاهد الأنيميشن...");
    let imagePaths: string[] = [];

    try {
      imagePaths = await generateMultipleScenes(episode.script, series.characters, 4);
      tempFiles.push(...imagePaths);
      logger.info({ episodeId, count: imagePaths.length }, "Images generated");
    } catch (imgErr) {
      logger.warn({ imgErr }, "Image generation failed");
    }

    // Step 3: Build video
    await onProgress?.("🎬 تجميع الفيديو...");

    const videoPath = await buildVideo({
      imagePaths: imagePaths.length > 0 ? imagePaths : [],
      audioPath,
    });
    tempFiles.push(videoPath);

    logger.info({ episodeId }, "Video built");

    await updateEpisode(episodeId, { status: "ready" });

    // Step 4: Upload to YouTube (optional)
    await onProgress?.("📤 رفع على يوتيوب...");

    if (!isYouTubeConfigured()) {
      logger.info({ episodeId }, "YouTube not configured, skipping upload");
      await updateEpisode(episodeId, { status: "published" });
      await updateSeries(seriesId, {
        episodes_generated: (series.episodes_generated || 0) + 1,
      });

      return { success: true, episodeId, youtubeSkipped: true };
    }

    const description = buildVideoDescription(
      series.title,
      episode.episode_number,
      episode.title || `الحلقة ${episode.episode_number}`,
      episode.script.slice(0, 200)
    );

    const uploadResult = await uploadToYouTube({
      videoPath,
      title: `${series.title} - الحلقة ${episode.episode_number}: ${episode.title || ""}`,
      description,
      tags: ["أنيميشن", "مسلسل", series.genre, "ذكاء اصطناعي"],
    });

    await updateEpisode(episodeId, {
      status: "published",
      youtube_video_id: uploadResult.videoId,
      youtube_url: uploadResult.videoUrl,
      published_at: new Date().toISOString(),
    });

    await updateSeries(seriesId, {
      episodes_generated: (series.episodes_generated || 0) + 1,
    });

    logger.info({ episodeId, youtubeUrl: uploadResult.videoUrl }, "Episode published");

    return {
      success: true,
      episodeId,
      youtubeUrl: uploadResult.videoUrl,
    };
  } catch (err) {
    logger.error({ err, episodeId }, "processEpisode failed");
    await updateEpisode(episodeId, {
      status: "failed",
      error_message: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      episodeId,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    // Cleanup temp files
    for (const f of tempFiles) {
      try {
        if (f && fs.existsSync(f)) fs.unlinkSync(f);
      } catch { /* ignore */ }
    }
  }
}

// ─── Daily publish job ───────────────────────────────────────────────────────

export async function runDailyPublish(seriesId: number): Promise<PipelineResult | null> {
  const series = await getSeries(seriesId);
  if (!series) return null;

  const episodes = await getSeriesEpisodes(seriesId);
  const readyEpisode = episodes.find((e) => e.status === "ready");

  if (readyEpisode) {
    return await processEpisode(seriesId, readyEpisode.id);
  }

  const pendingEpisode = episodes.find((e) => e.status === "pending");
  if (pendingEpisode) {
    return await processEpisode(seriesId, pendingEpisode.id);
  }

  return await generateAndPublishNow(seriesId);
}
