// ═══════════════════════════════════════════════════════════════════
// youtubeService.js — Upload clips to YouTube Shorts
// ═══════════════════════════════════════════════════════════════════

import { google } from 'googleapis';
import fs from 'fs-extra';
import { logger } from '../utils/logger.js';

// ── Build authenticated YouTube client ────────────────────────────
function getYouTubeClient(credentials) {
  const oauth2 = new google.auth.OAuth2(
    credentials.client_id,
    credentials.client_secret,
    'https://developers.google.com/oauthplayground'
  );
  oauth2.setCredentials({ refresh_token: credentials.refresh_token });
  return google.youtube({ version: 'v3', auth: oauth2 });
}

// ── Upload video to YouTube as Short ─────────────────────────────
export async function uploadToYouTube(videoPath, metadata, credentials) {
  logger.info('YOUTUBE', `Uploading: ${metadata.title}`);

  const youtube = getYouTubeClient(credentials);

  const fileSize = (await fs.stat(videoPath)).size;
  const fileStream = fs.createReadStream(videoPath);

  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title:       metadata.title.slice(0, 100),
        description: metadata.description + '\n\n#Shorts',
        tags:        [...(metadata.tags || []), 'Shorts', 'short'],
        categoryId:  '22' // People & Blogs
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false
      }
    },
    media: {
      body: fileStream
    }
  }, {
    onUploadProgress: (evt) => {
      const pct = Math.round((evt.bytesRead / fileSize) * 100);
      if (pct % 25 === 0) logger.info('YOUTUBE', `Upload progress: ${pct}%`);
    }
  });

  const videoId = response.data.id;
  const videoUrl = `https://www.youtube.com/shorts/${videoId}`;

  logger.success('YOUTUBE', `Published: ${videoUrl}`);
  return { videoId, videoUrl };
}

// ── Verify credentials work ───────────────────────────────────────
export async function verifyYouTubeCredentials(credentials) {
  try {
    const youtube = getYouTubeClient(credentials);
    const res = await youtube.channels.list({ part: ['snippet'], mine: true });
    const channel = res.data.items?.[0];
    if (!channel) throw new Error('No channel found');
    return {
      valid:        true,
      channelId:    channel.id,
      channelTitle: channel.snippet.title
    };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// ── Get view count for a YouTube video ────────────────────────────
export async function getYouTubeViews(videoId, credentials) {
  try {
    const youtube = getYouTubeClient(credentials);
    const res = await youtube.videos.list({
      part: ['statistics'],
      id: [videoId]
    });
    const stats = res.data.items?.[0]?.statistics;
    return parseInt(stats?.viewCount || '0', 10);
  } catch (err) {
    logger.warn('YOUTUBE', `Could not fetch views for ${videoId}: ${err.message}`);
    return 0;
  }
}
