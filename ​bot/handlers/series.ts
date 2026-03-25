import type { Context } from "telegraf";
import {
  getUserSeries,
  createSeries,
  getSeries,
  updateSeries,
  getUserState,
  setUserState,
  clearUserState,
  type Series,
} from "../../db/supabase.js";
import { generateSeriesScenario } from "../../pipeline/index.js";
import {
  mainMenuKeyboard,
  genreKeyboard,
  seriesListKeyboard,
  seriesActionsKeyboard,
  settingsKeyboard,
  voiceSelectionKeyboard,
  GENRES,
  cancelKeyboard,
} from "../keyboards.js";
import { logger } from "../../lib/logger.js";

export async function handleMySeriesList(ctx: Context): Promise<void> {
  const userId = String(ctx.from?.id);
  const series = await getUserSeries(userId);

  if (series.length === 0) {
    await ctx.reply(
      "📺 *مسلسلاتك*\n\nلا توجد مسلسلات بعد!\nابدأ بإنشاء أول مسلسل لك 🎬",
      {
        parse_mode: "Markdown",
        ...seriesListKeyboard([]),
      }
    );
    return;
  }

  const list = series
    .map(
      (s, i) =>
        `${i + 1}. *${s.title}* (${getGenreLabel(s.genre)})\n` +
        `   📊 ${s.episodes_generated}/${s.total_episodes} حلقة • ${s.auto_publish ? "🔄 نشر تلقائي" : "⏸️ موقوف"}`
    )
    .join("\n\n");

  await ctx.reply(
    `📺 *مسلسلاتك* (${series.length})\n\n${list}\n\nاختر مسلسلاً للإدارة:`,
    {
      parse_mode: "Markdown",
      ...seriesListKeyboard(
        series.map((s) => ({ id: s.id, title: s.title, status: s.status }))
      ),
    }
  );
}

export async function handleSeriesSelection(ctx: Context, seriesId: number): Promise<void> {
  const series = await getSeries(seriesId);
  if (!series) {
    await ctx.reply("❌ لم يتم العثور على المسلسل");
    return;
  }

  const statusText = series.status === "active" ? "✅ نشط" : series.status === "paused" ? "⏸️ موقوف" : "🏁 منتهي";
  const autoText = series.auto_publish ? `🔄 يومياً ${series.publish_time} UTC` : "⏸️ موقوف";

  const msg =
    `🎬 *${series.title}*\n\n` +
    `📁 النوع: ${getGenreLabel(series.genre)}\n` +
    `📊 الحالة: ${statusText}\n` +
    `🎯 الحلقات: ${series.episodes_generated}/${series.total_episodes}\n` +
    `📅 النشر التلقائي: ${autoText}\n` +
    `🎙️ الصوت: ElevenLabs\n\n` +
    `${series.description ? `📝 ${series.description}` : ""}`;

  await ctx.reply(msg, {
    parse_mode: "Markdown",
    ...seriesActionsKeyboard(seriesId),
  });
}

export async function handleCreateSeriesStart(ctx: Context): Promise<void> {
  const userId = String(ctx.from?.id);
  await setUserState(userId, "creating_series_title", {});
  await ctx.reply(
    "🎬 *إنشاء مسلسل جديد*\n\n" +
      "الخطوة 1️⃣ من 4️⃣\n\n" +
      "✏️ أرسل لي *عنوان المسلسل*:\n\n" +
      "_مثال: أسرار الليل، المحارب الأخير، رحلة إلى المجهول_",
    {
      parse_mode: "Markdown",
      ...cancelKeyboard(),
    }
  );
}

export async function handleCreateSeriesStep(ctx: Context, text: string): Promise<void> {
  const userId = String(ctx.from?.id);
  const userState = await getUserState(userId);
  if (!userState) return;

  const { state, data } = userState;

  if (state === "creating_series_title") {
    if (text.length < 2 || text.length > 100) {
      await ctx.reply("❌ يجب أن يكون العنوان بين 2-100 حرف. حاول مجدداً:");
      return;
    }
    await setUserState(userId, "creating_series_genre", { title: text });
    await ctx.reply(
      `✅ العنوان: *${text}*\n\n` +
        "الخطوة 2️⃣ من 4️⃣\n\n" +
        "🎭 اختر *نوع المسلسل*:",
      {
        parse_mode: "Markdown",
        ...genreKeyboard(),
      }
    );
    return;
  }

  if (state === "creating_series_genre") {
    const genre = GENRES.find((g) => g.label === text);
    if (!genre) {
      await ctx.reply("❌ اختر نوعاً من القائمة:");
      return;
    }
    await setUserState(userId, "creating_series_description", {
      ...data,
      genre: genre.value,
    });
    await ctx.reply(
      `✅ النوع: *${genre.label}*\n\n` +
        "الخطوة 3️⃣ من 4️⃣\n\n" +
        "📝 أرسل *وصفاً مختصراً* للمسلسل:\n\n" +
        "_مثال: مجموعة من المحققين يكشفون أسرار مدينة مسكونة_",
      {
        parse_mode: "Markdown",
        ...cancelKeyboard(),
      }
    );
    return;
  }

  if (state === "creating_series_description") {
    await setUserState(userId, "creating_series_episodes", {
      ...data,
      description: text,
    });
    await ctx.reply(
      `✅ الوصف: *${text.slice(0, 50)}...*\n\n` +
        "الخطوة 4️⃣ من 4️⃣\n\n" +
        "🔢 كم عدد الحلقات؟\n\n" +
        "_أرسل رقماً من 5 إلى 50_",
      {
        parse_mode: "Markdown",
        ...cancelKeyboard(),
      }
    );
    return;
  }

  if (state === "creating_series_episodes") {
    const episodes = parseInt(text);
    if (isNaN(episodes) || episodes < 5 || episodes > 50) {
      await ctx.reply("❌ أرسل رقماً بين 5 و 50:");
      return;
    }

    await clearUserState(userId);

    const loadMsg = await ctx.reply(
      "⏳ جاري إنشاء المسلسل وكتابة السيناريو الكامل...\n\n" +
        "🤖 يعمل الذكاء الاصطناعي على:\n" +
        "• تطوير الشخصيات\n" +
        "• كتابة القصة الكاملة\n" +
        "• تقسيم الحلقات\n\n" +
        "_قد يستغرق هذا دقيقة..._",
      { parse_mode: "Markdown" }
    );

    try {
      const series = await createSeries({
        user_id: userId,
        title: data.title as string,
        genre: data.genre as string,
        description: data.description as string,
        total_episodes: episodes,
        characters: [],
        scenario: "",
        voice_id: "EXAVITQu4vr4xnSDxMaL",
        auto_publish: false,
        publish_time: "10:00",
        status: "active",
      });

      if (!series) throw new Error("Failed to create series");

      await generateSeriesScenario(series.id);

      const updatedSeries = await getSeries(series.id);

      await ctx.reply(
        `🎉 *تم إنشاء المسلسل بنجاح!*\n\n` +
          `🎬 *${series.title}*\n` +
          `📁 ${getGenreLabel(series.genre)}\n` +
          `📊 ${updatedSeries?.total_episodes || episodes} حلقة جاهزة\n\n` +
          `✅ تم كتابة السيناريو الكامل للمسلسل!\n` +
          `يمكنك الآن توليد ونشر الحلقات على يوتيوب.`,
        {
          parse_mode: "Markdown",
          ...seriesActionsKeyboard(series.id),
        }
      );
    } catch (err) {
      logger.error({ err }, "Failed to create series");
      await ctx.reply(
        "❌ حدث خطأ أثناء إنشاء المسلسل. تأكد من صحة مفاتيح API وحاول مجدداً.",
        { ...mainMenuKeyboard() }
      );
    }
    return;
  }
}

export async function handleSeriesSettings(ctx: Context, seriesId: number): Promise<void> {
  const series = await getSeries(seriesId);
  if (!series) return;

  await ctx.editMessageText(
    `⚙️ *إعدادات: ${series.title}*\n\n` +
      `🔄 النشر التلقائي: ${series.auto_publish ? "مفعّل ✅" : "موقوف ⏸️"}\n` +
      `⏰ وقت النشر: ${series.publish_time} UTC\n` +
      `🎙️ الصوت: ElevenLabs`,
    {
      parse_mode: "Markdown",
      ...settingsKeyboard(seriesId, series.auto_publish),
    }
  );
}

export async function handleToggleAutoPublish(ctx: Context, seriesId: number): Promise<void> {
  const series = await getSeries(seriesId);
  if (!series) return;

  const newValue = !series.auto_publish;
  await updateSeries(seriesId, { auto_publish: newValue });

  await ctx.answerCbQuery(
    newValue ? "✅ تم تفعيل النشر التلقائي!" : "⏸️ تم إيقاف النشر التلقائي"
  );

  await ctx.editMessageText(
    `⚙️ *إعدادات: ${series.title}*\n\n` +
      `🔄 النشر التلقائي: ${newValue ? "مفعّل ✅" : "موقوف ⏸️"}\n` +
      `⏰ وقت النشر: ${series.publish_time} UTC\n` +
      `🎙️ الصوت: ElevenLabs`,
    {
      parse_mode: "Markdown",
      ...settingsKeyboard(seriesId, newValue),
    }
  );
}

export async function handleVoiceChange(ctx: Context, seriesId: number): Promise<void> {
  await ctx.editMessageText(
    "🎙️ *اختر الصوت للمسلسل:*\n\n" +
      "• Rachel - صوت نسائي هادئ\n" +
      "• Adam - صوت رجالي قوي",
    {
      parse_mode: "Markdown",
      ...voiceSelectionKeyboard(seriesId),
    }
  );
}

export async function handleSetVoice(
  ctx: Context,
  seriesId: number,
  voiceId: string
): Promise<void> {
  await updateSeries(seriesId, { voice_id: voiceId });
  await ctx.answerCbQuery("✅ تم تغيير الصوت");
  await handleSeriesSettings(ctx, seriesId);
}

function getGenreLabel(genre: string): string {
  const found = GENRES.find((g) => g.value === genre);
  return found ? found.label : genre;
}
