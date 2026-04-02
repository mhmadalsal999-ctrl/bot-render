// ═══════════════════════════════════════════════════════════════════
// callbackHandler.js — All inline button presses
// ═══════════════════════════════════════════════════════════════════

import {
  getUserState, setUserState,
  getClipById, updateClip, getUserClips,
  getYouTubeChannel, createClip, logActivity
} from '../../db/database.js';
import {
  mainKeyboard, clipActionsKeyboard,
  clipsListKeyboard, confirmDeleteKeyboard, STATUS_LABELS
} from '../messages.js';
import { uploadToYouTube }      from '../../services/youtubeService.js';
import { triggerProcessClip }   from '../../services/cronScheduler.js';
import { buildStatsSummary, formatViews, trackClipViews } from '../../services/viewTrackerService.js';
import { logger }               from '../../utils/logger.js';
import fs   from 'fs-extra';
import axios from 'axios';

// ── Helper: answer + edit or send ────────────────────────────────
async function answer(bot, query, text) {
  await bot.answerCallbackQuery(query.id, { text }).catch(() => {});
}

// ════════════════════════════════════════════════════════════════════
export async function handleCallbackQuery(bot, query) {
  const chatId = query.message.chat.id;
  const userId = query.from.id.toString();
  const data   = query.data || '';

  // Always answer callback to remove loading spinner
  await bot.answerCallbackQuery(query.id).catch(() => {});

  // ── Duration selected → ask quality ──────────────────────────
  if (data.startsWith('dur:')) {
    const duration = parseInt(data.split(':')[1], 10);
    const sd       = await getUserState(userId);
    const temp     = sd?.temp_data || {};

    if (!temp.url && !temp.source_url || temp.start_sec === undefined) {
      return bot.sendMessage(chatId,
        '❌ Session expired. Tap ✂️ New Clip to start again.',
        mainKeyboard()
      );
    }

    // Save duration, now ask quality
    await setUserState(userId, 'await_quality_final', {
      ...temp,
      duration
    });

    const { qualityKeyboard } = await import('../messages.js');
    return bot.sendMessage(chatId,
      `🎬 *Duration:* ${duration}s\n\n*Choose output quality:*\n\n` +
      `_1080p = fast (2-3 min)\n1440p = sharp (4-5 min)\n4K = ultra (7-10 min)_`,
      { parse_mode: 'Markdown', ...qualityKeyboard() }
    );
  }

  // ── Quality selected → create clip → start pipeline ───────────
  if (data.startsWith('q:')) {
    const quality = parseInt(data.split(':')[1], 10);
    const sd      = await getUserState(userId);
    const temp    = sd?.temp_data || {};

    if (!temp.duration || temp.start_sec === undefined) {
      return bot.sendMessage(chatId,
        '❌ Session expired. Tap ✂️ New Clip to start again.',
        mainKeyboard()
      );
    }

    const endSec   = temp.start_sec + temp.duration;
    const isLocal  = temp.source_url?.startsWith('local:');
    const sourceUrl = temp.source_url || temp.url;

    const clip = await createClip({
      user_id:        userId,
      source_url:     sourceUrl,
      source_title:   temp.title   || 'YouTube Video',
      source_channel: temp.channel || '',
      clip_start_sec: temp.start_sec,
      clip_end_sec:   endSec,
      watermark_text: process.env.WATERMARK_TEXT || '@ClipBot',
      quality:        quality,
      status:         'pending'
    });

    await setUserState(userId, 'idle', {});

    const qualityLabel = { 1080: '1080p', 1440: '1440p (2K)', 2160: '4K' }[quality] || '1080p';
    const timeEst      = { 1080: '2-3 min', 1440: '4-5 min', 2160: '7-10 min' }[quality] || '2-3 min';

    const mm = String(Math.floor(temp.start_sec/60)).padStart(2,'0');
    const ss = String(temp.start_sec % 60).padStart(2,'0');
    const em = String(Math.floor(endSec/60)).padStart(2,'0');
    const es = String(endSec % 60).padStart(2,'0');

    await bot.sendMessage(chatId,
      `✅ *Clip Queued!*\n\n` +
      `📹 ${(temp.title || 'Video').slice(0,50)}\n` +
      `⏱ ${mm}:${ss} → ${em}:${es} (${temp.duration}s)\n` +
      `💎 Quality: *${qualityLabel}*\n` +
      `⏳ Est. time: ~${timeEst}\n\n` +
      `⚙️ Processing starts now...\n` +
      `_I'll notify you when your clip is ready!_`,
      { parse_mode: 'Markdown', ...mainKeyboard() }
    );

    triggerProcessClip(clip.id).catch(e =>
      logger.error('CALLBACK', `trigger: ${e.message}`)
    );
    return;
  }

  // ── Open clip detail ──────────────────────────────────────────
  if (data.startsWith('clip:')) {
    const clipId = parseInt(data.split(':')[1], 10);
    const clip   = await getClipById(clipId);
    if (!clip || clip.user_id !== userId) {
      return bot.sendMessage(chatId, '❌ Clip not found.');
    }

    const status  = STATUS_LABELS[clip.status] || clip.status;
    const title   = (clip.source_title || 'Clip').slice(0, 50);
    const dur     = clip.duration_seconds ? `${clip.duration_seconds}s` : '—';
    const ytV     = formatViews(clip.views_youtube   || 0);
    const ttV     = formatViews(clip.views_tiktok    || 0);
    const igV     = formatViews(clip.views_instagram || 0);
    const total   = formatViews((clip.views_youtube||0)+(clip.views_tiktok||0)+(clip.views_instagram||0));
    const earn    = (clip.estimated_earnings || 0).toFixed(2);

    const lines = [
      `📹 *${title}*`,
      ``,
      `Status: ${status}  •  Duration: ${dur}`,
      ``,
      `👁 *Views*`,
      `├ 🎬 YouTube:   ${ytV}`,
      `├ 🎵 TikTok:    ${ttV}`,
      `├ 📸 Instagram: ${igV}`,
      `└ 📈 Total:     *${total}*`,
      ``,
      `💰 Estimated: *$${earn}*`
    ];

    if (clip.youtube_url)   lines.push(`\n🎬 [Watch on YouTube](${clip.youtube_url})`);
    if (clip.tiktok_url)    lines.push(`🎵 [Watch on TikTok](${clip.tiktok_url})`);
    if (clip.instagram_url) lines.push(`📸 [Watch on Instagram](${clip.instagram_url})`);
    if (clip.video_url)     lines.push(`\n⬇️ [Download Clip](${clip.video_url})`);

    if (clip.caption_text) {
      lines.push(`\n📋 _${clip.caption_text.slice(0, 100)}..._`);
    }

    return bot.sendMessage(chatId, lines.join('\n'), {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      ...clipActionsKeyboard(clipId, !!clip.youtube_video_id)
    });
  }

  // ── View stats ────────────────────────────────────────────────
  if (data.startsWith('stats:')) {
    const clipId = parseInt(data.split(':')[1], 10);
    const clip   = await getClipById(clipId);
    if (!clip || clip.user_id !== userId) return;
    const summary = buildStatsSummary(clip);
    return bot.sendMessage(chatId, summary, {
      parse_mode: 'Markdown',
      ...clipActionsKeyboard(clipId, !!clip.youtube_video_id)
    });
  }

  // ── Refresh views ─────────────────────────────────────────────
  if (data.startsWith('refresh:')) {
    const clipId = parseInt(data.split(':')[1], 10);
    const clip   = await getClipById(clipId);
    if (!clip || clip.user_id !== userId) return;

    await bot.answerCallbackQuery(query.id, { text: '🔄 Refreshing views...' }).catch(() => {});

    let ytCreds = null;
    try {
      const ch = await getYouTubeChannel(userId);
      if (ch?.is_active) ytCreds = { client_id: ch.client_id, client_secret: ch.client_secret, refresh_token: ch.refresh_token };
    } catch (_) {}

    await trackClipViews(clip, ytCreds);
    const fresh   = await getClipById(clipId);
    const summary = buildStatsSummary(fresh);
    return bot.sendMessage(chatId, `🔄 *Refreshed!*\n\n${summary}`, {
      parse_mode: 'Markdown',
      ...clipActionsKeyboard(clipId, !!clip.youtube_video_id)
    });
  }

  // ── Upload to YouTube ─────────────────────────────────────────
  if (data.startsWith('yt_upload:')) {
    const clipId = parseInt(data.split(':')[1], 10);
    const clip   = await getClipById(clipId);

    if (!clip || clip.user_id !== userId) return bot.sendMessage(chatId, '❌ Clip not found.');
    if (clip.status !== 'ready')          return bot.sendMessage(chatId, '⚠️ Clip not ready yet.');
    if (!clip.video_url)                  return bot.sendMessage(chatId, '❌ No video file. Re-process clip.');

    const ch = await getYouTubeChannel(userId);
    if (!ch?.is_active) {
      return bot.sendMessage(chatId,
        '❌ YouTube not connected.\nGo to 📺 YouTube Setup first.',
        mainKeyboard()
      );
    }

    const loading = await bot.sendMessage(chatId,
      '📤 *Uploading to YouTube Shorts...*\n_This takes 1-2 minutes_',
      { parse_mode: 'Markdown' }
    );

    try {
      const tmpPath = `/tmp/yt_${clipId}_${Date.now()}.mp4`;
      const resp    = await axios.get(clip.video_url, { responseType: 'arraybuffer', timeout: 120_000 });
      await fs.writeFile(tmpPath, resp.data);

      const ytMeta = {
        title:       (clip.source_title || 'Clip').slice(0, 100),
        description: `${clip.caption_text || ''}\n\n${clip.hashtags || ''}\n\nOriginal: ${clip.source_url?.startsWith('local:') ? 'Direct upload' : clip.source_url}`,
        tags:        ['Shorts', 'viral', 'clips', 'podcast']
      };

      const { videoId, videoUrl } = await uploadToYouTube(tmpPath, ytMeta, {
        client_id:     ch.client_id,
        client_secret: ch.client_secret,
        refresh_token: ch.refresh_token
      });

      await updateClip(clipId, { youtube_video_id: videoId, youtube_url: videoUrl, status: 'published' });
      await fs.remove(tmpPath).catch(() => {});
      await bot.deleteMessage(chatId, loading.message_id).catch(() => {});
      await logActivity(userId, clipId, 'youtube_upload', 'success', { videoId });

      return bot.sendMessage(chatId,
        `✅ *Published on YouTube Shorts!*\n\n🔗 ${videoUrl}\n\n_Views tracked automatically every 6h._`,
        { parse_mode: 'Markdown', ...mainKeyboard() }
      );
    } catch (err) {
      await bot.deleteMessage(chatId, loading.message_id).catch(() => {});
      logger.error('CALLBACK', `YT upload: ${err.message}`);
      return bot.sendMessage(chatId,
        `❌ *Upload failed*\n_${err.message}_`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  // ── Set TikTok link ───────────────────────────────────────────
  if (data.startsWith('set_tt:')) {
    const clipId = data.split(':')[1];
    await setUserState(userId, 'await_tt_link', { clip_id: clipId });
    return bot.sendMessage(chatId,
      `🎵 *Paste your TikTok video link:*\n_After posting the clip on TikTok_`,
      { parse_mode: 'Markdown' }
    );
  }

  // ── Set Instagram link ────────────────────────────────────────
  if (data.startsWith('set_ig:')) {
    const clipId = data.split(':')[1];
    await setUserState(userId, 'await_ig_link', { clip_id: clipId });
    return bot.sendMessage(chatId,
      `📸 *Paste your Instagram Reel link:*\n_After posting the clip on Instagram_`,
      { parse_mode: 'Markdown' }
    );
  }

  // ── Delete clip (confirm first) ───────────────────────────────
  if (data.startsWith('del_clip:')) {
    const clipId = data.split(':')[1];
    return bot.sendMessage(chatId,
      `🗑 *Are you sure you want to delete this clip?*\n_This cannot be undone._`,
      { parse_mode: 'Markdown', ...confirmDeleteKeyboard(clipId) }
    );
  }

  if (data.startsWith('confirm_del:')) {
    const clipId = parseInt(data.split(':')[1], 10);
    await updateClip(clipId, { status: 'deleted' });
    return bot.sendMessage(chatId, '🗑 Clip deleted.', mainKeyboard());
  }

  // ── My Clips shortcut ─────────────────────────────────────────
  if (data === 'my_clips') {
    const clips = await getUserClips(userId);
    if (!clips.length) {
      return bot.sendMessage(chatId, '📭 No clips yet. Tap ✂️ New Clip!', mainKeyboard());
    }
    return bot.sendMessage(chatId, `📁 *My Clips:*`, {
      parse_mode: 'Markdown', ...clipsListKeyboard(clips)
    });
  }

  // ── Back to main ──────────────────────────────────────────────
  if (data === 'back_main') {
    return bot.sendMessage(chatId, '🏠 Main menu:', mainKeyboard());
  }
}
