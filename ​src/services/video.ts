import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface VideoOptions {
  imagePaths: string[];
  audioPath: string;
  outputPath?: string;
  fps?: number;
  width?: number;
  height?: number;
}

export async function buildVideo(options: VideoOptions): Promise<string> {
  const {
    imagePaths,
    audioPath,
    outputPath = path.join(os.tmpdir(), `video_${Date.now()}.mp4`),
    fps = 24,
    width = 640,
    height = 360,
  } = options;

  if (imagePaths.length === 0) {
    throw new Error("No images provided for video");
  }

  const hasAudio = fs.existsSync(audioPath) && fs.statSync(audioPath).size > 100;

  const audioDuration = hasAudio ? await getAudioDuration(audioPath) : 10;
  const durationPerImage = audioDuration / imagePaths.length;

  const listFile = path.join(os.tmpdir(), `imglist_${Date.now()}.txt`);
  const listContent = imagePaths
    .map((imgPath) => {
      const ext = path.extname(imgPath).toLowerCase();
      const actualPath = [".png", ".jpg", ".jpeg"].includes(ext)
        ? imgPath
        : imgPath;
      return `file '${actualPath}'\nduration ${durationPerImage.toFixed(2)}`;
    })
    .join("\n");

  const lastImage = imagePaths[imagePaths.length - 1] || imagePaths[0];
  const finalList = listContent + `\nfile '${lastImage}'`;
  fs.writeFileSync(listFile, finalList);

  const silentVideoPath = path.join(os.tmpdir(), `silent_${Date.now()}.mp4`);

  await execAsync(
    `ffmpeg -y -f concat -safe 0 -i "${listFile}" ` +
      `-vf "scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1" ` +
      `-c:v libx264 -preset fast -crf 28 -pix_fmt yuv420p ` +
      `-r ${fps} "${silentVideoPath}"`
  );

  if (hasAudio) {
    await execAsync(
      `ffmpeg -y -i "${silentVideoPath}" -i "${audioPath}" ` +
        `-c:v copy -c:a aac -shortest "${outputPath}"`
    );
    fs.unlinkSync(silentVideoPath);
  } else {
    fs.renameSync(silentVideoPath, outputPath);
  }

  fs.unlinkSync(listFile);

  return outputPath;
}

async function getAudioDuration(audioPath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
    );
    return parseFloat(stdout.trim()) || 10;
  } catch {
    return 10;
  }
}

export async function addSubtitles(
  videoPath: string,
  script: string
): Promise<string> {
  const outputPath = videoPath.replace(".mp4", "_subtitled.mp4");
  const srtPath = path.join(os.tmpdir(), `subs_${Date.now()}.srt`);

  const srtContent = generateSRT(script);
  fs.writeFileSync(srtPath, srtContent, "utf-8");

  try {
    await execAsync(
      `ffmpeg -y -i "${videoPath}" ` +
        `-vf "subtitles='${srtPath}':force_style='FontSize=16,PrimaryColour=&Hffffff,OutlineColour=&H000000,BorderStyle=3,Outline=2,Shadow=1,Alignment=2'" ` +
        `-c:a copy "${outputPath}"`
    );
    fs.unlinkSync(srtPath);
    return outputPath;
  } catch {
    return videoPath;
  }
}

function generateSRT(script: string): string {
  const sentences = script
    .split(/[.،؟!]/g)
    .filter((s) => s.trim().length > 3)
    .slice(0, 10);

  let srt = "";
  const totalDuration = 30;
  const durationPerSentence = totalDuration / sentences.length;

  sentences.forEach((sentence, i) => {
    const start = i * durationPerSentence;
    const end = (i + 1) * durationPerSentence;
    srt += `${i + 1}\n`;
    srt += `${formatTime(start)} --> ${formatTime(end)}\n`;
    srt += `${sentence.trim()}\n\n`;
  });

  return srt;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function pad(n: number, digits: number = 2): string {
  return n.toString().padStart(digits, "0");
}

export async function cleanupFiles(files: string[]): Promise<void> {
  for (const f of files) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {
      // ignore
    }
  }
}
