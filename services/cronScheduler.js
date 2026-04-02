// ═══════════════════════════════════════════════════════════════════
// cronScheduler.js — Scheduled background jobs
// ═══════════════════════════════════════════════════════════════════

import cron from 'node-cron';
import { getAllPendingClips, getUserClips, updateClip } from '../db/database.js';
import { runClipPipeline } from './clipPipeline.js';
import { trackAllUserClips } from './viewTrackerService.js';
import { cleanupTempFiles } from './ffmpegService.js';
import { logger } from '../utils/logger.js';

let botInstance = null;

export function setBotInstance(bot) {
  botInstance = bot;
  logger.success('CRON', 'Bot instance registered');
}

// ── Notify user ───────────────────────────────────────────────────
async function notifyUser(userId, message, options = {}) {
  if (!botInstance || !userId) return;
  try {
    await botInstance.sendMessage(userId, message, { parse_mode: 'Markdown', ...options });
  } catch (err) {
    logger.warn('CRON', `Notify user ${userId} failed: ${err.message}`);
  }
}

// ── Process one pending clip ───────────────────────────────────────
async function processPendingClip(clip) {
  logger.cron(`Processing clip ${clip.id} for user ${clip.user_id}`);

  await notifyUser(clip.user_id,
    `⏳ *Processing your clip...*\n\n🎬 Source: ${clip.source_title || clip.source_url}\n📐 Clip: ${clip.clip_start_sec}s → ${clip.clip_end_sec}s\n\n_This takes 2-4 minutes. I'll notify you when done!_`
  );

  try {
    const result = await runClipPipeline(clip, async (msg) => {
      await notifyUser(clip.user_id, msg);
    });

    // Build result message
    const caption = result.captionData?.caption || '';
    const hashtags = result.captionData?.hashtags || '';
    const mood = result.mood || 'energetic';
    const duration = Math.round(result.durationSeconds || 0);

    let msg = `✅ *Clip Ready!*\n\n`;
    msg += `📋 *Caption:*\n${caption}\n\n`;
    msg += `#️⃣ *Hashtags:*\n${hashtags}\n\n`;
    msg += `🎵 Music mood: ${mood} | ⏱ Duration: ${duration}s\n\n`;

    if (result.videoUrl) {
      msg += `☁️ *[Download Clip](${result.videoUrl})*\n\n`;
    }

    msg += `📤 Now publish it on:\n`;
    msg += `• TikTok — post manually\n`;
    msg += `• Instagram Reels — post manually\n`;
    msg += `• YouTube Shorts — I can upload for you!\n\n`;
    msg += `After posting, send me the links to track your views 📊`;

    await notifyUser(clip.user_id, msg, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📺 Upload to YouTube Shorts', callback_data: `yt_upload:${clip.id}` }],
          [{ text: '📊 Set View Links', callback_data: `set_links:${clip.id}` }],
          [{ text: '📁 My Clips', callback_data: 'my_clips' }]
        ]
      }
    });

    logger.success('CRON', `Clip ${clip.id} processed and user notified`);

  } catch (err) {
    logger.error('CRON', `Clip ${clip.id} failed: ${err.message}`);
    await notifyUser(clip.user_id,
      `❌ *Processing Failed*\n\n_${err.message}_\n\nTry again with /start`
    );
  }
}

// ── Main: process all pending clips ──────────────────────────────
async function processPendingClips() {
  logger.cron('=== Checking pending clips ===');
  try {
    const pending = await getAllPendingClips();
    if (!pending.length) {
      logger.cron('No pending clips');
      return;
    }

    logger.cron(`Found ${pending.length} pending clip(s)`);

    // Process one at a time to avoid overloading Render free tier
    for (const clip of pending) {
      try {
        await processPendingClip(clip);
        await new Promise(r => setTimeout(r, 5000)); // 5s between clips
      } catch (err) {
        logger.error('CRON', `Error processing clip ${clip.id}: ${err.message}`);
      }
    }

    await cleanupTempFiles();
    logger.cron('=== Pending clips done ===');

  } catch (err) {
    logger.error('CRON', `processPendingClips error: ${err.message}`);
  }
}

// ── Track views for all users ─────────────────────────────────────
async function trackViewsForAllUsers() {
  logger.cron('=== Tracking views ===');
  try {
    const { supabase } = await import('../db/supabase.js');
    const { data: users } = await supabase
      .from('clips')
      .select('user_id')
      .eq('status', 'published');

    const uniqueUsers = [...new Set((users || []).map(r => r.user_id))];

    for (const userId of uniqueUsers) {
      await trackAllUserClips(userId);
      await new Promise(r => setTimeout(r, 3000));
    }

    logger.cron(`=== Views tracked for ${uniqueUsers.length} users ===`);
  } catch (err) {
    logger.error('CRON', `trackViewsForAllUsers error: ${err.message}`);
  }
}

// ── Init all cron jobs ─────────────────────────────────────────────
export function initCronJobs() {
  // Check pending clips every 5 minutes
  cron.schedule('*/5 * * * *', processPendingClips, { timezone: 'UTC' });

  // Track views every 6 hours
  cron.schedule('0 */6 * * *', trackViewsForAllUsers, { timezone: 'UTC' });

  // Cleanup temp files every 3 hours
  cron.schedule('0 */3 * * *', () => cleanupTempFiles(), { timezone: 'UTC' });

  // Keep-alive ping every 14 minutes (prevent Render free tier sleep)
  cron.schedule('*/14 * * * *', async () => {
    const url = process.env.CALLBACK_BASE_URL;
    if (url) {
      try {
        const axios = (await import('axios')).default;
        await axios.get(`${url}/ping`, { timeout: 10000 });
        logger.info('CRON', 'Keep-alive ping sent');
      } catch (_) {}
    }
  }, { timezone: 'UTC' });

  logger.success('CRON', 'All cron jobs initialized');
  logger.info('CRON', '• Clip processing: every 5 min');
  logger.info('CRON', '• View tracking:   every 6 hours');
  logger.info('CRON', '• Cleanup:         every 3 hours');
  logger.info('CRON', '• Keep-alive:      every 14 min');
}

// ── Manual triggers (for bot commands) ────────────────────────────
export async function triggerProcessClip(clipId) {
  const { getClipById } = await import('../db/database.js');
  const clip = await getClipById(clipId);
  if (!clip) throw new Error('Clip not found');
  await processPendingClip(clip);
}
