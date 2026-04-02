// ═══════════════════════════════════════════════════════════════════
// messageHandler.js — All text + video upload handling
// Fast response: answer immediately, process in background
// ═══════════════════════════════════════════════════════════════════

import {
  getUserState, setUserState, getUserClips,
  getYouTubeChannel, saveYouTubeChannel, createClip, getTotalEarnings
} from '../../db/database.js';
import {
  mainKeyboard, cancelKeyboard, durationKeyboard, qualityKeyboard,
  clipsListKeyboard, WELCOME_MSG, HELP_MSG, STATUS_LABELS
} from '../messages.js';
import { isValidYouTubeUrl, parseTimeToSeconds, getVideoInfo } from '../../services/downloaderService.js';
import { verifyYouTubeCredentials }  from '../../services/youtubeService.js';
import { formatViews }               from '../../services/viewTrackerService.js';
import { triggerProcessClip }        from '../../services/cronScheduler.js';
import { getVideoDuration }          from '../../services/ffmpegService.js';
import { logger }                    from '../../utils/logger.js';
import fs   from 'fs-extra';
import path from 'path';
import axios from 'axios';

const UPLOAD_DIR = '/tmp/clipbot_uploads';
await fs.ensureDir(UPLOAD_DIR);

export const STATES = {
  IDLE:             'idle',
  AWAIT_URL:        'await_url',
  AWAIT_START:      'await_start',
  AWAIT_DURATION:   'await_duration',
  AWAIT_QUALITY:    'await_quality',
  YT_CLIENT_ID:     'yt_client_id',
  YT_CLIENT_SECRET: 'yt_client_secret',
  YT_REFRESH_TOKEN: 'yt_refresh_token',
  AWAIT_TT_LINK:    'await_tt_link',
  AWAIT_IG_LINK:    'await_ig_link'
};

// ════════════════════════════════════════════════════════════════════
// Handle direct video file upload
// ════════════════════════════════════════════════════════════════════
async function handleVideoUpload(bot, msg, userId, chatId, fileObj) {
  const sizeMB = (fileObj.file_size || 0) / 1_048_576;

  if (sizeMB > 50) {
    return bot.sendMessage(chatId,
      `❌ *File too large* (${sizeMB.toFixed(0)}MB)\n\nMax: 50MB\n_For longer videos, send a YouTube link._`,
      { parse_mode: 'Markdown', ...mainKeyboard() }
    );
  }

  // Reply immediately so user knows we got it
  const ack = await bot.sendMessage(chatId,
    `📥 *Receiving video...*\n_${sizeMB.toFixed(1)}MB — this takes a few seconds_`,
    { parse_mode: 'Markdown' }
  );

  try {
    const fileInfo = await bot.getFile(fileObj.file_id);
    const dlUrl    = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;
    const savePath = path.join(UPLOAD_DIR, `${userId}_${Date.now()}.mp4`);

    const resp = await axios.get(dlUrl, { responseType: 'arraybuffer', timeout: 180_000 });
    await fs.writeFile(savePath, resp.data);

    const duration    = await getVideoDuration(savePath);
    const durationStr = `${Math.floor(duration / 60)}m ${Math.floor(duration % 60)}s`;
    const endSec      = Math.min(Math.round(duration), 90);

    await bot.deleteMessage(chatId, ack.message_id).catch(() => {});

    const clip = await createClip({
      user_id:        userId,
      source_url:     `local:${savePath}`,
      source_title:   msg.caption || fileObj.file_name || 'Uploaded Video',
      source_channel: 'Direct Upload',
      clip_start_sec: 0,
      clip_end_sec:   endSec,
      watermark_text: process.env.WATERMARK_TEXT || '@ClipBot',
      status:         'pending'
    });

    await bot.sendMessage(chatId,
      `✅ *Video received!*\n\n` +
      `📹 ${msg.caption || 'Your video'}\n` +
      `⏱ Duration: ${durationStr}\n` +
      `📦 Size: ${sizeMB.toFixed(1)}MB\n\n` +
      `⚙️ *Processing now...*\n` +
      `_I'll send you the finished clip when it's ready!_`,
      { parse_mode: 'Markdown', ...mainKeyboard() }
    );

    // Fire and forget — cron handles it
    triggerProcessClip(clip.id).catch(e =>
      logger.error('MSG', `triggerProcessClip: ${e.message}`)
    );

  } catch (err) {
    await bot.deleteMessage(chatId, ack.message_id).catch(() => {});
    logger.error('MSG', `Video upload error: ${err.message}`);
    bot.sendMessage(chatId,
      `❌ *Failed to receive video*\n_${err.message}_\n\nTry again or send a YouTube link.`,
      { parse_mode: 'Markdown', ...mainKeyboard() }
    );
  }
}

// ════════════════════════════════════════════════════════════════════
// MAIN MESSAGE HANDLER
// ════════════════════════════════════════════════════════════════════
export async function handleMessage(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();

  // ── Video / document upload ────────────────────────────────────
  const fileObj = msg.video || msg.document;
  if (fileObj) {
    const mime = fileObj.mime_type || '';
    if (fileObj === msg.video || mime.startsWith('video/')) {
      return handleVideoUpload(bot, msg, userId, chatId, fileObj);
    }
  }

  if (!msg.text) return;
  const text = msg.text.trim();

  const sd       = await getUserState(userId);
  const state    = sd?.state     || STATES.IDLE;
  const tempData = sd?.temp_data || {};

  // ── /start ────────────────────────────────────────────────────
  if (text === '/start') {
    await setUserState(userId, STATES.IDLE, {});
    return bot.sendMessage(chatId, WELCOME_MSG, { parse_mode: 'Markdown', ...mainKeyboard() });
  }

  // ── /help ─────────────────────────────────────────────────────
  if (text === '/help' || text === '❓ Help') {
    return bot.sendMessage(chatId, HELP_MSG, { parse_mode: 'Markdown', ...mainKeyboard() });
  }

  // ── Cancel ────────────────────────────────────────────────────
  if (text === '/cancel' || text === '❌ Cancel') {
    await setUserState(userId, STATES.IDLE, {});
    return bot.sendMessage(chatId, '✅ Cancelled. What would you like to do?', mainKeyboard());
  }

  // ── ✂️ New Clip ───────────────────────────────────────────────
  if (text === '✂️ New Clip') {
    await setUserState(userId, STATES.AWAIT_URL, {});
    return bot.sendMessage(chatId,
      `✂️ *New Clip*\n\n` +
      `Send me:\n` +
      `🔗 A *YouTube link* — I'll clip the part you choose\n` +
      `📤 A *video file* — I'll process it directly (up to 50MB)\n\n` +
      `_Any format, any orientation — I'll handle it!_`,
      { parse_mode: 'Markdown', ...cancelKeyboard() }
    );
  }

  // ── 📁 My Clips ───────────────────────────────────────────────
  if (text === '📁 My Clips') {
    const clips = await getUserClips(userId);
    if (!clips.length) {
      return bot.sendMessage(chatId,
        `📭 *No clips yet!*\n\nTap *✂️ New Clip* to create your first one.`,
        { parse_mode: 'Markdown', ...mainKeyboard() }
      );
    }
    const lines = clips.slice(0, 8).map((c, i) => {
      const s = STATUS_LABELS[c.status] || '📹';
      const t = (c.source_title || 'Clip').slice(0, 32);
      return `${i + 1}\\. ${s} — _${t}_`;
    }).join('\n');

    return bot.sendMessage(chatId,
      `📁 *My Clips* \\(${clips.length} total\\)\n\n${lines}\n\n_Tap a clip to manage it:_`,
      { parse_mode: 'MarkdownV2', ...clipsListKeyboard(clips) }
    );
  }

  // ── 📊 Stats & Earnings ───────────────────────────────────────
  if (text === '📊 Stats & Earnings') {
    const clips    = await getUserClips(userId, 100);
    const earnings = await getTotalEarnings(userId);
    const published = clips.filter(c => c.status === 'published').length;
    const ready     = clips.filter(c => c.status === 'ready').length;
    const ytV  = clips.reduce((s, c) => s + (c.views_youtube   || 0), 0);
    const ttV  = clips.reduce((s, c) => s + (c.views_tiktok    || 0), 0);
    const igV  = clips.reduce((s, c) => s + (c.views_instagram || 0), 0);
    const total = ytV + ttV + igV;

    return bot.sendMessage(chatId, [
      `📊 *Stats & Earnings*`,
      ``,
      `🎬 *Clips*`,
      `├ Total:     ${clips.length}`,
      `├ ✅ Ready:   ${ready}`,
      `└ 📤 Published: ${published}`,
      ``,
      `👁 *Views*`,
      `├ 🎬 YouTube:   ${formatViews(ytV)}`,
      `├ 🎵 TikTok:    ${formatViews(ttV)}`,
      `├ 📸 Instagram: ${formatViews(igV)}`,
      `└ 📈 Total:     *${formatViews(total)}*`,
      ``,
      `💰 *Estimated Earnings*`,
      `└ $${earnings.toFixed(2)} \\(at $3 CPM\\)`
    ].join('\n'), { parse_mode: 'Markdown', ...mainKeyboard() });
  }

  // ── 📺 YouTube Setup ──────────────────────────────────────────
  if (text === '📺 YouTube Setup') {
    const ch = await getYouTubeChannel(userId);
    if (ch?.is_active) {
      return bot.sendMessage(chatId,
        `✅ *YouTube Connected*\n\n📺 Channel: *${ch.channel_title || 'Connected'}*\n\nTo reconnect, send your new Client ID:`,
        { parse_mode: 'Markdown', ...cancelKeyboard() }
      );
    }
    await setUserState(userId, STATES.YT_CLIENT_ID, {});
    return bot.sendMessage(chatId,
      `📺 *Connect YouTube Channel*\n\n` +
      `*Steps:*\n` +
      `1\\. [Google Cloud Console](https://console.cloud.google.com) → New Project\n` +
      `2\\. Enable *YouTube Data API v3*\n` +
      `3\\. Create *OAuth 2\\.0* credentials \\(Desktop\\)\n` +
      `4\\. [OAuth Playground](https://developers.google.com/oauthplayground) → get Refresh Token\n\n` +
      `*Send your Client ID now:*`,
      { parse_mode: 'MarkdownV2', disable_web_page_preview: true, ...cancelKeyboard() }
    );
  }

  // ── STATE: Awaiting YouTube URL ───────────────────────────────
  if (state === STATES.AWAIT_URL) {
    if (!isValidYouTubeUrl(text)) {
      return bot.sendMessage(chatId,
        `❌ That's not a valid YouTube link.\n\nTry:\n\`https://youtube.com/watch?v=...\`\n\n_Or just upload a video file directly!_ 📤`,
        { parse_mode: 'Markdown' }
      );
    }

    const loading = await bot.sendMessage(chatId, '🔍 _Fetching video info..._', { parse_mode: 'Markdown' });

    try {
      const info = await getVideoInfo(text);
      await bot.deleteMessage(chatId, loading.message_id).catch(() => {});

      const durStr = info.duration
        ? `⏱ Duration: ${Math.floor(info.duration/60)}m ${Math.floor(info.duration%60)}s`
        : '';

      await setUserState(userId, STATES.AWAIT_START, {
        url: text, title: info.title,
        channel: info.channel, total_duration: info.duration
      });

      return bot.sendMessage(chatId,
        `✅ *Video Found!*\n\n` +
        `📹 *${info.title}*\n` +
        `📺 ${info.channel}\n${durStr}\n\n` +
        `*Enter the start time of your clip:*\n` +
        `_Examples: \`2:30\` or \`150\` (seconds)_`,
        { parse_mode: 'Markdown', ...cancelKeyboard() }
      );
    } catch (err) {
      await bot.deleteMessage(chatId, loading.message_id).catch(() => {});
      return bot.sendMessage(chatId,
        `❌ Couldn't load video info.\n_${err.message}_\n\nMake sure the video is public.`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  // ── STATE: Awaiting start time ────────────────────────────────
  if (state === STATES.AWAIT_START) {
    const startSec = parseTimeToSeconds(text);
    if (startSec === null || startSec < 0) {
      return bot.sendMessage(chatId,
        `❌ Invalid format. Use \`2:30\` or \`150\``, { parse_mode: 'Markdown' }
      );
    }
    const total = tempData.total_duration || 0;
    if (total && startSec >= total) {
      return bot.sendMessage(chatId,
        `❌ Start time (${startSec}s) is beyond video length (${Math.round(total)}s).`
      );
    }
    await setUserState(userId, STATES.AWAIT_QUALITY, { ...tempData, start_sec: startSec });

    const mm = String(Math.floor(startSec/60)).padStart(2,'0');
    const ss = String(startSec % 60).padStart(2,'0');
    return bot.sendMessage(chatId,
      `⏱ *Start:* ${mm}:${ss}\n\n*Choose clip duration:*`,
      { parse_mode: 'Markdown', ...durationKeyboard() }
    );
  }

  // ── STATE: Awaiting TikTok link ───────────────────────────────
  if (state === STATES.AWAIT_TT_LINK) {
    const clipId = tempData.clip_id;
    if (clipId && text.includes('tiktok')) {
      const { updateClip } = await import('../../db/database.js');
      await updateClip(parseInt(clipId), { tiktok_url: text, status: 'published' });
      await setUserState(userId, STATES.IDLE, {});
      return bot.sendMessage(chatId,
        `✅ *TikTok link saved!*\n\nViews will be tracked automatically.`,
        { parse_mode: 'Markdown', ...mainKeyboard() }
      );
    }
    return bot.sendMessage(chatId, `❌ That doesn't look like a TikTok link. Try again:`);
  }

  // ── STATE: Awaiting Instagram link ────────────────────────────
  if (state === STATES.AWAIT_IG_LINK) {
    const clipId = tempData.clip_id;
    if (clipId && (text.includes('instagram') || text.includes('instagr.am'))) {
      const { updateClip } = await import('../../db/database.js');
      await updateClip(parseInt(clipId), { instagram_url: text, status: 'published' });
      await setUserState(userId, STATES.IDLE, {});
      return bot.sendMessage(chatId,
        `✅ *Instagram link saved!*\n\nViews will be tracked automatically.`,
        { parse_mode: 'Markdown', ...mainKeyboard() }
      );
    }
    return bot.sendMessage(chatId, `❌ Doesn't look like an Instagram link. Try again:`);
  }

  // ── STATE: YouTube OAuth ──────────────────────────────────────
  if (state === STATES.YT_CLIENT_ID) {
    if (text.length < 10) return bot.sendMessage(chatId, '❌ Invalid Client ID. Try again:');
    await setUserState(userId, STATES.YT_CLIENT_SECRET, { ...tempData, client_id: text });
    return bot.sendMessage(chatId, '✅ Got it!\n\n*Now send your Client Secret:*', { parse_mode: 'Markdown' });
  }

  if (state === STATES.YT_CLIENT_SECRET) {
    if (text.length < 5) return bot.sendMessage(chatId, '❌ Invalid. Try again:');
    await setUserState(userId, STATES.YT_REFRESH_TOKEN, { ...tempData, client_secret: text });
    return bot.sendMessage(chatId, '✅ Got it!\n\n*Now send your Refresh Token:*', { parse_mode: 'Markdown' });
  }

  if (state === STATES.YT_REFRESH_TOKEN) {
    if (text.length < 10) return bot.sendMessage(chatId, '❌ Invalid token. Try again:');
    const creds = { client_id: tempData.client_id, client_secret: tempData.client_secret, refresh_token: text };
    const loading = await bot.sendMessage(chatId, '🔍 _Verifying credentials..._', { parse_mode: 'Markdown' });
    const verify  = await verifyYouTubeCredentials(creds);
    await bot.deleteMessage(chatId, loading.message_id).catch(() => {});

    if (!verify.valid) {
      return bot.sendMessage(chatId,
        `❌ *Invalid credentials*\n_${verify.error}_\n\nStart over: /start`,
        { parse_mode: 'Markdown' }
      );
    }
    await saveYouTubeChannel(userId, {
      ...creds, channel_id: verify.channelId,
      channel_title: verify.channelTitle, is_active: true
    });
    await setUserState(userId, STATES.IDLE, {});
    return bot.sendMessage(chatId,
      `✅ *YouTube Connected!*\n\n📺 *${verify.channelTitle}*\n\nI can now auto-upload your clips to Shorts!`,
      { parse_mode: 'Markdown', ...mainKeyboard() }
    );
  }
}
