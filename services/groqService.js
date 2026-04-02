// ═══════════════════════════════════════════════════════════════════
// groqService.js — AI engine: transcribe what's said + generate captions
// Uses Groq (free, fast) with model fallback
// ═══════════════════════════════════════════════════════════════════

import Groq from 'groq-sdk';
import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';
dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── Helper: call Groq with automatic model fallback ────────────────
async function callGroq(messages, maxTokens = 1500, jsonMode = false) {
  const models = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it'];
  for (const model of models) {
    try {
      const opts = {
        model,
        messages,
        temperature: 0.7,
        max_tokens: maxTokens
      };
      if (jsonMode) opts.response_format = { type: 'json_object' };
      const response = await groq.chat.completions.create(opts);
      return response.choices[0]?.message?.content || '';
    } catch (err) {
      logger.warn('GROQ', `Model ${model} failed: ${err.message} — trying next`);
    }
  }
  throw new Error('All Groq models unavailable. Check GROQ_API_KEY.');
}

function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in Groq response');
  return JSON.parse(match[0]);
}

// ═══════════════════════════════════════════════════════════════════
// MAIN: Generate caption + hashtags from video transcript
// ═══════════════════════════════════════════════════════════════════
export async function generateCaptionFromTranscript(transcript, videoTitle, channelName) {
  logger.info('GROQ', `Generating caption for: "${videoTitle}"`);

  const prompt = `You are a professional short-form video caption writer for TikTok, YouTube Shorts, and Instagram Reels.

Video source: "${videoTitle}" by ${channelName}

What was said in the clip (transcript):
"${transcript}"

Your task:
1. Write a PUNCHY, engaging caption that tells the viewer exactly what this clip is about (2-3 sentences max)
2. Make it hook-driven — start with the most interesting part
3. Write 8-12 relevant hashtags
4. Suggest a short on-screen text overlay (max 10 words) that appears at the bottom of the video

Respond ONLY with valid JSON:
{
  "caption": "The full engaging caption here...",
  "onscreen_text": "Short punchy text for the video",
  "hashtags": "#tag1 #tag2 #tag3 ...",
  "hook_word": "One power word that summarizes this clip (e.g. SHOCKING, GENIUS, TRUTH)"
}`;

  const raw = await callGroq([{ role: 'user', content: prompt }], 800, true);
  try {
    return extractJSON(raw);
  } catch {
    return {
      caption: `🎯 ${videoTitle} — Watch this clip!`,
      onscreen_text: 'Watch till the end',
      hashtags: '#shorts #podcast #viral #trending #fyp #motivation',
      hook_word: 'VIRAL'
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// Transcribe audio using Groq Whisper (speech-to-text)
// ═══════════════════════════════════════════════════════════════════
export async function transcribeAudio(audioPath) {
  logger.info('GROQ', `Transcribing: ${audioPath}`);
  try {
    const fs = (await import('fs')).default;
    const audioStream = fs.createReadStream(audioPath);

    const transcription = await groq.audio.transcriptions.create({
      file: audioStream,
      model: 'whisper-large-v3-turbo',
      response_format: 'verbose_json',
      timestamp_granularities: ['word']
    });

    logger.success('GROQ', `Transcribed ${transcription.words?.length || 0} words`);
    return {
      text: transcription.text || '',
      words: transcription.words || [],   // [{word, start, end}] for word-by-word captions
      language: transcription.language || 'en'
    };
  } catch (err) {
    logger.warn('GROQ', `Transcription failed: ${err.message}`);
    return { text: '', words: [], language: 'en' };
  }
}

// ═══════════════════════════════════════════════════════════════════
// Generate YouTube upload metadata (title + description + tags)
// ═══════════════════════════════════════════════════════════════════
export async function generateYouTubeMetadata(caption, transcript, sourceTitle) {
  const prompt = `Create YouTube Shorts upload metadata for this clip.

Original video: "${sourceTitle}"
Caption: "${caption}"
Key content: "${transcript.slice(0, 300)}"

Respond ONLY with valid JSON:
{
  "title": "Catchy YouTube Shorts title (max 70 chars)",
  "description": "2-3 sentence description with source credit and hashtags",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}`;

  const raw = await callGroq([{ role: 'user', content: prompt }], 500, true);
  try {
    return extractJSON(raw);
  } catch {
    return {
      title: sourceTitle.slice(0, 70),
      description: `Clip from: ${sourceTitle}\n\n#shorts #viral #trending`,
      tags: ['shorts', 'viral', 'trending', 'podcast', 'clips']
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// Pick the best music genre for this clip
// ═══════════════════════════════════════════════════════════════════
export async function suggestMusicMood(transcript) {
  const prompt = `Based on this transcript excerpt, what music mood fits best?
"${transcript.slice(0, 200)}"
Pick ONE from: energetic, calm, dramatic, inspirational, mysterious, upbeat
Respond with just the word.`;

  try {
    const result = await callGroq([{ role: 'user', content: prompt }], 20);
    const mood = result.trim().toLowerCase();
    const valid = ['energetic', 'calm', 'dramatic', 'inspirational', 'mysterious', 'upbeat'];
    return valid.includes(mood) ? mood : 'energetic';
  } catch {
    return 'energetic';
  }
}
