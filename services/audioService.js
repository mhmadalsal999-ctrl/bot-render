// audioService.js — Extract audio from video for transcription

import ffmpegStatic from 'ffmpeg-static';
import Ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import { logger } from '../utils/logger.js';

Ffmpeg.setFfmpegPath(ffmpegStatic);

export async function extractAudioFromVideo(videoPath) {
  const audioPath = videoPath.replace(/\.[^.]+$/, '_audio.mp3');

  await new Promise((resolve, reject) => {
    Ffmpeg(videoPath)
      .outputOptions(['-vn', '-ar 16000', '-ac 1', '-b:a 96k'])
      .output(audioPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });

  logger.info('AUDIO', `Extracted audio: ${path.basename(audioPath)}`);
  return audioPath;
}
