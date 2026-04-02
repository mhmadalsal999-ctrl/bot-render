// ═══════════════════════════════════════════════════════════════════
// downloaderService.js — Download YouTube video clips using yt-dlp
// ═══════════════════════════════════════════════════════════════════

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = path.join(__dirname, '../temp');

await fs.ensureDir(TEMP_DIR);

// ── Get video metadata (title, channel, duration) ─────────────────
export async function getVideoInfo(url) {
  try {
    const { stdout } = await execAsync(
      `yt-dlp --no-playlist --print-json --skip-download "${url}"`,
      { timeout: 30000 }
    );
    const info = JSON.parse(stdout.trim().split('\n')[0]);
    return {
      title:    info.title || 'Unknown',
      channel:  info.uploader || info.channel || 'Unknown',
      duration: info.duration || 0,
      thumbnail: info.thumbnail || null
    };
  } catch (err) {
    logger.warn('DOWNLOADER', `getVideoInfo failed: ${err.message}`);
    return { title: 'Unknown', channel: 'Unknown', duration: 0, thumbnail: null };
  }
}

// ── Download a clip segment (start → end seconds) ─────────────────
export async function downloadClip(url, startSec, endSec) {
  await fs.ensureDir(TEMP_DIR);

  const filename = `clip_${Date.now()}.mp4`;
  const outputPath = path.join(TEMP_DIR, filename);

  const duration = endSec - startSec;
  if (duration < 10 || duration > 180) {
    throw new Error(`Invalid clip duration: ${duration}s (must be 10–180s)`);
  }

  logger.clip(`Downloading ${url} [${startSec}s → ${endSec}s] (${duration}s)`);

  // Download best quality vertical-compatible format, then cut
  const cmd = [
    'yt-dlp',
    '--no-playlist',
    '-f "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"',
    `--download-sections "*${startSec}-${endSec}"`,
    '--force-keyframes-at-cuts',
    '-o', `"${outputPath}"`,
    `"${url}"`
  ].join(' ');

  try {
    await execAsync(cmd, { timeout: 120000 });
  } catch (err) {
    // Fallback: download full then cut with ffmpeg
    logger.warn('DOWNLOADER', `Direct section download failed, trying fallback: ${err.message}`);
    return await downloadAndCutFallback(url, startSec, endSec, outputPath);
  }

  if (!(await fs.pathExists(outputPath))) {
    throw new Error('Downloaded file not found after yt-dlp');
  }

  const stat = await fs.stat(outputPath);
  logger.success('DOWNLOADER', `Downloaded: ${filename} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);

  return outputPath;
}

// ── Fallback: download full video then cut ─────────────────────────
async function downloadAndCutFallback(url, startSec, endSec, outputPath) {
  const rawPath = outputPath.replace('.mp4', '_raw.mp4');
  const duration = endSec - startSec;

  // Download
  await execAsync(
    `yt-dlp --no-playlist -f "best[height<=720]" -o "${rawPath}" "${url}"`,
    { timeout: 300000 }
  );

  // Cut with ffmpeg
  const ffmpegStatic = (await import('ffmpeg-static')).default;
  await execAsync(
    `"${ffmpegStatic}" -y -ss ${startSec} -i "${rawPath}" -t ${duration} -c:v libx264 -c:a aac -avoid_negative_ts make_zero "${outputPath}"`,
    { timeout: 120000 }
  );

  await fs.remove(rawPath).catch(() => {});

  if (!(await fs.pathExists(outputPath))) {
    throw new Error('Fallback cut failed');
  }

  return outputPath;
}

// ── Validate a YouTube URL ─────────────────────────────────────────
export function isValidYouTubeUrl(url) {
  return /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/live\/)/.test(url);
}

// ── Parse time string "1:30" or "90" → seconds ────────────────────
export function parseTimeToSeconds(timeStr) {
  if (!timeStr) return null;
  timeStr = String(timeStr).trim();

  if (/^\d+$/.test(timeStr)) return parseInt(timeStr, 10);

  const parts = timeStr.split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];

  return null;
}
