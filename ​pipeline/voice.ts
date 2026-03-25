import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const ELEVENLABS_API_KEY = process.env["ELEVENLABS_API_KEY"];
const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

export const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";

export interface VoiceInfo {
  voice_id: string;
  name: string;
  category: string;
}

export async function getAvailableVoices(): Promise<VoiceInfo[]> {
  try {
    const response = await axios.get(`${ELEVENLABS_BASE}/voices`, {
      headers: { "xi-api-key": ELEVENLABS_API_KEY },
    });
    return (response.data.voices || []).map((v: VoiceInfo) => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category,
    }));
  } catch {
    return [
      { voice_id: "EXAVITQu4vr4xnSDxMaL", name: "Rachel", category: "premade" },
      { voice_id: "21m00Tcm4TlvDq8ikWAM", name: "Adam", category: "premade" },
      { voice_id: "AZnzlk1XvdvUeBnXmlld", name: "Domi", category: "premade" },
    ];
  }
}

export async function generateVoice(
  text: string,
  voiceId: string = DEFAULT_VOICE_ID
): Promise<string> {
  const cleanText = text
    .replace(/\[.*?\]/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/[*_#]/g, "")
    .trim()
    .slice(0, 2500);

  const outputPath = path.join(os.tmpdir(), `voice_${Date.now()}.mp3`);

  const response = await axios.post(
    `${ELEVENLABS_BASE}/text-to-speech/${voiceId}`,
    {
      text: cleanText,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.3,
        use_speaker_boost: true,
      },
    },
    {
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      responseType: "arraybuffer",
    }
  );

  fs.writeFileSync(outputPath, Buffer.from(response.data));
  return outputPath;
}

export async function generateVoiceEdgeTTS(text: string): Promise<string> {
  const outputPath = path.join(os.tmpdir(), `voice_edge_${Date.now()}.mp3`);

  const cleanText = text
    .replace(/\[.*?\]/g, "")
    .replace(/[*_#]/g, "")
    .trim()
    .slice(0, 3000);

  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  try {
    await execAsync(
      `edge-tts --voice ar-SA-ZariyahNeural --text "${cleanText.replace(/"/g, "'")}" --write-media "${outputPath}"`
    );
    return outputPath;
  } catch {
    fs.writeFileSync(outputPath, Buffer.alloc(0));
    return outputPath;
  }
}
