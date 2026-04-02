// ═══════════════════════════════════════════════════════════════════
// database.js — All Supabase DB operations for ClipBot Pro
// ═══════════════════════════════════════════════════════════════════

import { supabase } from './supabase.js';
import { logger } from '../utils/logger.js';

// ── USER STATES ──────────────────────────────────────────────────────

export async function getUserState(userId) {
  const { data } = await supabase
    .from('user_states')
    .select('*')
    .eq('user_id', String(userId))
    .single();
  return data;
}

export async function setUserState(userId, state, tempData = {}) {
  const { error } = await supabase
    .from('user_states')
    .upsert({ user_id: String(userId), state, temp_data: tempData }, { onConflict: 'user_id' });
  if (error) logger.warn('DB', `setUserState: ${error.message}`);
}

// ── CLIPS ────────────────────────────────────────────────────────────

export async function createClip(data) {
  const { data: row, error } = await supabase
    .from('clips')
    .insert(data)
    .select()
    .single();
  if (error) throw new Error(`createClip: ${error.message}`);
  return row;
}

export async function getClipById(id) {
  const { data, error } = await supabase
    .from('clips')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return null;
  return data;
}

export async function getUserClips(userId, limit = 20) {
  const { data } = await supabase
    .from('clips')
    .select('*')
    .eq('user_id', String(userId))
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

export async function updateClip(id, updates) {
  const { error } = await supabase
    .from('clips')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) logger.warn('DB', `updateClip: ${error.message}`);
}

export async function getAllPendingClips() {
  const { data } = await supabase
    .from('clips')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  return data || [];
}

// ── VIEW TRACKING ─────────────────────────────────────────────────────

export async function upsertViewSnapshot(clipId, platform, viewCount) {
  const { error } = await supabase
    .from('view_snapshots')
    .insert({
      clip_id: clipId,
      platform,
      view_count: viewCount,
      snapshot_at: new Date().toISOString()
    });
  if (error) logger.warn('DB', `upsertViewSnapshot: ${error.message}`);
}

export async function getViewHistory(clipId) {
  const { data } = await supabase
    .from('view_snapshots')
    .select('*')
    .eq('clip_id', clipId)
    .order('snapshot_at', { ascending: false })
    .limit(30);
  return data || [];
}

export async function updateClipViews(clipId, platform, newViews) {
  // Update the latest view count on the clip row itself
  const field = `views_${platform}`; // e.g. views_youtube
  await updateClip(clipId, { [field]: newViews });
  // Also save snapshot for history
  await upsertViewSnapshot(clipId, platform, newViews);
}

// ── YOUTUBE CHANNELS ─────────────────────────────────────────────────

export async function getYouTubeChannel(userId) {
  const { data } = await supabase
    .from('youtube_channels')
    .select('*')
    .eq('user_id', String(userId))
    .single();
  return data;
}

export async function saveYouTubeChannel(userId, channelData) {
  const { error } = await supabase
    .from('youtube_channels')
    .upsert({ user_id: String(userId), ...channelData }, { onConflict: 'user_id' });
  if (error) throw new Error(`saveYouTubeChannel: ${error.message}`);
}

// ── ACTIVITY LOG ─────────────────────────────────────────────────────

export async function logActivity(userId, clipId, action, status, details = {}) {
  const { error } = await supabase
    .from('activity_log')
    .insert({ user_id: String(userId), clip_id: clipId, action, status, details });
  if (error) logger.warn('DB', `logActivity: ${error.message}`);
}

// ── EARNINGS ─────────────────────────────────────────────────────────

export async function getTotalEarnings(userId) {
  const { data } = await supabase
    .from('clips')
    .select('estimated_earnings')
    .eq('user_id', String(userId))
    .not('estimated_earnings', 'is', null);

  if (!data?.length) return 0;
  return data.reduce((sum, c) => sum + (c.estimated_earnings || 0), 0);
}
