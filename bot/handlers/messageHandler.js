// ═══════════════════════════════════════════════════════════════════
// messageHandler.js — All text + video upload handling
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
      `❌ *File too large* (${sizeMB.toFixed(0)}MB)\n\nMaximum allowed size is *50MB*.\n_For larger videos, send a YouTube link instead._`,
      { parse_mode: 'Markdown', ...mainKeyboard() }
    );
  }

  const ack = await bot.sendMessage(chatId,
    `📥 *Receiving your video...*\n_${sizeMB.toFixed(1)}MB — just a moment._`,
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
      `⏱ Duration: *${durationStr}*\n` +
      `📦 Size: *${sizeMB.toFixed(1)}MB*\n\n` +
      `⚙️ *Processing has started!*\n` +
      `_I'll notify you as each step completes._`,
      { parse_mode: 'Markdown', ...mainKeyboard() }
    );

    triggerProcessClip(clip.id).catch(e =>
      logger.error('MSG', `triggerProcessClip: ${e.message}`)
    );

  } catch (err) {
    await bot.deleteMessage(chatId, ack.message_id).catch(() => {});
    logger.error('MSG', `Video upload error: ${err.message}`);
    bot.sendMessage(chatId,
      `❌ *Failed to receive video*\n\n_${err.message}_\n\nPlease try again.`,
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

  // ── Video / document upload ──────────────────────────────────
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

  // ── /start ──────────────────────────────────────────────────
  if (text === '/start') {
    await setUserState(userId, STATES.IDLE, {});
    return bot.sendMessage(chatId, WELCOME_MSG, { parse_mode: 'MarkdownV2', ...mainKeyboard() });
  }

  // ── Help ────────────────────────────────────────────────────
  if (text === '/help' || text === '💡 Help') {
    return bot.sendMessage(chatId, HELP_MSG, { parse_mode: 'MarkdownV2', ...mainKeyboard() });
  }

  // ── Cancel ──────────────────────────────────────────────────
  if (text === '/cancel' || text === '❌ Cancel') {
    await setUserState(userId, STATES.IDLE, {});
    return bot.sendMessage(chatId,
      `✅ Cancelled\\. What would you like to do next?`,
      { parse_mode: 'MarkdownV2', ...mainKeyboard() }
    );
  }

  // ── 🎬 New Clip ─────────────────────────────────────────────
  if (text === '🎬 New Clip') {
    await setUserState(userId, STATES.AWAIT_URL, {});
    return bot.sendMessage(chatId,
      `🎬 *New Clip*\n\n` +
      `Send me one of the following:\n\n` +
      `📤 *A video file* — up to 50MB, any format\n` +
      `🔗 *A YouTube link* — I'll clip the exact part you want\n\n` +
      `_Any orientation works — I'll handle everything\\._`,
      { parse_mode: 'MarkdownV2', ...cancelKeyboard() }
    );
  }

  // ── 📂 My Clips ─────────────────────────────────────────────
  if (text === '📂 My Clips') {
    const clips = await getUserClips(userId);
    if (!clips.length) {
      return bot.sendMessage(chatId,
        `📭 *No clips yet\\!*\n\nTap *🎬 New Clip* to create your first one\\.`,
        { parse_mode: 'MarkdownV2', ...mainKeyboard() }
      );
    }

    const lines = clips.slice(0, 8).map((c, i) => {
      const s = STATUS_LABELS[c.status] || '🎬';
      const t = (c.source_title || 'Untitled').slice(0, 30).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
      return `${i + 1}\\. ${s} — _${t}_`;
    }).join('\n');

    return bot.sendMessage(chatId,
      `📂 *My Clips* \\(${clips.length} total\\)\n\n${lines}\n\n_Tap a clip below to manage it:_`,
      { parse_mode: 'MarkdownV2', ...clipsListKeyboard(clips) }
    );
  }

  // ── 📊 My Stats ─────────────────────────────────────────────
  if (text === '📊 My Stats') {
    const clips     = await getUserClips(userId, 100);
    const earnings  = await getTotalEarnings(userId);
    const published = clips.filter(c => c.status === 'published').length;
    const ready     = clips.filter(c => c.status === 'ready').length;
    const ytV  = clips.reduce((s, c) => s + (c.views_youtube   || 0), 0);
    const ttV  = clips.reduce((s, c) => s + (c.views_tiktok    || 0), 0);
    const igV  = clips.reduce((s, c) => s + (c.views_instagram || 0), 0);
    const total = ytV + ttV + igV;

    return bot.sendMessage(chatId,
      `📊 *Your Stats*\n\n` +
      `🎬 *Clips*\n` +
      `┌ Total:      *${clips.length}*\n` +
      `├ ✅ Ready:    *${ready}*\n` +
      `└ 📤 Published: *${published}*\n\n` +
      `👁 *Views*\n` +
      `┌ 🎬 YouTube:    *${formatViews(ytV)}*\n` +
      `├ 🎵 TikTok:     *${formatViews(ttV)}*\n` +
      `├ 📸 Instagram:  *${formatViews(igV)}*\n` +
      `└ 📈 Total:      *${formatViews(total)}*\n\n` +
      `💰 *Estimated Earnings*\n` +
      `└ *\\$${earnings.toFixed(2)}* \\(at \\$3 CPM\\)`,
      { parse_mode: 'MarkdownV2', ...mainKeyboard() }
    );
  }

  // ── 📺 YouTube Setup ────────────────────────────────────────
  if (text === '📺 YouTube Setup') {
    const ch = await getYouTubeChannel(userId);
    if (ch?.is_active) {
      return bot.sendMessage(chatId,
        `✅ *YouTube Connected*\n\n` +
        `📺 Channel: *${(ch.channel_title || 'Connected').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')}*\n\n` +
        `_To reconnect, send your new Client ID:_`,
        { parse_mode: 'MarkdownV2', ...cancelKeyboard() }
      );
    }
    await setUserState(userId, STATES.YT_CLIENT_ID, {});
    return bot.sendMessage(chatId,
      `📺 *Connect YouTube Channel*\n\n` +
      `*Follow these steps:*\n\n` +
      `1\\. Go to [Google Cloud Console](https://console.cloud.google.com) → Create project\n` +
      `2\\. Enable *YouTube Data API v3*\n` +
      `3\\. Create *OAuth 2\\.0* credentials \\(Desktop app\\)\n` +
      `4\\. Use [OAuth Playground](https://developers.google.com/oauthplayground) to get a Refresh Token\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n` +
      `*Send your Client ID to begin:*`,
      { parse_mode: 'MarkdownV2', disable_web_page_preview: true, ...cancelKeyboard() }
    );
  }

  // ── STATE: Awaiting YouTube URL ──────────────────────────────
  if (state === STATES.AWAIT_URL) {
    if (!isValidYouTubeUrl(text)) {
      return bot.sendMessage(chatId,
        `❌ *Invalid link*\n\n` +
        `That doesn't look like a YouTube URL\\.\n\n` +
        `*Example:*\n\`https://youtube.com/watch?v=...\`\n\n` +
        `_Or just send a video file directly\\! 📤_`,
        { parse_mode: 'MarkdownV2' }
      );
    }

    const loading = await bot.sendMessage(chatId,
      `🔍 _Fetching video info\\.\\.\\._`,
      { parse_mode: 'MarkdownV2' }
    );

    try {
      const info = await getVideoInfo(text);
      await bot.deleteMessage(chatId, loading.message_id).catch(() => {});

      const mins = Math.floor((info.duration || 0) / 60);
      const secs = Math.floor((info.duration || 0) % 60);
      const durStr = info.duration ? `⏱ *${mins}m ${secs}s*` : '';
      const safeTitle = (info.title || '').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
      const safeCh    = (info.channel || '').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');

      await setUserState(userId, STATES.AWAIT_START, {
        url: text, title: info.title,
        channel: info.channel, total_duration: info.duration
      });

      return bot.sendMessage(chatId,
        `✅ *Video found\\!*\n\n` +
        `📹 *${safeTitle}*\n` +
        `📺 ${safeCh}\n` +
        `${durStr}\n\n` +
        `*Enter the start time of your clip:*\n` +
        `_Example: \`2:30\` or \`150\` \\(seconds\\)_`,
        { parse_mode: 'MarkdownV2', ...cancelKeyboard() }
      );
    } catch (err) {
      await bot.deleteMessage(chatId, loading.message_id).catch(() => {});
      return bot.sendMessage(chatId,
        `❌ *Couldn't fetch video info*\n\n_${err.message}_\n\nMake sure the video is public\\.`,
        { parse_mode: 'MarkdownV2' }
      );
    }
  }

  // ── STATE: Awaiting start time ───────────────────────────────
  if (state === STATES.AWAIT_START) {
    const startSec = parseTimeToSeconds(text);
    if (startSec === null || startSec < 0) {
      return bot.sendMessage(chatId,
        `❌ *Invalid format*\n\nUse \`2:30\` or \`150\` \\(seconds\\)\\.`,
        { parse_mode: 'MarkdownV2' }
      );
    }
    const total = tempData.total_duration || 0;
    if (total && startSec >= total) {
      return bot.sendMessage(chatId,
        `❌ Start time \\(${startSec}s\\) is beyond the video length \\(${Math.round(total)}s\\)\\.`,
        { parse_mode: 'MarkdownV2' }
      );
    }

    await setUserState(userId, STATES.AWAIT_QUALITY, { ...tempData, start_sec: startSec });

    const mm = String(Math.floor(startSec / 60)).padStart(2, '0');
    const ss = String(startSec % 60).padStart(2, '0');

    return bot.sendMessage(chatId,
      `⏱ *Start time:* \`${mm}:${ss}\`\n\n*Choose clip duration:*`,
      { parse_mode: 'MarkdownV2', ...durationKeyboard() }
    );
  }

  // ── STATE: Awaiting TikTok link ──────────────────────────────
  if (state === STATES.AWAIT_TT_LINK) {
    const clipId = tempData.clip_id;
    if (clipId && text.includes('tiktok')) {
      const { updateClip } = await import('../../db/database.js');
      await updateClip(parseInt(clipId), { tiktok_url: text, status: 'published' });
      await setUserState(userId, STATES.IDLE, {});
      return bot.sendMessage(chatId,
        `✅ *TikTok link saved\\!*\n\n_Views will be tracked automatically\\._`,
        { parse_mode: 'MarkdownV2', ...mainKeyboard() }
      );
    }
    return bot.sendMessage(chatId,
      `❌ That doesn't look like a TikTok link\\. Please try again:`,
      { parse_mode: 'MarkdownV2' }
    );
  }

  // ── STATE: Awaiting Instagram link ───────────────────────────
  if (state === STATES.AWAIT_IG_LINK) {
    const clipId = tempData.clip_id;
    if (clipId && (text.includes('instagram') || text.includes('instagr.am'))) {
      const { updateClip } = await import('../../db/database.js');
      await updateClip(parseInt(clipId), { instagram_url: text, status: 'published' });
      await setUserState(userId, STATES.IDLE, {});
      return bot.sendMessage(chatId,
        `✅ *Instagram link saved\\!*\n\n_Views will be tracked automatically\\._`,
        { parse_mode: 'MarkdownV2', ...mainKeyboard() }
      );
    }
    return bot.sendMessage(chatId,
      `❌ That doesn't look like an Instagram link\\. Please try again:`,
      { parse_mode: 'MarkdownV2' }
    );
  }

  // ── STATE: YouTube OAuth ─────────────────────────────────────
  if (state === STATES.YT_CLIENT_ID) {
    if (text.length < 10) return bot.sendMessage(chatId, '❌ Invalid Client ID\\. Try again:', { parse_mode: 'MarkdownV2' });
    await setUserState(userId, STATES.YT_CLIENT_SECRET, { ...tempData, client_id: text });
    return bot.sendMessage(chatId,
      `✅ *Client ID saved\\!*\n\n*Now send your Client Secret:*`,
      { parse_mode: 'MarkdownV2' }
    );
  }

  if (state === STATES.YT_CLIENT_SECRET) {
    if (text.length < 5) return bot.sendMessage(chatId, '❌ Invalid\\. Try again:', { parse_mode: 'MarkdownV2' });
    await setUserState(userId, STATES.YT_REFRESH_TOKEN, { ...tempData, client_secret: text });
    return bot.sendMessage(chatId,
      `✅ *Client Secret saved\\!*\n\n*Now send your Refresh Token:*`,
      { parse_mode: 'MarkdownV2' }
    );
  }

  if (state === STATES.YT_REFRESH_TOKEN) {
    if (text.length < 10) return bot.sendMessage(chatId, '❌ Invalid token\\. Try again:', { parse_mode: 'MarkdownV2' });
    const creds   = { client_id: tempData.client_id, client_secret: tempData.client_secret, refresh_token: text };
    const loading = await bot.sendMessage(chatId, '🔍 _Verifying credentials\\.\\.\\._', { parse_mode: 'MarkdownV2' });
    const verify  = await verifyYouTubeCredentials(creds);
    await bot.deleteMessage(chatId, loading.message_id).catch(() => {});

    if (!verify.valid) {
      return bot.sendMessage(chatId,
        `❌ *Invalid credentials*\n\n_${verify.error}_\n\nPlease start over: /start`,
        { parse_mode: 'MarkdownV2' }
      );
    }

    await saveYouTubeChannel(userId, {
      ...creds, channel_id: verify.channelId,
      channel_title: verify.channelTitle, is_active: true
    });
    await setUserState(userId, STATES.IDLE, {});

    const safeTitle = (verify.channelTitle || '').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
    return bot.sendMessage(chatId,
      `✅ *YouTube Connected\\!*\n\n` +
      `📺 *${safeTitle}*\n\n` +
      `_Your clips will now auto\\-upload to YouTube Shorts\\._`,
      { parse_mode: 'MarkdownV2', ...mainKeyboard() }
    );
  }
}
