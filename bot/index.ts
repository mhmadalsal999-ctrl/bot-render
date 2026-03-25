import { Telegraf, session } from "telegraf";
import type { Context } from "telegraf";
import { getUserState, setUserState, clearUserState } from "../db/supabase.js";
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
import { logger } from "../lib/logger.js";

const BOT_TOKEN = process.env["TELEGRAM_BOT_TOKEN"] || "placeholder_token";

export const bot = new Telegraf(BOT_TOKEN);

const WELCOME_MESSAGE = `
🎬 *مرحباً بك في بوت توليد المسلسلات!*

أنا بوت يساعدك على إنشاء مسلسلات أنيميشن كاملة بالذكاء الاصطناعي ونشرها تلقائياً على يوتيوب!

*ما يمكنني فعله:*
✅ كتابة سيناريو كامل لمسلسلك
🎙️ توليد صوت احترافي لكل حلقة
🎨 توليد مشاهد مرئية بالذكاء الاصطناعي
🎬 تجميع فيديو كامل تلقائياً
📺 نشر تلقائي يومي على يوتيوب

*ابدأ الآن:*
`;

bot.start(async (ctx) => {
  const userId = String(ctx.from.id);
  await clearUserState(userId);
  await ctx.reply(WELCOME_MESSAGE, {
    parse_mode: "Markdown",
    ...mainMenuKeyboard(),
  });
});

bot.help(async (ctx) => {
  await ctx.reply(
    `❓ *المساعدة*\n\n` +
      `📺 *مسلسلاتي* - عرض كل مسلسلاتك\n` +
      `➕ *إنشاء مسلسل جديد* - إنشاء مسلسل جديد بسيناريو كامل\n` +
      `🎬 *توليد حلقة الآن* - توليد ونشر حلقة على الفور\n` +
      `📊 *الإحصائيات* - إحصائيات قناتك\n` +
      `⚙️ *الإعدادات* - إعدادات البوت\n\n` +
      `🔄 *النشر التلقائي*: يمكن تفعيل النشر التلقائي اليومي من إعدادات كل مسلسل`,
    { parse_mode: "Markdown", ...mainMenuKeyboard() }
  );
});

bot.command("cancel", async (ctx) => {
  const userId = String(ctx.from.id);
  await clearUserState(userId);
  await ctx.reply("✅ تم الإلغاء", mainMenuKeyboard());
});

bot.on("text", async (ctx) => {
  const userId = String(ctx.from.id);
  const text = ctx.message.text;

  if (text === "❌ إلغاء") {
    await clearUserState(userId);
    await ctx.reply("✅ تم الإلغاء", mainMenuKeyboard());
    return;
  }

  if (text === "🔙 رجوع") {
    await clearUserState(userId);
    await ctx.reply("القائمة الرئيسية", mainMenuKeyboard());
    return;
  }

  if (text === "📺 مسلسلاتي") {
    await clearUserState(userId);
    await handleMySeriesList(ctx);
    return;
  }

  if (text === "➕ إنشاء مسلسل جديد") {
    await clearUserState(userId);
    await handleCreateSeriesStart(ctx);
    return;
  }

  if (text === "🎬 توليد حلقة الآن") {
    await clearUserState(userId);
    await handleGenerateEpisodeStart(ctx);
    return;
  }

  if (text === "📊 الإحصائيات") {
    await clearUserState(userId);
    await handleStats(ctx);
    return;
  }

  if (text === "⚙️ الإعدادات") {
    await clearUserState(userId);
    await ctx.reply(
      "⚙️ *الإعدادات*\n\nاختر مسلسلاً لإدارة إعداداته من قائمة مسلسلاتك.",
      { parse_mode: "Markdown", ...mainMenuKeyboard() }
    );
    return;
  }

  if (text === "❓ المساعدة") {
    await bot.handleUpdate({ update_id: 0, message: ctx.message });
    return;
  }

  const userState = await getUserState(userId);

  if (!userState || userState.state === "idle") {
    const seriesMatch = text.match(/^[✅⏸️🏁] .+ \(#(\d+)\)$/);
    if (seriesMatch) {
      const seriesId = parseInt(seriesMatch[1]!);
      await handleSeriesSelection(ctx, seriesId);
      return;
    }

    await ctx.reply("اختر من القائمة:", mainMenuKeyboard());
    return;
  }

  if (
    [
      "creating_series_title",
      "creating_series_genre",
      "creating_series_description",
      "creating_series_episodes",
    ].includes(userState.state)
  ) {
    await handleCreateSeriesStep(ctx, text);
    return;
  }

  if (userState.state === "selecting_series_for_episode") {
    await handleEpisodeSeriesSelected(ctx, text);
    return;
  }

  await ctx.reply("اختر من القائمة:", mainMenuKeyboard());
});

bot.on("callback_query", async (ctx) => {
  if (!("data" in ctx.callbackQuery)) return;
  const data = ctx.callbackQuery.data;

  try {
    if (data.startsWith("gen_ep_")) {
      const seriesId = parseInt(data.replace("gen_ep_", ""));
      await handleGenerateEpisodeCallback(ctx, seriesId);
      return;
    }

    if (data.startsWith("list_eps_")) {
      const seriesId = parseInt(data.replace("list_eps_", ""));
      await handleListEpisodes(ctx, seriesId);
      return;
    }

    if (data.startsWith("series_info_")) {
      const seriesId = parseInt(data.replace("series_info_", ""));
      await ctx.answerCbQuery();
      await handleSeriesSelection(ctx, seriesId);
      return;
    }

    if (data.startsWith("series_settings_")) {
      const seriesId = parseInt(data.replace("series_settings_", ""));
      await ctx.answerCbQuery();
      await handleSeriesSettings(ctx, seriesId);
      return;
    }

    if (data.startsWith("toggle_auto_")) {
      const seriesId = parseInt(data.replace("toggle_auto_", ""));
      await handleToggleAutoPublish(ctx, seriesId);
      return;
    }

    if (data.startsWith("change_voice_")) {
      const seriesId = parseInt(data.replace("change_voice_", ""));
      await ctx.answerCbQuery();
      await handleVoiceChange(ctx, seriesId);
      return;
    }

    if (data.startsWith("set_voice_")) {
      const parts = data.replace("set_voice_", "").split("_");
      const seriesId = parseInt(parts[0]!);
      const voiceId = parts.slice(1).join("_");
      await handleSetVoice(ctx, seriesId, voiceId);
      return;
    }

    if (data.startsWith("publish_ep_")) {
      const episodeId = parseInt(data.replace("publish_ep_", ""));
      await handlePublishEpisode(ctx, episodeId);
      return;
    }

    if (data.startsWith("delete_series_")) {
      const seriesId = parseInt(data.replace("delete_series_", ""));
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        "⚠️ هل أنت متأكد من حذف المسلسل؟ لا يمكن التراجع!",
        {
          parse_mode: "Markdown",
        }
      );
      return;
    }

    await ctx.answerCbQuery("⚠️ أمر غير معروف");
  } catch (err) {
    logger.error({ err, data }, "Callback query error");
    try {
      await ctx.answerCbQuery("❌ حدث خطأ");
    } catch {
      // ignore
    }
  }
});

bot.catch((err, ctx) => {
  logger.error({ err, updateType: ctx.updateType }, "Bot error");
});

export async function setupWebhook(baseUrl: string): Promise<void> {
  const webhookPath = `/bot${BOT_TOKEN}`;
  const webhookUrl = `${baseUrl}${webhookPath}`;

  await bot.telegram.setWebhook(webhookUrl);
  logger.info({ webhookUrl }, "Webhook set");
}

export async function startPolling(): Promise<void> {
  await bot.telegram.deleteWebhook();
  bot.launch();
  logger.info("Bot started with polling");
}
