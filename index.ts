import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import {
  getSeries,
  getSeriesEpisodes,
  createEpisode,
  updateEpisode,
  updateSeries,
  getNextPendingEpisode,
} from "../db/supabase.js";
import { generateFullScenario, generateSingleEpisode } from "./scenario.js";
import { generateVoice } from "./voice.js";
import {
  generateAnimationClips,
  combineClipsWithAudio,
  addSubtitleOverlay,
} from "./animation.js";
import { uploadToYouTube, buildVideoDescription, isYouTubeConfigured } from "./youtube.js";
import { cleanupFiles } from "./video.js";
import { logger } from "../lib/logger.js";

export interface PipelineResult {
  episodeId: number;
  videoPath?: string;
  youtubeUrl?: string;
  youtubeSkipped?: boolean;
  success: boolean;
  error?: string;
}

// ─── Generate full scenario for a new series ───────────────────────────────

export async function generateSeriesScenario(seriesId: number): Promise<void> {
  const series = await getSeries(seriesId);
  if (!series) throw new Error("Series not found");

  logger.info({ seriesId }, "Generating full scenario");

  const result = await generateFullScenario(
    series.title,
    series.genre,
    series.description || "",
    20
  );

  await updateSeries(seriesId, {
    scenario: result.fullScenario,
    characters: result.characters,
    total_episodes: result.episodes.length,
  });

  for (const ep of result.episodes) {
    await createEpisode({
      series_id: seriesId,
      episode_number: ep.episodeNumber,
      title: ep.title,
      script: ep.script,
      status: "pending",
    });
  }

  logger.info({ seriesId, total: result.episodes.length }, "Scenario generated");
}

// ─── Full animation pipeline for one episode ───────────────────────────────

export async function processEpisode(
  seriesId: number,
  episodeId: number,
  onProgress?: (step: string) => Promise<void>
): Promise<PipelineResult> {
  const tempFiles: string[] = [];

  try {
    const series = await getSeries(seriesId);
    const episodes = await getSeriesEpisodes(seriesId);
    const episode = episodes.find((e) => e.id === episodeId);

    if (!series || !episode) {
      return { episodeId, success: false, error: "Series or episode not found" };
    }

    await updateEpisode(episodeId, { status: "generating" });

    // ── Step 1: Generate voice ──────────────────────────────────────────────
    if (onProgress) await onProgress("🎙️ جاري توليد الصوت بـ ElevenLabs...");
    let audioPath = "";
    try {
      audioPath = await generateVoice(episode.script, series.voice_id);
      tempFiles.push(audioPath);
      logger.info({ episodeId }, "Voice generated");
    } catch (err) {
      logger.warn({ err }, "Voice generation failed, video will be silent");
    }

    // ── Step 2: Generate animated video clips ───────────────────────────────
    if (onProgress) await onProgress("🎨 جاري توليد مقاطع الأنيميشن...");

    const SCENE_COUNT = 5;
    const TARGET_DURATION = 30;

    const clips = await generateAnimationClips({
      script: episode.script,
      characters: series.characters,
      genre: series.genre,
      targetDuration: TARGET_DURATION,
      sceneCount: SCENE_COUNT,
    });

    for (const c of clips) tempFiles.push(c.clipPath);

    if (clips.length === 0) {
      return {
        episodeId,
        success: false,
        error: "فشل توليد مقاطع الأنيميشن. تحقق من HUGGINGFACE_API_KEY.",
      };
    }

    logger.info({ episodeId, clipCount: clips.length }, "Animation clips generated");

    // ── Step 3: Combine clips + audio into final video ──────────────────────
    if (onProgress) await onProgress("🎬 جاري تجميع الفيديو مع الصوت...");

    const videoPath = path.join(os.tmpdir(), `final_ep_${episodeId}_${Date.now()}.mp4`);

    await combineClipsWithAudio(clips, audioPath, videoPath);
    tempFiles.push(videoPath);

    logger.info({ episodeId, videoPath }, "Video assembled");

    // ── Step 4: Add subtitle overlay ────────────────────────────────────────
    if (onProgress) await onProgress("📝 جاري إضافة النصوص...");
    let finalVideoPath = videoPath;
    try {
      const durations = clips.map((c) => c.duration);
      const scenes = clips.map((c) => c.sceneText);
      const subtitledPath = await addSubtitleOverlay(videoPath, scenes, durations);
      if (subtitledPath !== videoPath) {
        tempFiles.push(subtitledPath);
        finalVideoPath = subtitledPath;
      }
    } catch {
      logger.warn({ episodeId }, "Subtitle overlay failed, using video without subtitles");
    }

    await updateEpisode(episodeId, { status: "ready", duration_seconds: TARGET_DURATION });

    // ── Step 5: Upload to YouTube (optional) ────────────────────────────────
    if (!isYouTubeConfigured()) {
      logger.info({ episodeId }, "YouTube not configured — episode ready, not uploaded");
      await cleanupFiles(tempFiles.filter((f) => f !== finalVideoPath));
      return {
        episodeId,
        videoPath: finalVideoPath,
        youtubeSkipped: true,
        success: true,
      };
    }

    if (onProgress) await onProgress("☁️ جاري الرفع على يوتيوب...");

    const published = episodes.filter((e) => e.status === "published");
    const description = buildVideoDescription(
      series.title,
      episode.episode_number,
      episode.title || `الحلقة ${episode.episode_number}`,
      episode.script.slice(0, 300)
    );

    const uploadResult = await uploadToYouTube({
      videoPath: finalVideoPath,
      title: `${series.title} - الحلقة ${episode.episode_number}: ${episode.title || ""}`,
      description,
      tags: [series.title, series.genre, "أنيميشن", "ذكاء اصطناعي", "مسلسل"],
      privacyStatus: "public",
    });

    await updateEpisode(episodeId, {
      status: "published",
      youtube_video_id: uploadResult.videoId,
      youtube_url: uploadResult.videoUrl,
      published_at: new Date().toISOString(),
    });

    await updateSeries(seriesId, {
      episodes_generated: published.length + 1,
    });

    await cleanupFiles(tempFiles);

    logger.info({ episodeId, videoUrl: uploadResult.videoUrl }, "Episode published to YouTube");

    return {
      episodeId,
      videoPath: finalVideoPath,
      youtubeUrl: uploadResult.videoUrl,
      success: true,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err, episodeId }, "Pipeline failed");

    await updateEpisode(episodeId, { status: "failed", error_message: errorMsg });
    await cleanupFiles(tempFiles);

    return { episodeId, success: false, error: errorMsg };
  }
}

// ─── Daily auto-publish ─────────────────────────────────────────────────────

export async function runDailyPublish(seriesId: number): Promise<PipelineResult | null> {
  try {
    const episode = await getNextPendingEpisode(seriesId);
    if (!episode) {
      logger.info({ seriesId }, "No pending episodes to publish");
      return null;
    }
    return await processEpisode(seriesId, episode.id);
  } catch (err) {
    logger.error({ err, seriesId }, "Daily publish failed");
    return null;
  }
}

// ─── Generate + publish episode on demand ──────────────────────────────────

export async function generateAndPublishNow(
  seriesId: number,
  onProgress?: (step: string) => Promise<void>
): Promise<PipelineResult> {
  const series = await getSeries(seriesId);
  if (!series) return { episodeId: 0, success: false, error: "Series not found" };

  const episodes = await getSeriesEpisodes(seriesId);
  const nextNumber = episodes.length + 1;

  if (onProgress) await onProgress("📝 جاري كتابة سيناريو الحلقة...");

  const previousSummaries = episodes
    .filter((e) => e.status === "published")
    .slice(-3)
    .map((e) => e.title || "");

  const epScript = await generateSingleEpisode(
    series.title,
    series.genre,
    series.characters,
    previousSummaries,
    nextNumber
  );

  const episode = await createEpisode({
    series_id: seriesId,
    episode_number: nextNumber,
    title: epScript.title,
    script: epScript.script,
    status: "pending",
  });

  if (!episode) return { episodeId: 0, success: false, error: "Failed to create episode" };

  return await processEpisode(seriesId, episode.id, onProgress);
}
