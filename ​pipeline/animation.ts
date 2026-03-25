import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import type { Character } from "../db/supabase.js";

const execAsync = promisify(exec);
const HF_TOKEN = process.env["HUGGINGFACE_API_KEY"];

// Free HuggingFace text-to-video models (tried in order)
const VIDEO_MODELS = [
  "ali-vilab/text-to-video-ms-1.7b",
  "damo-vilab/text-to-video-ms-1.7b",
];

// Free HuggingFace image-to-video models
const IMG2VID_MODELS = [
  "stabilityai/stable-video-diffusion-img2vid-xt",
  "stabilityai/stable-video-diffusion-img2vid",
];

// Stable Diffusion for scene images
const IMAGE_MODELS = [
  "stabilityai/stable-diffusion-xl-base-1.0",
  "runwayml/stable-diffusion-v1-5",
];

export interface AnimationClip {
  clipPath: string;
  duration: number;
  sceneText: string;
}

export interface AnimationOptions {
  script: string;
  characters: Character[];
  genre: string;
  targetDuration: number; // in seconds (30)
  sceneCount: number;    // how many scenes (5-6 for 30 sec)
}

// ─── Main entry: generate full 30-sec animation ────────────────────────────

export async function generateAnimationClips(
  options: AnimationOptions
): Promise<AnimationClip[]> {
  const { script, characters, genre, targetDuration, sceneCount } = options;

  const scenes = splitScriptToScenes(script, sceneCount);
  const clips: AnimationClip[] = [];
  const clipDuration = Math.ceil(targetDuration / sceneCount);

  for (let i = 0; i < scenes.length; i++) {
    const sceneText = scenes[i] || script;
    const prompt = buildAnimationPrompt(sceneText, characters, genre);

    let clipPath: string | null = null;

    // Try text-to-video first
    clipPath = await tryTextToVideo(prompt, i);

    // Fallback: generate image → animate it with FFmpeg effects
    if (!clipPath) {
      const imagePath = await generateSceneImage(prompt, i);
      if (imagePath) {
        clipPath = await animateImageWithFFmpeg(imagePath, clipDuration, i);
        if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
      }
    }

    // Last resort: solid color animated scene
    if (!clipPath) {
      clipPath = await generatePlaceholderClip(sceneText, clipDuration, i);
    }

    if (clipPath) {
      clips.push({ clipPath, duration: clipDuration, sceneText });
    }
  }

  return clips;
}

// ─── Try HuggingFace text-to-video ─────────────────────────────────────────

async function tryTextToVideo(
  prompt: string,
  sceneIndex: number
): Promise<string | null> {
  for (const model of VIDEO_MODELS) {
    try {
      const response = await axios.post(
        `https://api-inference.huggingface.co/models/${model}`,
        {
          inputs: prompt,
          parameters: {
            num_frames: 16,
            num_inference_steps: 25,
            fps: 8,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${HF_TOKEN}`,
            "Content-Type": "application/json",
          },
          responseType: "arraybuffer",
          timeout: 90000,
        }
      );

      if (response.data && response.data.byteLength > 5000) {
        const ext = detectVideoFormat(response.data);
        const outputPath = path.join(
          os.tmpdir(),
          `t2v_${Date.now()}_${sceneIndex}.${ext}`
        );
        fs.writeFileSync(outputPath, Buffer.from(response.data));

        // Convert to mp4 if needed
        if (ext !== "mp4") {
          const mp4Path = outputPath.replace(`.${ext}`, ".mp4");
          await execAsync(`ffmpeg -y -i "${outputPath}" -c:v libx264 -pix_fmt yuv420p "${mp4Path}"`);
          fs.unlinkSync(outputPath);
          return mp4Path;
        }
        return outputPath;
      }
    } catch {
      continue;
    }
  }
  return null;
}

// ─── Generate scene image via Stable Diffusion ─────────────────────────────

async function generateSceneImage(
  prompt: string,
  sceneIndex: number
): Promise<string | null> {
  for (const model of IMAGE_MODELS) {
    try {
      const response = await axios.post(
        `https://api-inference.huggingface.co/models/${model}`,
        {
          inputs: `${prompt}, anime style, vibrant colors, high quality`,
          parameters: {
            num_inference_steps: 20,
            guidance_scale: 7.5,
            width: 512,
            height: 288,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${HF_TOKEN}`,
            "Content-Type": "application/json",
          },
          responseType: "arraybuffer",
          timeout: 60000,
        }
      );

      if (response.data && response.data.byteLength > 2000) {
        const imagePath = path.join(
          os.tmpdir(),
          `scene_img_${Date.now()}_${sceneIndex}.png`
        );
        fs.writeFileSync(imagePath, Buffer.from(response.data));
        return imagePath;
      }
    } catch {
      continue;
    }
  }
  return null;
}

// ─── Animate a static image using FFmpeg (Ken Burns + effects) ──────────────

export async function animateImageWithFFmpeg(
  imagePath: string,
  duration: number,
  sceneIndex: number
): Promise<string | null> {
  const outputPath = path.join(
    os.tmpdir(),
    `animated_${Date.now()}_${sceneIndex}.mp4`
  );

  // Different animation effect per scene for variety
  const effects = [
    // Zoom in from center
    `scale=8000:-1,zoompan=z='zoom+0.001':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${duration * 25}:s=640x360:fps=25`,
    // Pan left to right
    `scale=8000:-1,zoompan=z='1.3':x='if(gte(x,iw),0,x+1)':y='ih/2-(ih/zoom/2)':d=${duration * 25}:s=640x360:fps=25`,
    // Zoom out from top
    `scale=8000:-1,zoompan=z='if(lte(zoom,1.0),1.5,max(1.0,zoom-0.0015))':x='iw/2-(iw/zoom/2)':y='0':d=${duration * 25}:s=640x360:fps=25`,
    // Pan right to left
    `scale=8000:-1,zoompan=z='1.3':x='if(lte(x,0),iw,x-1)':y='ih/2-(ih/zoom/2)':d=${duration * 25}:s=640x360:fps=25`,
    // Zoom in from bottom
    `scale=8000:-1,zoompan=z='zoom+0.0008':x='iw/2-(iw/zoom/2)':y='ih-(ih/zoom)':d=${duration * 25}:s=640x360:fps=25`,
  ];

  const effectFilter = effects[sceneIndex % effects.length];

  try {
    await execAsync(
      `ffmpeg -y -loop 1 -i "${imagePath}" ` +
        `-vf "${effectFilter}" ` +
        `-t ${duration} -c:v libx264 -preset fast -crf 28 -pix_fmt yuv420p ` +
        `"${outputPath}"`
    );
    return outputPath;
  } catch {
    // Simple static version as fallback
    try {
      await execAsync(
        `ffmpeg -y -loop 1 -i "${imagePath}" ` +
          `-vf "scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2" ` +
          `-t ${duration} -c:v libx264 -preset fast -crf 28 -pix_fmt yuv420p ` +
          `"${outputPath}"`
      );
      return outputPath;
    } catch {
      return null;
    }
  }
}

// ─── Placeholder animated clip (gradient + text animation) ─────────────────

async function generatePlaceholderClip(
  sceneText: string,
  duration: number,
  sceneIndex: number
): Promise<string> {
  const outputPath = path.join(
    os.tmpdir(),
    `placeholder_${Date.now()}_${sceneIndex}.mp4`
  );

  const palettes = [
    ["0d1b2a", "1b2838", "4a9fd4"],
    ["1a0a2e", "2d1b69", "9b59b6"],
    ["0a1a0a", "1a3a1a", "27ae60"],
    ["2a0a0a", "4a1a1a", "e74c3c"],
    ["0a1a2a", "1a2a4a", "2980b9"],
  ];
  const palette = palettes[sceneIndex % palettes.length]!;

  const shortText = sceneText.slice(0, 40).replace(/'/g, "\\'").replace(/"/g, '\\"');

  try {
    await execAsync(
      `ffmpeg -y -f lavfi ` +
        `-i "color=c=0x${palette[0]}:s=640x360:r=25,` +
        `geq=r='128+127*sin(2*PI*t*0.5)':g='50+50*cos(2*PI*t*0.3)':b='200+55*sin(2*PI*t*0.7)',` +
        `drawtext=text='${shortText}':fontcolor=white:fontsize=20:x=(w-text_w)/2:y=(h-text_h)/2:` +
        `alpha='if(lt(t,0.5),t/0.5,if(gt(t,${duration - 0.5}),(${duration}-t)/0.5,1))'` +
        `" ` +
        `-t ${duration} -c:v libx264 -preset fast -crf 28 -pix_fmt yuv420p "${outputPath}"`
    );
  } catch {
    // Absolute fallback: solid color
    await execAsync(
      `ffmpeg -y -f lavfi -i "color=c=0x${palette[0]}:s=640x360:r=25" ` +
        `-t ${duration} -c:v libx264 -preset fast -crf 28 -pix_fmt yuv420p "${outputPath}"`
    );
  }

  return outputPath;
}

// ─── Combine all clips into final 30-sec video ─────────────────────────────

export async function combineClipsWithAudio(
  clips: AnimationClip[],
  audioPath: string,
  outputPath: string
): Promise<string> {
  if (clips.length === 0) throw new Error("No clips to combine");

  const listFile = path.join(os.tmpdir(), `cliplist_${Date.now()}.txt`);

  // Normalize each clip to same resolution + framerate, then crossfade
  const normalizedClips: string[] = [];
  for (let i = 0; i < clips.length; i++) {
    const normalPath = path.join(os.tmpdir(), `norm_${Date.now()}_${i}.mp4`);
    try {
      await execAsync(
        `ffmpeg -y -i "${clips[i]!.clipPath}" ` +
          `-vf "scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=25" ` +
          `-c:v libx264 -preset fast -crf 28 -pix_fmt yuv420p -an "${normalPath}"`
      );
      normalizedClips.push(normalPath);
    } catch {
      normalizedClips.push(clips[i]!.clipPath);
    }
  }

  // Write concat list
  const listContent = normalizedClips.map((p) => `file '${p}'`).join("\n");
  fs.writeFileSync(listFile, listContent);

  const silentVideoPath = path.join(os.tmpdir(), `silent_final_${Date.now()}.mp4`);

  // Concatenate with crossfade transition
  try {
    // Try xfade filter for smooth transitions
    if (normalizedClips.length > 1) {
      let filterParts = "";
      let inputRefs = normalizedClips.map((_, i) => `[${i}:v]`).join("");
      filterParts = buildXfadeFilter(normalizedClips.length, clips.map((c) => c.duration));

      const inputs = normalizedClips.map((p) => `-i "${p}"`).join(" ");
      await execAsync(
        `ffmpeg -y ${inputs} -filter_complex "${filterParts}" -map "[vout]" ` +
          `-c:v libx264 -preset fast -crf 28 -pix_fmt yuv420p "${silentVideoPath}"`
      );
    } else {
      await execAsync(
        `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${silentVideoPath}"`
      );
    }
  } catch {
    // Simple concat fallback
    await execAsync(
      `ffmpeg -y -f concat -safe 0 -i "${listFile}" ` +
        `-c:v libx264 -preset fast -crf 28 -pix_fmt yuv420p "${silentVideoPath}"`
    );
  }

  // Mix with audio
  const hasAudio = audioPath && fs.existsSync(audioPath) && fs.statSync(audioPath).size > 100;

  if (hasAudio) {
    await execAsync(
      `ffmpeg -y -i "${silentVideoPath}" -i "${audioPath}" ` +
        `-c:v copy -c:a aac -b:a 128k -shortest "${outputPath}"`
    );
    fs.unlinkSync(silentVideoPath);
  } else {
    fs.renameSync(silentVideoPath, outputPath);
  }

  // Cleanup
  fs.unlinkSync(listFile);
  for (const p of normalizedClips) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* ignore */ }
  }

  return outputPath;
}

// ─── Add subtitles (dialogue overlay) ──────────────────────────────────────

export async function addSubtitleOverlay(
  videoPath: string,
  scenes: string[],
  durations: number[]
): Promise<string> {
  const outputPath = videoPath.replace(".mp4", "_sub.mp4");
  const srtPath = path.join(os.tmpdir(), `subs_${Date.now()}.srt`);

  let srt = "";
  let currentTime = 0;

  scenes.forEach((scene, i) => {
    const dur = durations[i] || 5;
    const text = scene.slice(0, 60).replace(/\n/g, " ").replace(/'/g, "\\'");
    srt += `${i + 1}\n${formatSRTTime(currentTime)} --> ${formatSRTTime(currentTime + dur)}\n${text}\n\n`;
    currentTime += dur;
  });

  fs.writeFileSync(srtPath, srt, "utf-8");

  try {
    await execAsync(
      `ffmpeg -y -i "${videoPath}" ` +
        `-vf "subtitles='${srtPath}':force_style='FontSize=14,PrimaryColour=&Hffffff,` +
        `BackColour=&H80000000,BorderStyle=4,Alignment=2,MarginV=20'" ` +
        `-c:a copy "${outputPath}"`
    );
    fs.unlinkSync(srtPath);
    return outputPath;
  } catch {
    if (fs.existsSync(srtPath)) fs.unlinkSync(srtPath);
    return videoPath;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildAnimationPrompt(
  sceneText: string,
  characters: Character[],
  genre: string
): string {
  const genreStyle: Record<string, string> = {
    horror: "dark horror atmosphere, eerie lighting, shadows, mist",
    adventure: "epic adventure scene, dynamic action, wide shot",
    comedy: "bright colorful scene, funny expression, cheerful",
    romance: "soft lighting, romantic atmosphere, warm colors",
    sci_fi: "futuristic setting, neon lights, advanced technology",
    fantasy: "magical realm, glowing particles, mystical atmosphere",
    action: "intense action, motion blur, dramatic angle",
    mystery: "mysterious atmosphere, dim lighting, suspenseful",
    drama: "emotional scene, close up, expressive characters",
  };

  const style = genreStyle[genre] || "cinematic animation";
  const charDesc = characters
    .slice(0, 2)
    .map((c) => c.description)
    .filter(Boolean)
    .join(", ");

  const sceneKeywords = extractSceneKeywords(sceneText);

  return `anime style animation, ${style}, ${sceneKeywords}${charDesc ? `, ${charDesc}` : ""}, high quality, vibrant colors, smooth animation, 2D anime art`;
}

function extractSceneKeywords(text: string): string {
  const keywords: string[] = [];
  if (/ليل|ظلام|مظلم/.test(text)) keywords.push("night, dark environment");
  if (/نهار|شمس|ضوء/.test(text)) keywords.push("daytime, bright sunlight");
  if (/غابة|أشجار|طبيعة/.test(text)) keywords.push("forest, nature");
  if (/مدينة|شارع|حضري/.test(text)) keywords.push("city street, urban");
  if (/قصر|منزل|بيت/.test(text)) keywords.push("building, interior");
  if (/بحر|ماء|نهر/.test(text)) keywords.push("water, ocean");
  if (/قتال|معركة|حرب/.test(text)) keywords.push("battle, conflict");
  if (/سلام|هدوء/.test(text)) keywords.push("peaceful, calm");
  if (/خوف|رعب/.test(text)) keywords.push("frightening, horror");
  if (/فرح|سعادة/.test(text)) keywords.push("joyful, happy");
  return keywords.join(", ") || "dramatic cinematic scene";
}

function splitScriptToScenes(script: string, count: number): string[] {
  const sentences = script
    .split(/[.،؟!\n]/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);

  if (sentences.length === 0) {
    return Array(count).fill(script);
  }

  const scenes: string[] = [];
  const chunkSize = Math.ceil(sentences.length / count);

  for (let i = 0; i < count; i++) {
    const chunk = sentences.slice(i * chunkSize, (i + 1) * chunkSize).join(". ");
    scenes.push(chunk || script);
  }

  return scenes;
}

function buildXfadeFilter(clipCount: number, durations: number[]): string {
  if (clipCount === 1) return "[0:v]copy[vout]";

  const transitionDuration = 0.5;
  let filter = "";
  let offset = 0;
  let prevLabel = "[0:v]";

  for (let i = 1; i < clipCount; i++) {
    offset += (durations[i - 1] || 5) - transitionDuration;
    const outLabel = i === clipCount - 1 ? "[vout]" : `[v${i}]`;
    filter += `${prevLabel}[${i}:v]xfade=transition=fade:duration=${transitionDuration}:offset=${offset.toFixed(2)}${outLabel};`;
    prevLabel = `[v${i}]`;
    offset += transitionDuration;
  }

  return filter.replace(/;$/, "");
}

function detectVideoFormat(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // GIF
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "gif";
  // MP4/MOV - ftyp box
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return "mp4";
  // WebM
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "webm";
  return "mp4";
}

function formatSRTTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function pad(n: number, d = 2): string {
  return n.toString().padStart(d, "0");
}
