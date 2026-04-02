// ═══════════════════════════════════════════════════════════════════
// downloaderService.js — YouTube downloader using yt-dlp binary
// Auto-downloads yt-dlp from GitHub on first run via axios
// No system yt-dlp needed — works on Render free tier
// ═══════════════════════════════════════════════════════════════════

import axios from 'axios';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const execAsync     = promisify(exec);
const execFileAsync = promisify(execFile);

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR   = path.join(__dirname, '../temp');
const BIN_DIR    = path.join(__dirname, '../bin');
const YTDLP_BIN  = path.join(BIN_DIR, 'yt-dlp');

await fs.ensureDir(TEMP_DIR);
await fs.ensureDir(BIN_DIR);

// ── Download yt-dlp binary from GitHub if not present ─────────────
let _ytdlpReady = false;

async function ensureYtDlp() {
  if (_ytdlpReady) return;

  if (!(await fs.pathExists(YTDLP_BIN))) {
    logger.info('DOWNLOADER', 'Downloading yt-dlp binary from GitHub...');
    const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 60000
    });
    await fs.writeFile(YTDLP_BIN, Buffer.from(response.data));
    await fs.chmod(YTDLP_BIN, 0o755);
    logger.success('DOWNLOADER', 'yt-dlp binary ready');
  }

  _ytdlpReady = true;
}

// ── Run yt-dlp with args ───────────────────────────────────────────
async function ytdlp(args, timeoutMs = 120000) {
  await ensureYtDlp();
  return execFileAsync(YTDLP_BIN, args, { timeout: timeoutMs });
}

// ── Get video metadata ─────────────────────────────────────────────
export async function getVideoInfo(url) {
  try {
    const { stdout } = await ytdlp([
      '--no-playlist',
      '--print-json',
      '--skip-download',
      url
    ], 30000);

    const info = JSON.parse(stdout.trim().split('\n')[0]);
    return {
      title:     info.title    || 'Unknown',
      channel:   info.uploader || info.channel || 'Unknown',
      duration:  info.duration || 0,
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

  const filename   = `clip_${Date.now()}.mp4`;
  const outputPath = path.join(TEMP_DIR, filename);

  const duration = endSec - startSec;
  if (duration < 10 || duration > 180) {
    throw new Error(`Invalid clip duration: ${duration}s (must be 10–180s)`);
  }

  logger.clip(`Downloading ${url} [${startSec}s → ${endSec}s] (${duration}s)`);

  try {
    await ytdlp([
      url,
      '--no-playlist',
      '-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--download-sections', `*${startSec}-${endSec}`,
      '--force-keyframes-at-cuts',
      '-o', outputPath
    ], 120000);
  } catch (err) {
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

// ── Fallback: download full then cut with ffmpeg ───────────────────
async function downloadAndCutFallback(url, startSec, endSec, outputPath) {
  const rawPath  = outputPath.replace('.mp4', '_raw.mp4');
  const duration = endSec - startSec;

  await ytdlp([
    url,
    '--no-playlist',
    '-f', 'best[height<=720]',
    '-o', rawPath
  ], 300000);

  const ffmpegStatic = (await import('ffmpeg-static')).default;

  await execFileAsync(ffmpegStatic, [
    '-y',
    '-ss', String(startSec),
    '-i', rawPath,
    '-t', String(duration),
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-avoid_negative_ts', 'make_zero',
    outputPath
  ], { timeout: 120000 });

  await fs.remove(rawPath).catch(() => {});

  if (!(await fs.pathExists(outputPath))) {
    throw new Error('Fallback cut failed');
  }
  return outputPath;
}

// ── Validate YouTube URL ───────────────────────────────────────────
export function isValidYouTubeUrl(url) {
  return /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/live\/)/.test(url);
}

// ── Parse "1:30" or "90" → seconds ────────────────────────────────
export function parseTimeToSeconds(timeStr) {
  if (!timeStr) return null;
  timeStr = String(timeStr).trim();

  if (/^\d+$/.test(timeStr)) return parseInt(timeStr, 10);

  const parts = timeStr.split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];

  return null;
}
