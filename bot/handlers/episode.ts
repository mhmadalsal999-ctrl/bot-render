import type { Context } from "telegraf";
import {
  getSeries,
  getSeriesEpisodes,
  getEpisode,
  getUserState,
  setUserState,
  clearUserState,
  getUserSeries,
} from "../../db/supabase.js";
import { generateAndPublishNow, processEpisode } from "../../pipeline/index.js";
import { mainMenuKeyboard, seriesListKeyboard } from "../keyboards.js";
import { logger } from "../../lib/logger.js";

export async function handleGenerateEpisodeStart(ctx: Context): Promise<void> {
  const userId = String(ctx.from?.id);
  const series = await getUserSeries(userId);

  if (series.length === 0) {
    await ctx.reply("❌ لا توجد مسلسلات! أنشئ مسلسلاً أولاً.", mainMenuKeyboard());
    return;
  }

  if (series.length === 1) {
    await startEpisodeGeneration(ctx, series[0]!.id);
    return;
  }

  await setUserState(userId, "selecting_series_for_episode", {});
  await ctx.reply("🎬 *توليد حلقة جديدة*\n\nاختر المسلسل:", {
    parse_mode: "Markdown",
    ...seriesListKeyboard(series.map((s) => ({ id: s.id, title: s.title, status: s.status }))),
  });
}

export async function handleEpisodeSeriesSelected(ctx: Context, text: string): Promise<void> {
  const userId = String(ctx.from?.id);
  const match = text.match(/#(\d+)/);
  if (!match) {
    await ctx.reply("❌ اختر مسلسلاً من القائمة.");
    return;
  }
  const seriesId = parseInt(match[1]!);
  await clearUserState(userId);
  await startEpisodeGeneration(ctx, seriesId);
}

async function startEpisodeGeneration(ctx: Context, seriesId: number): Promise<void> {
  const series = await getSeries(seriesId);
  if (!series) {
    await ctx.reply("❌ لم يتم العثور على المسلسل.");
    return;
  }

  const progressMsg = await ctx.reply(
    `🎬 *جاري توليد حلقة من "${series.title}"*\n\n📝 كتابة السيناريو...`,
    { parse_mode: "Markdown" }
  );

  const steps: string[] = [];

  try {
    const result = await generateAndPublishNow(seriesId, async (step: string) => {
      steps.push(step);
      try {
        await ctx.telegram.editMessageText(
          progressMsg.chat.id,
          progressMsg.message_id,
          undefined,
          `🎬 *توليد حلقة: ${series.title}*\n\n${steps.join("\n")}\n⏳ جاري العمل...`,
          { parse_mode: "Markdown" }
        );
      } catch { /* ignore edit errors */ }
    });

    if (result.success && result.youtubeUrl) {
      await ctx.telegram.editMessageText(
        progressMsg.chat.id,
        progressMsg.message_id,
        undefined,
        `✅ *تم نشر الحلقة بنجاح على يوتيوب!*\n\n🎬 *${series.title}*\n🔗 ${result.youtubeUrl}\n\n${steps.map((s) => s.replace("⏳", "✅")).join("\n")}`,
        { parse_mode: "Markdown" }
      );
    } else if (result.success) {
      await ctx.telegram.editMessageText(
        progressMsg.chat.id,
        progressMsg.message_id,
        undefined,
        `✅ *تم توليد الحلقة بنجاح!*\n\n🎬 *${series.title}*\n\n${steps.map((s) => s.replace("⏳", "✅")).join("\n")}\n\n📌 _الرفع على يوتيوب سيكون متاحاً بعد إضافة بيانات يوتيوب_`,
        { parse_mode: "Markdown" }
      );
    } else {
      await ctx.telegram.editMessageText(
        progressMsg.chat.id,
        progressMsg.message_id,
        undefined,
        `❌ *فشل توليد الحلقة*\n\n${result.error || "خطأ غير معروف"}`,
        { parse_mode: "Markdown" }
      );
    }
  } catch (err) {
    logger.error({ err }, "Episode generation failed");
    await ctx.reply("❌ حدث خطأ أثناء توليد الحلقة.", mainMenuKeyboard());
  }
}

export async function handleGenerateEpisodeCallback(ctx: Context, seriesId: number): Promise<void> {
  await ctx.answerCbQuery("⏳ جاري بدء التوليد...");
  await startEpisodeGeneration(ctx, seriesId);
}

export async function handleListEpisodes(ctx: Context, seriesId: number): Promise<void> {
  const series = await getSeries(seriesId);
  if (!series) return;

  const episodes = await getSeriesEpisodes(seriesId);

  if (episodes.length === 0) {
    await ctx.editMessageText(`📋 *حلقات: ${series.title}*\n\nلا توجد حلقات بعد.`, {
      parse_mode: "Markdown",
    });
    return;
  }

  const statusIcon = (s: string) =>
    ({ pending: "⏳", generating: "🔄", ready: "✅", published: "📺", failed: "❌" }[s] || "❓");

  const list = episodes
    .slice(0, 15)
    .map((ep) => `${statusIcon(ep.status)} الحلقة ${ep.episode_number}: ${ep.title || "بدون عنوان"}`)
    .join("\n");

  const publishedCount = episodes.filter((e) => e.status === "published").length;
  const pendingCount = episodes.filter((e) => e.status === "pending").length;

  await ctx.editMessageText(
    `📋 *حلقات: ${series.title}*\n\n📊 منشورة: ${publishedCount} | جاهزة: ${pendingCount}\n\n${list}`,
    { parse_mode: "Markdown" }
  );
}

export async function handlePublishEpisode(ctx: Context, episodeId: number): Promise<void> {
  await ctx.answerCbQuery("⏳ جاري النشر...");

  const episode = await getEpisode(episodeId);
  if (!episode) {
    await ctx.reply("❌ لم يتم العثور على الحلقة");
    return;
  }

  const msg = await ctx.reply(`📤 جاري نشر الحلقة ${episode.episode_number}...`);

  try {
    const result = await processEpisode(episode.series_id, episodeId);

    if (result.success && result.youtubeUrl) {
      await ctx.telegram.editMessageText(
        msg.chat.id, msg.message_id, undefined,
        `✅ *تم النشر!*\n\n🔗 ${result.youtubeUrl}`,
        { parse_mode: "Markdown" }
      );
    } else {
      await ctx.telegram.editMessageText(
        msg.chat.id, msg.message_id, undefined,
        `❌ فشل النشر: ${result.error || "خطأ غير معروف"}`,
        { parse_mode: "Markdown" }
      );
    }
  } catch (err) {
    logger.error({ err }, "Episode publish failed");
    await ctx.reply("❌ حدث خطأ أثناء النشر");
  }
}

export async function handleStats(ctx: Context): Promise<void> {
  const userId = String(ctx.from?.id);
  const series = await getUserSeries(userId);

  let totalEpisodes = 0;
  let publishedEpisodes = 0;
  for (const s of series) {
    totalEpisodes += s.total_episodes;
    publishedEpisodes += s.episodes_generated;
  }

  await ctx.reply(
    `📊 *إحصائياتك*\n\n` +
    `📺 المسلسلات: ${series.length}\n` +
    `🎬 إجمالي الحلقات: ${totalEpisodes}\n` +
    `✅ الحلقات المنشورة: ${publishedEpisodes}\n` +
    `🔄 نشر تلقائي مفعّل: ${series.filter((s) => s.auto_publish).length} مسلسل`,
    { parse_mode: "Markdown", ...mainMenuKeyboard() }
  );
}
