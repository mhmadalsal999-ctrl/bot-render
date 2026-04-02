// ═══════════════════════════════════════════════════════════════════
// captionService.js — Professional Word-by-Word Captions
//
// HOW IT WORKS:
// • Each word is on its own ASS Dialogue line
// • Inactive words = WHITE with black outline
// • Active word (being spoken) = BLUE (#00B4FF) + slightly bigger
// • Previous words = WHITE (already said)
// • Result: exact TikTok/Hormozi style — one word lights up at a time
//
// QUALITY OPTIONS: 1080p / 1440p(2K) / 2160p(4K)
// ═══════════════════════════════════════════════════════════════════

import ffmpegStatic from 'ffmpeg-static';
import Ffmpeg from 'fluent-ffmpeg';
import fs from 'fs-extra';
import path from 'path';
import { logger } from '../utils/logger.js';
import { TEMP_DIR, probeVideo } from './ffmpegService.js';

Ffmpeg.setFfmpegPath(ffmpegStatic);

// ─────────────────────────────────────────────────────────────────
// CAPTION STYLE — Change colors here to customize
// ASS colors are in &HAABBGGRR format (Alpha, Blue, Green, Red)
// ─────────────────────────────────────────────────────────────────
const CAPTION_STYLE = {
  fontName:       'Arial',
  bold:           1,

  // Colors
  whiteColor:     '&H00FFFFFF',   // inactive words — white
  blueColor:      '&H00FFB400',   // active word — TikTok blue (#00B4FF in BGR)
  outlineColor:   '&H00000000',   // black outline
  shadowColor:    '&HCC000000',   // dark semi-transparent shadow

  // Sizes (relative to video height)
  fontSizeRatio:  0.046,          // font = height × 4.6%
  activeSizeBoost: 1.08,          // active word is 8% bigger
  outlineRatio:   0.07,           // outline = fontSize × 7%
  marginVRatio:   0.09,           // from bottom = height × 9%

  wordsPerGroup:  4,              // words shown at once
  shadow:         1,
  alignment:      2               // center-bottom
};

// ─────────────────────────────────────────────────────────────────
// Detect video dimensions & compute style params
// ─────────────────────────────────────────────────────────────────
async function getStyle(videoPath) {
  const meta = await probeVideo(videoPath);
  const vs   = meta.streams.find(s => s.codec_type === 'video');
  const w    = vs?.width  || 1080;
  const h    = vs?.height || 1920;

  const fontSize     = Math.round(h * CAPTION_STYLE.fontSizeRatio);
  const activeSize   = Math.round(fontSize * CAPTION_STYLE.activeSizeBoost);
  const outline      = Math.max(2, Math.round(fontSize * CAPTION_STYLE.outlineRatio));
  const marginV      = Math.round(h * CAPTION_STYLE.marginVRatio);
  const wordsPerLine = w > h ? 6 : CAPTION_STYLE.wordsPerGroup;

  return {
    ...CAPTION_STYLE,
    fontSize, activeSize, outline, marginV,
    playResX: w, playResY: h, wordsPerLine
  };
}

// ─────────────────────────────────────────────────────────────────
// seconds → ASS timestamp  H:MM:SS.cc
// ─────────────────────────────────────────────────────────────────
function toASS(sec) {
  const s  = Math.max(0, sec);
  const h  = Math.floor(s / 3600);
  const m  = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.round((s % 1) * 100);
  return `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}

// ─────────────────────────────────────────────────────────────────
// Clean a single word for ASS (remove special chars)
// ─────────────────────────────────────────────────────────────────
function cleanWord(w) {
  return (w || '')
    .trim()
    .toUpperCase()
    .replace(/\\/g, '')
    .replace(/\{/g, '')
    .replace(/\}/g, '')
    .replace(/[<>]/g, '');
}

// ─────────────────────────────────────────────────────────────────
// Group words into chunks (shown together on screen)
// ─────────────────────────────────────────────────────────────────
function groupWords(words, n) {
  const groups = [];
  for (let i = 0; i < words.length; i += n) {
    const slice = words.slice(i, i + n);
    groups.push({
      words: slice,
      start: slice[0].start,
      end:   slice[slice.length - 1].end + 0.04
    });
  }
  return groups;
}

// ─────────────────────────────────────────────────────────────────
// BUILD ASS CONTENT
//
// Strategy: One Dialogue line per WORD (not per group).
// Each word line spans its own timing window.
// Within each word line, we show the full group but highlight
// only the current word using inline override tags.
//
// This gives frame-accurate per-word highlight.
// ─────────────────────────────────────────────────────────────────
function buildASS(words, style) {
  // ── Header ──────────────────────────────────────────────────────
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${style.playResX}`,
    `PlayResY: ${style.playResY}`,
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    'WrapStyle: 0',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Base style: white, center-bottom
    `Style: Base,${style.fontName},${style.fontSize},${style.whiteColor},${style.blueColor},${style.outlineColor},${style.shadowColor},${style.bold},0,0,0,100,100,0,0,1,${style.outline},${style.shadow},${style.alignment},20,20,${style.marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ].join('\n');

  // ── Dialogue lines ───────────────────────────────────────────────
  const groups = groupWords(words, style.wordsPerLine);
  const lines  = [];

  // For each group, create one dialogue line per word in the group
  // During each word's time window, that word is BLUE + bigger,
  // all other words in the group are WHITE
  for (const group of groups) {
    for (let wi = 0; wi < group.words.length; wi++) {
      const activeWord = group.words[wi];

      // Build the full line text with per-word color overrides
      const parts = group.words.map((w, j) => {
        const word = cleanWord(w.word);
        if (j === wi) {
          // Active word: blue + slightly bigger + bold
          return `{\\c${style.blueColor}\\fs${style.activeSize}\\b1}${word}{\\c${style.whiteColor}\\fs${style.fontSize}}`;
        } else {
          // Inactive word: white normal
          return `{\\c${style.whiteColor}\\fs${style.fontSize}}${word}`;
        }
      });

      // Join with spaces
      const text = parts.join(' ');

      // This line shows during the active word's time window
      const lineStart = activeWord.start;
      const lineEnd   = activeWord.end + 0.02;

      lines.push(
        `Dialogue: 0,${toASS(lineStart)},${toASS(lineEnd)},Base,,0,0,0,,${text}`
      );
    }
  }

  return header + '\n' + lines.join('\n') + '\n';
}

// ═══════════════════════════════════════════════════════════════════
// MAIN EXPORT: Burn word-by-word blue captions into video
// ═══════════════════════════════════════════════════════════════════
export async function addHormoziCaptions(inputPath, words) {
  const output  = path.join(TEMP_DIR, `cap_${Date.now()}.mp4`);
  const assFile = path.join(TEMP_DIR, `sub_${Date.now()}.ass`);

  // No words → just copy
  if (!words?.length) {
    logger.warn('CAPTIONS', 'No words — skipping captions');
    await fs.copy(inputPath, output);
    return output;
  }

  // Clean + validate words
  const clean = words
    .filter(w => w?.word?.trim().length > 0)
    .map((w, i, arr) => ({
      word:  w.word.trim(),
      start: typeof w.start === 'number' ? w.start : (i === 0 ? 0 : (arr[i-1].end ?? 0)),
      end:   typeof w.end   === 'number' ? w.end   : (w.start ?? 0) + 0.35
    }))
    .filter(w => w.end > w.start && cleanWord(w.word).length > 0);

  if (!clean.length) {
    logger.warn('CAPTIONS', 'No usable words after cleaning');
    await fs.copy(inputPath, output);
    return output;
  }

  logger.clip(`Burning captions: ${clean.length} words, style: blue-highlight`);

  try {
    const style = await getStyle(inputPath);
    const ass   = buildASS(clean, style);
    await fs.writeFile(assFile, ass, 'utf8');

    logger.info('CAPTIONS', `ASS written: ${clean.length} words → ${path.basename(assFile)}`);

    // Escape path for ffmpeg filter string
    const escapedAss = assFile
      .replace(/\\/g, '/')
      .replace(/:/g, '\\:')
      .replace(/'/g, "\\'");

    await new Promise((resolve, reject) => {
      Ffmpeg(inputPath)
        .videoFilter(`ass='${escapedAss}'`)
        .outputOptions([
          '-c:v', 'libx264',
          '-preset', 'fast',
          '-crf', '18',
          '-c:a', 'copy',
          '-movflags', '+faststart'
        ])
        .output(output)
        .on('start', () => logger.info('CAPTIONS', 'ffmpeg burning captions...'))
        .on('end',   () => logger.success('CAPTIONS', '✓ Blue captions burned'))
        .on('error', reject)
        .run();
    });

  } catch (err) {
    logger.warn('CAPTIONS', `ASS failed: ${err.message} — trying fallback`);
    await fallbackCaptions(inputPath, clean, output);
  } finally {
    await fs.remove(assFile).catch(() => {});
  }

  return output;
}

// ─────────────────────────────────────────────────────────────────
// FALLBACK: simple centered drawtext if ASS burns fail
// ─────────────────────────────────────────────────────────────────
async function fallbackCaptions(inputPath, words, output) {
  logger.warn('CAPTIONS', 'Using drawtext fallback');
  const style  = await getStyle(inputPath);
  const groups = groupWords(words, style.wordsPerLine);

  // One filter per group — shows whole group as white text
  const filters = groups.map(g => {
    const text = g.words.map(w => cleanWord(w.word)).join(' ')
      .replace(/'/g, '\u2019')
      .replace(/[:\\[\]{}]/g, '');

    return [
      `drawtext=text='${text}'`,
      `fontsize=${style.fontSize}`,
      `fontcolor=white`,
      `bordercolor=black`,
      `borderw=${style.outline}`,
      `x=(w-text_w)/2`,
      `y=h-${style.marginV + style.fontSize}`,
      `enable='between(t,${g.start},${g.end})'`
    ].join(':');
  });

  await new Promise((resolve) => {
    Ffmpeg(inputPath)
      .videoFilter(filters.join(','))
      .outputOptions(['-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-c:a', 'copy'])
      .output(output)
      .on('end', resolve)
      .on('error', async () => {
        logger.warn('CAPTIONS', 'Fallback also failed — copy without captions');
        await fs.copy(inputPath, output);
        resolve();
      })
      .run();
  });
}

// ═══════════════════════════════════════════════════════════════════
// WATERMARK — semi-transparent, top-right corner
// ═══════════════════════════════════════════════════════════════════
export async function addBrandWatermark(inputPath, text) {
  if (!text?.trim()) return inputPath;

  const output  = path.join(TEMP_DIR, `wm_${Date.now()}.mp4`);
  const assFile = path.join(TEMP_DIR, `wm_${Date.now()}.ass`);

  try {
    const style  = await getStyle(inputPath);
    const wmSize = Math.round(style.playResY * 0.022) || 28;

    const ass = [
      '[Script Info]',
      'ScriptType: v4.00+',
      `PlayResX: ${style.playResX}`,
      `PlayResY: ${style.playResY}`,
      'ScaledBorderAndShadow: yes',
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      // Alignment 9 = top-right, 70% white
      `Style: WM,Arial,${wmSize},&HB3FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,1,0,9,15,15,15,1`,
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      `Dialogue: 0,0:00:00.00,9:59:59.00,WM,,0,0,0,,${text.replace(/[\\{}]/g, '')}`
    ].join('\n');

    await fs.writeFile(assFile, ass, 'utf8');

    const escapedAss = assFile.replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"\\'");

    await new Promise((resolve, reject) => {
      Ffmpeg(inputPath)
        .videoFilter(`ass='${escapedAss}'`)
        .outputOptions(['-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-c:a', 'copy', '-movflags', '+faststart'])
        .output(output)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    logger.success('CAPTIONS', `Watermark "${text}" added`);

  } catch (err) {
    logger.warn('CAPTIONS', `Watermark failed: ${err.message} — skipping`);
    await fs.copy(inputPath, output);
  } finally {
    await fs.remove(assFile).catch(() => {});
  }

  return output;
}
