// ═══════════════════════════════════════════════════════════════════
// clipPipeline.js — Full clip processing pipeline
// Smart orientation + parallel AI + proper cleanup
// ═══════════════════════════════════════════════════════════════════

import { downloadClip }                         from './downloaderService.js';
import { transcribeAudio, generateCaptionFromTranscript, suggestMusicMood, generateYouTubeMetadata } from './groqService.js';
import { convertToVertical, addBackgroundMusic, getVideoDuration, TEMP_DIR } from './ffmpegService.js';
import { addHormoziCaptions, addBrandWatermark } from './captionService.js';
import { extractAudioFromVideo }                from './audioService.js';
import { uploadVideoToSupabase }                from './storageService.js';
import { updateClip, logActivity }              from '../db/database.js';
import { logger }                               from '../utils/logger.js';
import fs from 'fs-extra';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

export async function runClipPipeline(clip, progressCallback = null) {
  const notify = async (msg) => {
    logger.clip(msg.replace(/\*/g, ''));
    if (progressCallback) {
      try { await progressCallback(msg); } catch (_) {}
    }
  };

  const toClean = []; // files to delete at end

  try {
    await updateClip(clip.id, { status: 'processing' });

    // ══════════════════════════════════════════════════════════════
    // STEP 1 — Get raw video (local upload OR YouTube download)
    // ══════════════════════════════════════════════════════════════
    let rawPath;
    const isLocal = clip.source_url?.startsWith('local:');

    if (isLocal) {
      rawPath = clip.source_url.replace('local:', '');
      await notify('📁 *Step 1/6:* Using your uploaded video...');
      if (!(await fs.pathExists(rawPath))) {
        throw new Error('Uploaded file missing — please re-send the video.');
      }
    } else {
      await notify('⬇️ *Step 1/6:* Downloading from YouTube...');
      rawPath = await downloadClip(
        clip.source_url,
        clip.clip_start_sec || 0,
        clip.clip_end_sec   || 60
      );
      toClean.push(rawPath);
    }

    // ══════════════════════════════════════════════════════════════
    // STEP 2 — Smart convert to vertical 9:16 (auto-detects aspect ratio)
    // ══════════════════════════════════════════════════════════════
    const targetRes = clip.quality || 1080;
    await notify(`📐 *Step 2/6:* Converting to ${targetRes}p vertical 9:16...`);
    const vertPath = await convertToVertical(rawPath, targetRes);
    toClean.push(vertPath);

    // ══════════════════════════════════════════════════════════════
    // STEP 3 — Extract audio + Transcribe (parallel with nothing else yet)
    // ══════════════════════════════════════════════════════════════
    await notify('🎙️ *Step 3/6:* Transcribing audio (AI)...');
    const audioPath = await extractAudioFromVideo(vertPath);
    toClean.push(audioPath);

    const transcription = await transcribeAudio(audioPath);
    const transcript    = transcription.text  || '';
    const words         = transcription.words || [];

    logger.clip(`Transcript: "${transcript.slice(0, 80)}..." (${words.length} words)`);

    // Run AI caption generation + mood detection in PARALLEL (saves ~3s)
    const [captionData, mood] = await Promise.all([
      generateCaptionFromTranscript(
        transcript,
        clip.source_title   || 'Video Clip',
        clip.source_channel || 'Creator'
      ),
      suggestMusicMood(transcript)
    ]);

    // ══════════════════════════════════════════════════════════════
    // STEP 4 — Burn Hormozi-style captions (adaptive to video size)
    // ══════════════════════════════════════════════════════════════
    await notify('📝 *Step 4/6:* Burning Hormozi captions...');
    const captionedPath = await addHormoziCaptions(vertPath, words);
    toClean.push(captionedPath);

    // ══════════════════════════════════════════════════════════════
    // STEP 5 — Brand watermark (adaptive position)
    // ══════════════════════════════════════════════════════════════
    const wmText = clip.watermark_text || process.env.WATERMARK_TEXT || '@ClipBot';
    await notify(`🔖 *Step 5/6:* Adding watermark "${wmText}"...`);
    const wmPath = await addBrandWatermark(captionedPath, wmText);
    toClean.push(wmPath);

    // ══════════════════════════════════════════════════════════════
    // STEP 6 — Background music
    // ══════════════════════════════════════════════════════════════
    await notify(`🎵 *Step 6/6:* Adding ${mood} music...`);
    const finalPath = await addBackgroundMusic(wmPath, mood, 0.10);
    // finalPath is NOT in toClean — we keep it for upload

    // ══════════════════════════════════════════════════════════════
    // Upload to Supabase Storage
    // ══════════════════════════════════════════════════════════════
    await notify('☁️ Uploading to cloud...');
    let videoUrl = null;
    try {
      videoUrl = await uploadVideoToSupabase(finalPath, `clip_${clip.id}_${Date.now()}.mp4`);
    } catch (upErr) {
      logger.warn('PIPELINE', `Storage upload failed: ${upErr.message}`);
    }

    const duration = await getVideoDuration(finalPath);

    // Generate YouTube metadata (can run while we finalize)
    let ytMeta = null;
    try {
      ytMeta = await generateYouTubeMetadata(captionData.caption, transcript, clip.source_title || 'Clip');
    } catch (_) {}

    // ══════════════════════════════════════════════════════════════
    // Save everything to DB
    // ══════════════════════════════════════════════════════════════
    await updateClip(clip.id, {
      status:           'ready',
      caption_text:     captionData.caption    || '',
      hashtags:         captionData.hashtags   || '',
      music_name:       mood,
      watermark_text:   wmText,
      video_url:        videoUrl,
      duration_seconds: Math.round(duration)
    });

    await logActivity(clip.user_id, clip.id, 'pipeline_complete', 'success');

    // Cleanup intermediate files (keep finalPath until after upload)
    for (const f of toClean) await fs.remove(f).catch(() => {});
    await fs.remove(finalPath).catch(() => {}); // now remove final too (already uploaded)

    logger.success('PIPELINE', `Clip ${clip.id} done in ${duration.toFixed(1)}s of video`);

    return { success: true, videoUrl, captionData, ytMeta, transcript, mood, durationSeconds: duration };

  } catch (err) {
    logger.error('PIPELINE', `Clip ${clip.id} FAILED: ${err.message}`);
    await updateClip(clip.id, { status: 'failed', error_message: err.message });
    await logActivity(clip.user_id, clip.id, 'pipeline_failed', 'failed', { error: err.message });
    for (const f of toClean) await fs.remove(f).catch(() => {});
    throw err;
  }
}
