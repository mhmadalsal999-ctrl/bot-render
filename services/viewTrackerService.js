// ═══════════════════════════════════════════════════════════════════
// viewTrackerService.js — Track views on YouTube, estimate earnings
// ═══════════════════════════════════════════════════════════════════

import { getYouTubeViews } from './youtubeService.js';
import { updateClipViews, getUserClips, getYouTubeChannel, updateClip } from '../db/database.js';
import { logger } from '../utils/logger.js';

const DEFAULT_CPM = 3.0; // $3 per 1000 views default

// ── Calculate estimated earnings ──────────────────────────────────
export function calcEarnings(totalViews, cpm = DEFAULT_CPM) {
  return parseFloat(((totalViews / 1000) * cpm).toFixed(4));
}

// ── Track views for a single clip ─────────────────────────────────
export async function trackClipViews(clip, ytCredentials) {
  let totalViews = 0;

  // YouTube views
  if (clip.youtube_video_id && ytCredentials) {
    try {
      const ytViews = await getYouTubeViews(clip.youtube_video_id, ytCredentials);
      await updateClipViews(clip.id, 'youtube', ytViews);
      totalViews += ytViews;
      logger.info('TRACKER', `Clip ${clip.id} YouTube: ${ytViews.toLocaleString()} views`);
    } catch (err) {
      logger.warn('TRACKER', `YouTube view fetch failed for clip ${clip.id}: ${err.message}`);
    }
  }

  // Add manually submitted TikTok/Instagram views (stored by user)
  totalViews += (clip.views_tiktok || 0);
  totalViews += (clip.views_instagram || 0);

  // Update earnings estimate
  const earnings = calcEarnings(totalViews, clip.cpm_rate || DEFAULT_CPM);
  await updateClip(clip.id, { estimated_earnings: earnings });

  return { totalViews, earnings };
}

// ── Track all clips for a user ─────────────────────────────────────
export async function trackAllUserClips(userId) {
  const clips = await getUserClips(userId, 50);
  const publishedClips = clips.filter(c =>
    c.status === 'published' &&
    (c.youtube_video_id || c.views_tiktok > 0 || c.views_instagram > 0)
  );

  if (!publishedClips.length) return;

  let ytCredentials = null;
  try {
    const ytChannel = await getYouTubeChannel(userId);
    if (ytChannel?.is_active) {
      ytCredentials = {
        client_id:     ytChannel.client_id,
        client_secret: ytChannel.client_secret,
        refresh_token: ytChannel.refresh_token
      };
    }
  } catch (_) {}

  for (const clip of publishedClips) {
    try {
      await trackClipViews(clip, ytCredentials);
      await new Promise(r => setTimeout(r, 2000)); // rate limit
    } catch (err) {
      logger.warn('TRACKER', `Failed to track clip ${clip.id}: ${err.message}`);
    }
  }

  logger.success('TRACKER', `Tracked ${publishedClips.length} clips for user ${userId}`);
}

// ── Format views for display ───────────────────────────────────────
export function formatViews(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ── Build stats summary string ─────────────────────────────────────
export function buildStatsSummary(clip) {
  const ytV  = clip.views_youtube   || 0;
  const ttV  = clip.views_tiktok    || 0;
  const igV  = clip.views_instagram || 0;
  const total = ytV + ttV + igV;
  const earnings = clip.estimated_earnings || 0;

  return [
    `📊 *Views Breakdown:*`,
    `├ 🎬 YouTube:   ${formatViews(ytV)}`,
    `├ 🎵 TikTok:    ${formatViews(ttV)}`,
    `├ 📸 Instagram: ${formatViews(igV)}`,
    `└ 👁 Total:     *${formatViews(total)}*`,
    ``,
    `💰 *Estimated Earnings:* $${earnings.toFixed(2)}`
  ].join('\n');
}
