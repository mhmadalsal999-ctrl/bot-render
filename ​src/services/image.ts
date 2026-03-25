import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { Character } from "../db/supabase.js";

const HF_TOKEN = process.env["HUGGINGFACE_API_KEY"];

const IMAGE_MODELS = [
  "stabilityai/stable-diffusion-xl-base-1.0",
  "runwayml/stable-diffusion-v1-5",
  "CompVis/stable-diffusion-v1-4",
];

export async function generateSceneImage(
  script: string,
  characters: Character[],
  sceneIndex: number = 0
): Promise<string> {
  const prompt = buildImagePrompt(script, characters);
  const outputPath = path.join(os.tmpdir(), `scene_${Date.now()}_${sceneIndex}.png`);

  for (const model of IMAGE_MODELS) {
    try {
      const response = await axios.post(
        `https://api-inference.huggingface.co/models/${model}`,
        {
          inputs: prompt,
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

      if (response.data && response.data.byteLength > 1000) {
        fs.writeFileSync(outputPath, Buffer.from(response.data));
        return outputPath;
      }
    } catch {
      continue;
    }
  }

  return await generateFallbackImage(outputPath, script, sceneIndex);
}

function buildImagePrompt(script: string, characters: Character[]): string {
  const charDescriptions = characters
    .slice(0, 2)
    .map((c) => c.description)
    .join(", ");

  const sceneKeywords = extractKeywords(script);

  return `anime style, high quality, ${sceneKeywords}, ${charDescriptions}, cinematic lighting, vibrant colors, detailed background, 2D animation art style, masterpiece`;
}

function extractKeywords(script: string): string {
  const keywords: string[] = [];

  if (/ليل|مظلم|ظلام/.test(script)) keywords.push("night scene, dark atmosphere");
  if (/نهار|شمس|ضوء/.test(script)) keywords.push("daytime, bright sunlight");
  if (/غابة|أشجار/.test(script)) keywords.push("forest, trees");
  if (/مدينة|شارع/.test(script)) keywords.push("city street, urban");
  if (/قصر|منزل/.test(script)) keywords.push("castle, house");
  if (/بحر|ماء/.test(script)) keywords.push("ocean, water");
  if (/حرب|قتال/.test(script)) keywords.push("battle scene, action");
  if (/رعب|خوف/.test(script)) keywords.push("horror, scary atmosphere");

  return keywords.length > 0 ? keywords.join(", ") : "dramatic scene, emotional moment";
}

async function generateFallbackImage(
  outputPath: string,
  script: string,
  sceneIndex: number
): Promise<string> {
  const colors = [
    ["1a1a2e", "16213e", "0f3460"],
    ["2d1b69", "11998e", "38ef7d"],
    ["fc4445", "3b1f2b", "44107a"],
    ["0f2027", "203a43", "2c5364"],
  ];
  const palette = colors[sceneIndex % colors.length] || colors[0];

  const svgContent = `<svg width="640" height="360" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#${palette[0]};stop-opacity:1" />
      <stop offset="50%" style="stop-color:#${palette[1]};stop-opacity:1" />
      <stop offset="100%" style="stop-color:#${palette[2]};stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="640" height="360" fill="url(#bg)"/>
  <circle cx="100" cy="80" r="30" fill="#ffffff" opacity="0.1"/>
  <circle cx="540" cy="280" r="50" fill="#ffffff" opacity="0.05"/>
  <rect x="200" y="200" width="240" height="3" fill="#ffffff" opacity="0.2" rx="2"/>
  <text x="320" y="180" font-family="Arial" font-size="18" fill="white" text-anchor="middle" opacity="0.9">مسلسل أنيميشن</text>
  <text x="320" y="210" font-family="Arial" font-size="14" fill="white" text-anchor="middle" opacity="0.6">المشهد ${sceneIndex + 1}</text>
</svg>`;

  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  const svgPath = outputPath.replace(".png", ".svg");
  fs.writeFileSync(svgPath, svgContent);

  try {
    await execAsync(`convert -size 640x360 "${svgPath}" "${outputPath}"`);
  } catch {
    const pngSvgPath = outputPath.replace(".png", "_fallback.svg");
    fs.copyFileSync(svgPath, pngSvgPath);
    fs.copyFileSync(svgPath, outputPath.replace(".png", ".png.svg"));
    fs.writeFileSync(outputPath, fs.readFileSync(svgPath));
  }

  return outputPath;
}

export async function generateMultipleScenes(
  script: string,
  characters: Character[],
  count: number = 3
): Promise<string[]> {
  const scenes: string[] = [];
  const segments = splitScriptToScenes(script, count);

  for (let i = 0; i < segments.length; i++) {
    try {
      const imagePath = await generateSceneImage(segments[i] || script, characters, i);
      scenes.push(imagePath);
    } catch {
      const fallbackPath = path.join(os.tmpdir(), `fallback_${Date.now()}_${i}.png`);
      const imgPath = await generateFallbackImage(fallbackPath, script, i);
      scenes.push(imgPath);
    }
  }

  return scenes;
}

function splitScriptToScenes(script: string, count: number): string[] {
  const sentences = script.split(/[.،؟!]/g).filter((s) => s.trim().length > 10);
  const scenes: string[] = [];
  const chunkSize = Math.ceil(sentences.length / count);

  for (let i = 0; i < count; i++) {
    const chunk = sentences.slice(i * chunkSize, (i + 1) * chunkSize).join(". ");
    scenes.push(chunk || script);
  }

  return scenes;
}
