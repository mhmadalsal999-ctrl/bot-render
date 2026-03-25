import {
  getSeries,
  getSeriesEpisodes,
  createEpisode,
  updateEpisode,
  updateSeries,
} from "../db/supabase.js";
import { generateSingleEpisode } from "../services/scenario.js";
import { generateVoice } from "../services/voice.js";
import { generateAnimationClips, combineClipsWithAudio } from "../services/animation.js";
import { uploadToYouTube, buildVideoDescription, isYouTubeConfigured } from "../services/youtube.js";
import { cleanupFiles } from "../services/video.js";
import { logger } from "../lib/logger.js";
import * as path from "path";
import * as os from "os";

export interface PipelineResult {
  success: boolean;
  episodeId: number;
  videoUrl?: string;
  error?: string;
}

export async function generateAndPublishNow(seriesId: number): Promise<PipelineResult> {
  const series = await getSeries(seriesId);
  if (!series) throw new Error(`Series ${seriesId} not found`);

  const episodes = await getSeriesEpisodes(seriesId);
  const episodeNumber = episodes.length + 1;

  const previousSummaries = episodes
    .slice(-3)
    .map((e) => e.script)
    .filter(Boolean);

  // توليد السيناريو
  const episodeScript = await generateSingleEpisode(
    series.title,
    series.genre,
    series.characters,
    previousSummaries,
    episodeNumber
  );

  // إنشاء الحلقة في قاعدة البيانات
  const episode = await createEpisode({
    series_id: seriesId,
    episode_number: episodeNumber,
    title: episodeScript.title,
    script: episodeScript.script,
    status: "generating",
  });

  if (!episode) throw new Error("Failed to create episode");

  const filesToCleanup: string[] = [];

  try {
    // توليد الصوت
    const audioPath = await generateVoice(episodeScript.script, series.voice_id);
    filesToCleanup.push(audioPath);

    // توليد الأنيميشن
    const clips = await generateAnimationClips({
      script: episodeScript.script,
      characters: series.characters,
      genre: series.genre,
      targetDuration: 30,
      sceneCount: 5,
    });

    clips.forEach((c) => filesToCleanup.push(c.clipPath));

    // دمج الفيديو مع الصوت
    const outputPath = path.join(os.tmpdir(), `final_${Date.now()}.mp4`);
    await combineClipsWithAudio(clips, audioPath, outputPath);
    filesToCleanup.push(outputPath);

    await updateEpisode(episode.id, { status: "ready", video_url: outputPath });

    // رفع على يوتيوب إذا مربوط
    if (isYouTubeConfigured() && series.auto_publish) {
      const description = buildVideoDescription(
        series.title,
        episodeNumber,
        episodeScript.title,
        episodeScript.summary
      );

      const result = await uploadToYouTube({
        videoPath: outputPath,
        title: `${series.title} - الحلقة ${episodeNumber}: ${episodeScript.title}`,
        description,
      });

      await updateEpisode(episode.id, {
        status: "published",
        youtube_video_id: result.videoId,
        youtube_url: result.videoUrl,
        published_at: new Date().toISOString(),
      });

      await updateSeries(seriesId, {
        episodes_generated: episodeNumber,
      });

      return { success: true, episodeId: episode.id, videoUrl: result.videoUrl };
    }

    await updateSeries(seriesId, { episodes_generated: episodeNumber });
    return { success: true, episodeId: episode.id };

  } catch (err) {
    await updateEpisode(episode.id, {
      status: "failed",
      error_message: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      episodeId: episode.id,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await cleanupFiles(filesToCleanup);
  }
}

export async function runDailyPublish(seriesId: number): Promise<PipelineResult | null> {
  try {
    return await generateAndPublishNow(seriesId);
  } catch (err) {
    logger.error({ err, seriesId }, "runDailyPublish failed");
    return null;
  }
}

export async function generateSeriesScenario(seriesId: number): Promise<void> {
  logger.info({ seriesId }, "generateSeriesScenario called");
}
