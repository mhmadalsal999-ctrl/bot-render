// ═══════════════════════════════════════════════════════════════════
// ffmpegService.js — Smart video processing
// Auto-detects aspect ratio, adds music, handles cleanup
// ═══════════════════════════════════════════════════════════════════

import ffmpegStatic from 'ffmpeg-static';
import Ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

Ffmpeg.setFfmpegPath(ffmpegStatic);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const TEMP_DIR = path.join(__dirname, '../temp');
await fs.ensureDir(TEMP_DIR);

// ── Promisified ffprobe ────────────────────────────────────────────
export function probeVideo(filePath) {
  return new Promise((resolve, reject) => {
    Ffmpeg.ffprobe(filePath, (err, meta) => {
      if (err) return reject(new Error(`ffprobe failed: ${err.message}`));
      resolve(meta);
    });
  });
}

// ── Get duration in seconds ────────────────────────────────────────
export async function getVideoDuration(filePath) {
  const meta = await probeVideo(filePath);
  return parseFloat(meta.format.duration) || 0;
}

// ═══════════════════════════════════════════════════════════════════
// Detect video orientation & dimensions
// Returns: { width, height, orientation: 'vertical'|'horizontal'|'square', ratio }
// ═══════════════════════════════════════════════════════════════════
export async function detectOrientation(filePath) {
  const meta = await probeVideo(filePath);
  const vs   = meta.streams.find(s => s.codec_type === 'video');
  if (!vs) throw new Error('No video stream found in file');

  let w = vs.width  || 1920;
  let h = vs.height || 1080;

  // Respect rotation metadata (mobile videos often have rotation tags)
  const rotation = Math.abs(parseInt(vs.tags?.rotate || vs.side_data_list?.[0]?.rotation || '0', 10));
  if (rotation === 90 || rotation === 270) [w, h] = [h, w];

  const ratio = w / h;
  let orientation;
  if (ratio < 0.75)       orientation = 'vertical';    // 9:16 already
  else if (ratio > 1.25)  orientation = 'horizontal';  // 16:9 landscape
  else                    orientation = 'square';       // ~1:1

  logger.info('FFMPEG', `Detected: ${w}x${h} → ${orientation} (ratio ${ratio.toFixed(2)})`);
  return { width: w, height: h, orientation, ratio };
}

// ═══════════════════════════════════════════════════════════════════
// Smart crop/pad → output 1440x2560 (2K 9:16)
// - Vertical already: just scale to 2K
// - Horizontal: blur background + sharp center (no black bars)
// - Square: blur sides + center
// 2K = 1440x2560 → crisp on all modern phones and TikTok/Reels
// ═══════════════════════════════════════════════════════════════════

// Output resolution map
const RESOLUTIONS = {
  1080: { w: 1080, h: 1920, crf: 23, preset: 'ultrafast', bitrate: '2000k', audio: '128k' },
  1440: { w: 1440, h: 2560, crf: 16, preset: 'slow',  bitrate: '8000k', audio: '320k' },
  2160: { w: 2160, h: 3840, crf: 14, preset: 'slow',  bitrate: '20000k', audio: '320k' }
};

export async function convertToVertical(inputPath, targetRes = 1080) {
  const res = RESOLUTIONS[targetRes] || RESOLUTIONS[1080];
  const OUT_W = res.w;
  const OUT_H = res.h;
  const output = path.join(TEMP_DIR, `vert_${Date.now()}.mp4`);
  const info   = await detectOrientation(inputPath);

  let vf;

  if (info.orientation === 'vertical') {
    // Already vertical — scale up to 2K
    vf = `scale=${OUT_W}:${OUT_H}:flags=lanczos,setsar=1`;

  } else if (info.orientation === 'horizontal') {
    // Landscape → blur bg + sharp center at 2K
    vf = [
      `[0:v]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H},boxblur=25:6[bg]`,
      `[0:v]scale=${OUT_W}:-2:flags=lanczos[fg]`,
      '[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1'
    ].join(';');

  } else {
    // Square → blur sides at 2K
    vf = [
      `[0:v]scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase,crop=${OUT_W}:${OUT_H},boxblur=25:6[bg]`,
      `[0:v]scale=${OUT_W}:${OUT_W}:flags=lanczos[fg]`,
      '[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1'
    ].join(';');
  }

  await new Promise((resolve, reject) => {
    const cmd = Ffmpeg(inputPath)
      .outputOptions([
        '-c:v', 'libx264',
        '-preset', res.preset,
        '-crf', String(res.crf),
        '-profile:v', 'high',
        '-level', '5.2',
        '-b:v', res.bitrate,
        '-maxrate', String(Math.round(parseInt(res.bitrate) * 1.25)) + 'k',
        '-bufsize', String(Math.round(parseInt(res.bitrate) * 2)) + 'k',
        '-c:a', 'aac',
        '-b:a', res.audio,
        '-ar', '48000',
        '-movflags', '+faststart',
        '-pix_fmt', 'yuv420p'
      ])
      .output(output);

    // Apply filter
    if (info.orientation === 'vertical') {
      cmd.videoFilter(vf);
    } else {
      cmd.complexFilter(vf);
    }

    cmd
      .on('end', resolve)
      .on('error', reject)
      .run();
  });

  logger.success('FFMPEG', `Converted to vertical: ${path.basename(output)}`);
  return output;
}

// ═══════════════════════════════════════════════════════════════════
// Add background music — royalty-free Pixabay CDN URLs
// ═══════════════════════════════════════════════════════════════════
const MUSIC = {
  energetic:     'https://cdn.pixabay.com/audio/2023/10/30/audio_0a1e54d84a.mp3',
  calm:          'https://cdn.pixabay.com/audio/2022/10/14/audio_7b16c33ea1.mp3',
  dramatic:      'https://cdn.pixabay.com/audio/2022/08/04/audio_2dde668d05.mp3',
  inspirational: 'https://cdn.pixabay.com/audio/2022/10/25/audio_946bc474f0.mp3',
  upbeat:        'https://cdn.pixabay.com/audio/2023/03/27/audio_2cef3a3509.mp3',
  mysterious:    'https://cdn.pixabay.com/audio/2022/11/22/audio_febc508520.mp3'
};

export async function addBackgroundMusic(inputPath, mood = 'energetic', vol = 0.10) {
  const musicUrl = MUSIC[mood] || MUSIC.energetic;
  const output   = path.join(TEMP_DIR, `music_${Date.now()}.mp4`);
  const duration = await getVideoDuration(inputPath);

  logger.info('FFMPEG', `Adding music: ${mood} (vol ${vol}) over ${duration.toFixed(1)}s`);

  await new Promise((resolve, reject) => {
    Ffmpeg()
      .input(inputPath)
      .input(musicUrl)
      .complexFilter([
        `[1:a]aloop=loop=-1:size=2e+09,atrim=duration=${Math.ceil(duration)},asetpts=PTS-STARTPTS,volume=${vol}[music]`,
        `[0:a][music]amix=inputs=2:duration=first:dropout_transition=2[aout]`
      ])
      .outputOptions([
        '-map', '0:v',
        '-map', '[aout]',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '320k',
        '-shortest',
        '-movflags', '+faststart'
      ])
      .output(output)
      .on('end', resolve)
      .on('error', async (err) => {
        logger.warn('FFMPEG', `Music failed: ${err.message} — skipping`);
        await fs.copy(inputPath, output);
        resolve();
      })
      .run();
  });

  return output;
}

// ═══════════════════════════════════════════════════════════════════
// Cleanup temp files older than N hours
// ═══════════════════════════════════════════════════════════════════
export async function cleanupTempFiles(olderThanHours = 2) {
  try {
    if (!(await fs.pathExists(TEMP_DIR))) return;
    const files = await fs.readdir(TEMP_DIR);
    const now   = Date.now();
    let removed = 0;
    for (const f of files) {
      const fp  = path.join(TEMP_DIR, f);
      const st  = await fs.stat(fp).catch(() => null);
      if (!st) continue;
      if ((now - st.mtimeMs) / 3600000 > olderThanHours) {
        await fs.remove(fp);
        removed++;
      }
    }
    if (removed) logger.info('FFMPEG', `Cleaned ${removed} temp files`);
  } catch (e) {
    logger.warn('FFMPEG', `Cleanup error: ${e.message}`);
  }
}
