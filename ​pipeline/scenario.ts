import Groq from "groq-sdk";
import type { Character } from "../db/supabase.js";

let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!_groq) {
    _groq = new Groq({ apiKey: process.env["GROQ_API_KEY"] || "" });
  }
  return _groq;
}
const groq = new Proxy({} as Groq, {
  get(_t, p) {
    const g = getGroq();
    const v = (g as unknown as Record<string | symbol, unknown>)[p];
    return typeof v === "function" ? v.bind(g) : v;
  },
});

export interface ScenarioResult {
  fullScenario: string;
  episodes: EpisodeScript[];
  characters: Character[];
  title: string;
}

export interface EpisodeScript {
  episodeNumber: number;
  title: string;
  script: string;
  summary: string;
}

const GENRE_PROMPTS: Record<string, string> = {
  horror: "مسلسل رعب مظلم ومثير مليء بالتوتر والإثارة",
  adventure: "مسلسل مغامرات مثير ومليء بالأكشن والاكتشاف",
  comedy: "مسلسل كوميدي خفيف الظل ومضحك",
  romance: "مسلسل رومانسي مؤثر وعاطفي",
  sci_fi: "مسلسل خيال علمي مستقبلي ومثير",
  fantasy: "مسلسل فانتازيا سحري ومليء بالمخلوقات العجيبة",
  action: "مسلسل أكشن متسارع الإيقاع ومثير",
  mystery: "مسلسل غموض وتشويق مليء بالأسرار",
  drama: "مسلسل دراما إنسانية عميقة ومؤثرة",
};

export async function generateFullScenario(
  title: string,
  genre: string,
  description: string,
  totalEpisodes: number = 20
): Promise<ScenarioResult> {
  const genreDesc = GENRE_PROMPTS[genre] || `مسلسل ${genre}`;

  const scenarioPrompt = `أنت كاتب سيناريو محترف. اكتب سيناريو كامل لمسلسل أنيميشن باللغة العربية.

عنوان المسلسل: ${title}
النوع: ${genreDesc}
الوصف: ${description}
عدد الحلقات: ${totalEpisodes}

المطلوب:
1. قصة متماسكة وشخصيات واضحة تتطور عبر الحلقات
2. كل حلقة حوالي 30 ثانية (حوار ووصف مشاهد)
3. نفس الشخصيات في كل الحلقات
4. أحداث متسلسلة ومترابطة

أجب بتنسيق JSON فقط:
{
  "characters": [
    {
      "name": "اسم الشخصية",
      "role": "البطل/المساعد/الشرير...",
      "description": "وصف مظهرها",
      "personality": "شخصيتها"
    }
  ],
  "episodes": [
    {
      "episodeNumber": 1,
      "title": "عنوان الحلقة",
      "summary": "ملخص الحلقة",
      "script": "السيناريو الكامل للحلقة مع الحوار والمشاهد"
    }
  ]
}`;

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: "أنت كاتب سيناريو محترف. أجب دائماً بـ JSON صحيح فقط دون أي نص إضافي.",
      },
      { role: "user", content: scenarioPrompt },
    ],
    temperature: 0.8,
    max_tokens: 8000,
  });

  const content = response.choices[0]?.message?.content || "{}";

  let parsed: { characters?: Character[]; episodes?: EpisodeScript[] };
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { characters: [], episodes: [] };
  } catch {
    parsed = { characters: [], episodes: [] };
  }

  const characters = parsed.characters || [];
  const episodes = parsed.episodes || [];

  return {
    fullScenario: content,
    episodes,
    characters,
    title,
  };
}

export async function generateSingleEpisode(
  seriesTitle: string,
  genre: string,
  characters: Character[],
  previousSummaries: string[],
  episodeNumber: number
): Promise<EpisodeScript> {
  const genreDesc = GENRE_PROMPTS[genre] || `مسلسل ${genre}`;
  const charsDesc = characters
    .map((c) => `- ${c.name} (${c.role}): ${c.description}، ${c.personality}`)
    .join("\n");

  const prevContext =
    previousSummaries.length > 0
      ? `ما حدث سابقاً:\n${previousSummaries.slice(-3).join("\n")}`
      : "هذه الحلقة الأولى.";

  const prompt = `اكتب سيناريو حلقة ${episodeNumber} من مسلسل "${seriesTitle}" (${genreDesc}).

الشخصيات الثابتة:
${charsDesc}

${prevContext}

اكتب سيناريو حلقة مدتها 30 ثانية تقريباً بتنسيق JSON:
{
  "episodeNumber": ${episodeNumber},
  "title": "عنوان الحلقة",
  "summary": "ملخص قصير لما حدث",
  "script": "السيناريو الكامل: وصف المشهد + الحوار بشكل متناسق"
}`;

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: "أنت كاتب سيناريو. أجب بـ JSON فقط.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.8,
    max_tokens: 2000,
  });

  const content = response.choices[0]?.message?.content || "{}";
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    return jsonMatch
      ? JSON.parse(jsonMatch[0])
      : {
          episodeNumber,
          title: `الحلقة ${episodeNumber}`,
          summary: "",
          script: content,
        };
  } catch {
    return {
      episodeNumber,
      title: `الحلقة ${episodeNumber}`,
      summary: "",
      script: content,
    };
  }
}
