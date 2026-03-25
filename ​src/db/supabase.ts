import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;

  const supabaseUrl = process.env["SUPABASE_URL"];
  const supabaseKey = process.env["SUPABASE_KEY"];

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL and SUPABASE_KEY must be set in environment variables");
  }

  _supabase = createClient(supabaseUrl, supabaseKey);
  return _supabase;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabase();
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});

export interface Series {
  id: number;
  user_id: string;
  title: string;
  genre: string;
  description: string;
  characters: Character[];
  scenario: string;
  total_episodes: number;
  episodes_generated: number;
  voice_id: string;
  youtube_channel_id?: string;
  auto_publish: boolean;
  publish_time: string;
  created_at: string;
  status: "active" | "paused" | "completed";
}

export interface Character {
  name: string;
  role: string;
  description: string;
  personality: string;
}

export interface Episode {
  id: number;
  series_id: number;
  episode_number: number;
  title: string;
  script: string;
  audio_url?: string;
  video_url?: string;
  youtube_video_id?: string;
  youtube_url?: string;
  status: "pending" | "generating" | "ready" | "published" | "failed";
  created_at: string;
  published_at?: string;
  duration_seconds?: number;
  error_message?: string;
}

export interface UserState {
  user_id: string;
  state: string;
  data: Record<string, unknown>;
  updated_at: string;
}

export interface AutoPublishLog {
  id: number;
  series_id: number;
  episode_id: number;
  status: "success" | "failed";
  error_message?: string;
  created_at: string;
}

export async function initDB() {
  const { error: e1 } = await supabase.rpc("exec_sql", {
    sql: `
      CREATE TABLE IF NOT EXISTS series (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        genre TEXT NOT NULL,
        description TEXT,
        characters JSONB DEFAULT '[]',
        scenario TEXT,
        total_episodes INTEGER DEFAULT 0,
        episodes_generated INTEGER DEFAULT 0,
        voice_id TEXT DEFAULT 'EXAVITQu4vr4xnSDxMaL',
        youtube_channel_id TEXT,
        auto_publish BOOLEAN DEFAULT false,
        publish_time TEXT DEFAULT '10:00',
        status TEXT DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS episodes (
        id SERIAL PRIMARY KEY,
        series_id INTEGER REFERENCES series(id) ON DELETE CASCADE,
        episode_number INTEGER NOT NULL,
        title TEXT,
        script TEXT,
        audio_url TEXT,
        video_url TEXT,
        youtube_video_id TEXT,
        youtube_url TEXT,
        status TEXT DEFAULT 'pending',
        duration_seconds INTEGER,
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        published_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS user_states (
        user_id TEXT PRIMARY KEY,
        state TEXT DEFAULT 'idle',
        data JSONB DEFAULT '{}',
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS youtube_channels (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        channel_id TEXT,
        channel_name TEXT,
        access_token TEXT,
        refresh_token TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS auto_publish_log (
        id SERIAL PRIMARY KEY,
        series_id INTEGER,
        episode_id INTEGER,
        status TEXT,
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `,
  });

  if (e1) {
    console.warn("DB init via RPC failed, tables may already exist:", e1.message);
  }
}

export async function getUserState(userId: string): Promise<UserState | null> {
  const { data } = await supabase
    .from("user_states")
    .select("*")
    .eq("user_id", userId)
    .single();
  return data as UserState | null;
}

export async function setUserState(
  userId: string,
  state: string,
  data: Record<string, unknown> = {}
): Promise<void> {
  await supabase.from("user_states").upsert({
    user_id: userId,
    state,
    data,
    updated_at: new Date().toISOString(),
  });
}

export async function clearUserState(userId: string): Promise<void> {
  await setUserState(userId, "idle", {});
}

export async function createSeries(
  series: Omit<Series, "id" | "created_at" | "episodes_generated">
): Promise<Series | null> {
  const { data, error } = await supabase
    .from("series")
    .insert(series)
    .select()
    .single();
  if (error) throw error;
  return data as Series;
}

export async function getSeries(seriesId: number): Promise<Series | null> {
  const { data } = await supabase
    .from("series")
    .select("*")
    .eq("id", seriesId)
    .single();
  return data as Series | null;
}

export async function getUserSeries(userId: string): Promise<Series[]> {
  const { data } = await supabase
    .from("series")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return (data as Series[]) || [];
}

export async function updateSeries(
  seriesId: number,
  updates: Partial<Series>
): Promise<void> {
  await supabase.from("series").update(updates).eq("id", seriesId);
}

export async function createEpisode(
  episode: Omit<Episode, "id" | "created_at">
): Promise<Episode | null> {
  const { data, error } = await supabase
    .from("episodes")
    .insert(episode)
    .select()
    .single();
  if (error) throw error;
  return data as Episode;
}

export async function getEpisode(episodeId: number): Promise<Episode | null> {
  const { data } = await supabase
    .from("episodes")
    .select("*")
    .eq("id", episodeId)
    .single();
  return data as Episode | null;
}

export async function getSeriesEpisodes(seriesId: number): Promise<Episode[]> {
  const { data } = await supabase
    .from("episodes")
    .select("*")
    .eq("series_id", seriesId)
    .order("episode_number", { ascending: true });
  return (data as Episode[]) || [];
}

export async function getNextPendingEpisode(seriesId: number): Promise<Episode | null> {
  const { data } = await supabase
    .from("episodes")
    .select("*")
    .eq("series_id", seriesId)
    .eq("status", "ready")
    .order("episode_number", { ascending: true })
    .limit(1)
    .single();
  return data as Episode | null;
}

export async function updateEpisode(
  episodeId: number,
  updates: Partial<Episode>
): Promise<void> {
  await supabase.from("episodes").update(updates).eq("id", episodeId);
}

export async function getActiveSeriesForPublish(): Promise<Series[]> {
  const { data } = await supabase
    .from("series")
    .select("*")
    .eq("auto_publish", true)
    .eq("status", "active");
  return (data as Series[]) || [];
}
