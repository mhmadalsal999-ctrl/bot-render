-- ============================================================
-- CLIPBOT PRO — Complete Database Schema v1.0
-- ⚠️  انسخ كل هذا الكود في Supabase → SQL Editor → Run
-- ============================================================

-- 1. USER STATES (session management)
CREATE TABLE IF NOT EXISTS user_states (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT UNIQUE NOT NULL,
  state      TEXT NOT NULL DEFAULT 'idle',
  temp_data  JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. CLIPS (main table)
CREATE TABLE IF NOT EXISTS clips (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             TEXT NOT NULL,
  -- Source info
  source_url          TEXT NOT NULL,          -- Original YouTube URL
  source_title        TEXT,                   -- Title of source video
  source_channel      TEXT,                   -- Channel name
  clip_start_sec      INTEGER DEFAULT 0,      -- Start second in source
  clip_end_sec        INTEGER DEFAULT 60,     -- End second in source
  -- Processing
  status              TEXT DEFAULT 'pending', -- pending→processing→ready→published→failed
  error_message       TEXT,
  -- Content
  caption_text        TEXT,                   -- AI-generated caption (what is said)
  hashtags            TEXT,                   -- AI-generated hashtags
  music_name          TEXT,                   -- Background music used
  watermark_text      TEXT,                   -- Watermark applied
  -- Output files
  video_path          TEXT,                   -- Local temp path
  video_url           TEXT,                   -- Supabase storage URL
  thumbnail_url       TEXT,
  -- Published URLs
  youtube_video_id    TEXT,
  youtube_url         TEXT,
  tiktok_url          TEXT,                   -- Manual (user submits)
  instagram_url       TEXT,                   -- Manual (user submits)
  -- View tracking
  views_youtube       BIGINT DEFAULT 0,
  views_tiktok        BIGINT DEFAULT 0,
  views_instagram     BIGINT DEFAULT 0,
  -- Earnings estimate ($3 CPM default)
  cpm_rate            NUMERIC DEFAULT 3.0,
  estimated_earnings  NUMERIC DEFAULT 0,
  -- Metadata
  quality             INTEGER DEFAULT 1080, -- 1080 / 1440 / 2160
  duration_seconds    INTEGER,
  language            TEXT DEFAULT 'en',
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 3. VIEW SNAPSHOTS (history for charts)
CREATE TABLE IF NOT EXISTS view_snapshots (
  id          BIGSERIAL PRIMARY KEY,
  clip_id     BIGINT REFERENCES clips(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL,  -- youtube / tiktok / instagram
  view_count  BIGINT DEFAULT 0,
  snapshot_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. YOUTUBE CHANNELS
CREATE TABLE IF NOT EXISTS youtube_channels (
  id             BIGSERIAL PRIMARY KEY,
  user_id        TEXT UNIQUE NOT NULL,
  client_id      TEXT NOT NULL,
  client_secret  TEXT NOT NULL,
  refresh_token  TEXT NOT NULL,
  channel_id     TEXT,
  channel_title  TEXT,
  is_active      BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- 5. ACTIVITY LOG
CREATE TABLE IF NOT EXISTS activity_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL,
  clip_id    BIGINT REFERENCES clips(id),
  action     TEXT NOT NULL,
  status     TEXT NOT NULL,
  details    JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── INDEXES ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_user_states_user_id   ON user_states(user_id);
CREATE INDEX IF NOT EXISTS idx_clips_user_id         ON clips(user_id);
CREATE INDEX IF NOT EXISTS idx_clips_status          ON clips(status);
CREATE INDEX IF NOT EXISTS idx_clips_created_at      ON clips(created_at);
CREATE INDEX IF NOT EXISTS idx_view_snapshots_clip   ON view_snapshots(clip_id);
CREATE INDEX IF NOT EXISTS idx_youtube_ch_user_id    ON youtube_channels(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_user_id  ON activity_log(user_id);

-- ── AUTO-UPDATE TRIGGER ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS upd_user_states   ON user_states;
DROP TRIGGER IF EXISTS upd_clips         ON clips;
DROP TRIGGER IF EXISTS upd_yt_channels   ON youtube_channels;

CREATE TRIGGER upd_user_states BEFORE UPDATE ON user_states    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER upd_clips       BEFORE UPDATE ON clips          FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER upd_yt_channels BEFORE UPDATE ON youtube_channels FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ✅ Schema v1.0 complete
-- الخطوة التالية: Supabase → Storage → New Bucket → اسمه "clips" → Public
