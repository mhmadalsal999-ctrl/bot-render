import { Telegraf, type Context } from "telegraf";
import { logger } from "../lib/logger.js";
import { getUserState, clearUserState } from "../db/supabase.js";
import {
  handleMySeriesList,
  handleSeriesSelection,
  handleCreateSeriesStart,
  handleCreateSeriesStep,
  handleSeriesSettings,
  handleToggleAutoPublish,
  handleVoiceChange,
  handleSetVoice,
} from "./handlers/series.js";
import {
  handleGenerateEpisodeStart,
  handleEpisodeSeriesSelected,
  handleGenerateEpisodeCallback,
  handleListEpisodes,
  handlePublishEpisode,
  handleStats,
} from "./handlers/episode.js";
import { mainMenuKeyboard } from "./keyboards.js";

const BOT_TOKEN = process.env["TELEGRAM_BOT_TOKEN"];

if (!BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN is required");
}

export const bot = new Telegraf(BOT_TOKEN);

// ─── Start & Help ─────────────────────────────────────────────────────────

bot.start(async (ctx) => {
  const name = ctx.from?.first_name || "صديقي";
  await ctx.reply(
    `🎬 *أهلاً ${name}!*\n\n` +
      `أنا بوت إنشاء مسلسلات الأنيميشن بالذكاء الاصطناعي 🤖\n\n` +
      `يمكنني:\n` +
      `• ✍️ كتابة السيناريو الكامل\n` +
      `• 🎙️ توليد الصوت بـ ElevenLabs\n` +
      `• 🎨 إنشاء مشاهد الأنيميشن\n` +
      `• 🎬 تجميع الفيديو تلقائياً\n` +
      `• 📺 النشر على يوتيوب\n\n` +
      `ابدأ بإنشاء أول مسلسل لك! 🚀`,
    { parse_mode: "Markdown", ...mainMenuKeyboard() }
  );
});

bot.help(async (ctx) => {
  await ctx.reply(
    `❓ *المساعدة*\n\n` +
      `📺 *مسلسلاتي* - عرض وإدارة مسلسلاتك\n` +
      `➕ *إنشاء مسلسل* - إنشاء مسلسل جديد\n` +
      `🎬 *توليد حلقة* - توليد ونشر حلقة الآن\n` +
      `📊 *الإحصائيات* - إحصائيات مسلسلاتك\n\n` +
      `⚙️ *المتطلبات:*\n` +
      `• مفتاح GROQ API لكتابة السيناريو\n` +
      `• مفتاح ElevenLabs للصوت\n` +
      `• مفتاح HuggingFace للصور\n` +
      `• بيانات يوتيوب للنشر`,
    { parse_mode: "Markdown", ...mainMenuKeyboard() }
  );
});

// ─── Text messages ────────────────────────────────────────────────────────

bot.on("text", async (ctx) => {
  const text = ctx.message.text;
  const userId = String(ctx.from?.id);

  // Main menu buttons
  if (text === "📺 مسلسلاتي") {
    await handleMySeriesList(ctx);
    return;
  }
  if (text === "➕ إنشاء مسلسل جديد") {
    await handleCreateSeriesStart(ctx);
    return;
  }
  if (text === "🎬 توليد حلقة الآن") {
    await handleGenerateEpisodeStart(ctx);
    return;
  }
  if (text === "📊 الإحصائيات") {
    await handleStats(ctx);
    return;
  }
  if (text === "❓ المساعدة") {
    await ctx.reply("اضغط /help للمساعدة.");
    return;
  }
  if (text === "❌ إلغاء" || text === "🔙 رجوع") {
    await clearUserState(userId);
    await ctx.reply("✅ تم الإلغاء.", mainMenuKeyboard());
    return;
  }

  // Check user state for multi-step flows
  const userState = await getUserState(userId);
  if (!userState || userState.state === "idle") {
    await ctx.reply("اختر من القائمة:", mainMenuKeyboard());
    return;
  }

  const state = userState.state;

  if (state.startsWith("creating_series")) {
    await handleCreateSeriesStep(ctx, text);
    return;
  }

  if (state === "selecting_series_for_episode") {
    await handleEpisodeSeriesSelected(ctx, text);
    return;
  }
});

// ─── Callback queries ─────────────────────────────────────────────────────

bot.on("callback_query", async (ctx) => {
  if (!("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;

  // Generate episode
  const genEp = data.match(/^gen_ep_(\d+)$/);
  if (genEp) {
    await handleGenerateEpisodeCallback(ctx, parseInt(genEp[1]!));
    return;
  }

  // List episodes
  const listEps = data.match(/^list_eps_(\d+)$/);
  if (listEps) {
    await handleListEpisodes(ctx, parseInt(listEps[1]!));
    return;
  }

  // Publish episode
  const publishEp = data.match(/^publish_ep_(\d+)$/);
  if (publishEp) {
    await handlePublishEpisode(ctx, parseInt(publishEp[1]!));
    return;
  }

  // Series info
  const seriesInfo = data.match(/^series_info_(\d+)$/);
  if (seriesInfo) {
    await handleSeriesSelection(ctx, parseInt(seriesInfo[1]!));
    return;
  }

  // Series settings
  const seriesSettings = data.match(/^series_settings_(\d+)$/);
  if (seriesSettings) {
    await handleSeriesSettings(ctx, parseInt(seriesSettings[1]!));
    return;
  }

  // Toggle auto publish
  const toggleAuto = data.match(/^toggle_auto_(\d+)$/);
  if (toggleAuto) {
    await handleToggleAutoPublish(ctx, parseInt(toggleAuto[1]!));
    return;
  }

  // Change voice
  const changeVoice = data.match(/^change_voice_(\d+)$/);
  if (changeVoice) {
    await handleVoiceChange(ctx, parseInt(changeVoice[1]!));
    return;
  }

  // Set voice
  const setVoice = data.match(/^set_voice_(\d+)_(.+)$/);
  if (setVoice) {
    await handleSetVoice(ctx, parseInt(setVoice[1]!), setVoice[2]!);
    return;
  }

  await ctx.answerCbQuery("❓ أمر غير معروف");
});

// ─── Error handler ────────────────────────────────────────────────────────

bot.catch((err, ctx) => {
  logger.error({ err, update: ctx.update }, "Bot error");
});

// ─── Webhook & Polling ────────────────────────────────────────────────────

export async function setupWebhook(webhookUrl: string): Promise<void> {
  const BOT_TOKEN = process.env["TELEGRAM_BOT_TOKEN"]!;
  const webhookPath = `/bot${BOT_TOKEN}`;
  await bot.telegram.setWebhook(`${webhookUrl}${webhookPath}`);
  logger.info({ webhookUrl }, "Webhook set");
}

export async function startPolling(): Promise<void> {
  await bot.telegram.deleteWebhook();
  bot.launch();
  logger.info("Bot polling started");

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
