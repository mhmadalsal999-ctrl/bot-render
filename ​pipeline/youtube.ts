import { google } from "googleapis";
import * as fs from "fs";

const youtube = google.youtube("v3");

export interface UploadOptions {
  videoPath: string;
  title: string;
  description: string;
  tags?: string[];
  categoryId?: string;
  privacyStatus?: "public" | "private" | "unlisted";
}

export interface UploadResult {
  videoId: string;
  videoUrl: string;
  title: string;
}

export function isYouTubeConfigured(): boolean {
  return !!(
    process.env["YOUTUBE_CLIENT_ID"] &&
    process.env["YOUTUBE_CLIENT_SECRET"] &&
    process.env["YOUTUBE_REFRESH_TOKEN"]
  );
}

function getOAuthClient() {
  const clientId = process.env["YOUTUBE_CLIENT_ID"];
  const clientSecret = process.env["YOUTUBE_CLIENT_SECRET"];
  const refreshToken = process.env["YOUTUBE_REFRESH_TOKEN"];

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "YouTube credentials not configured. Please set YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REFRESH_TOKEN."
    );
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}

export async function uploadToYouTube(options: UploadOptions): Promise<UploadResult> {
  const {
    videoPath,
    title,
    description,
    tags = ["أنيميشن", "مسلسل", "ذكاء اصطناعي"],
    categoryId = "1",
    privacyStatus = "public",
  } = options;

  if (!isYouTubeConfigured()) {
    throw new Error("YouTube not configured yet. Add credentials to enable uploading.");
  }

  const auth = getOAuthClient();

  const response = await youtube.videos.insert({
    auth,
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: title.slice(0, 100),
        description: description.slice(0, 5000),
        tags,
        categoryId,
        defaultLanguage: "ar",
        defaultAudioLanguage: "ar",
      },
      status: {
        privacyStatus,
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      body: fs.createReadStream(videoPath),
    },
  });

  const videoId = response.data.id!;
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  return { videoId, videoUrl, title };
}

export async function getChannelInfo(): Promise<{
  channelId: string;
  channelName: string;
} | null> {
  if (!isYouTubeConfigured()) return null;

  try {
    const auth = getOAuthClient();
    const response = await youtube.channels.list({
      auth,
      part: ["snippet"],
      mine: true,
    });

    const channel = response.data.items?.[0];
    if (!channel) return null;

    return {
      channelId: channel.id || "",
      channelName: channel.snippet?.title || "",
    };
  } catch {
    return null;
  }
}

export function buildVideoDescription(
  seriesTitle: string,
  episodeNumber: number,
  episodeTitle: string,
  summary: string
): string {
  return `🎬 ${seriesTitle} - الحلقة ${episodeNumber}: ${episodeTitle}

📝 ملخص الحلقة:
${summary}

━━━━━━━━━━━━━━━━━━━━
🤖 تم إنشاء هذا المسلسل بالكامل بالذكاء الاصطناعي
━━━━━━━━━━━━━━━━━━━━

#أنيميشن #ذكاء_اصطناعي #مسلسل #${seriesTitle.replace(/\s+/g, "_")}`;
}
