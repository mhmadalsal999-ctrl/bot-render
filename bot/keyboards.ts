import { Markup } from "telegraf";

export const GENRES = [
  { label: "👻 رعب", value: "horror" },
  { label: "⚔️ مغامرات", value: "adventure" },
  { label: "😂 كوميدي", value: "comedy" },
  { label: "💕 رومانسي", value: "romance" },
  { label: "🚀 خيال علمي", value: "sci_fi" },
  { label: "🧙 فانتازيا", value: "fantasy" },
  { label: "💥 أكشن", value: "action" },
  { label: "🔍 غموض وتشويق", value: "mystery" },
  { label: "🎭 دراما", value: "drama" },
];

export function mainMenuKeyboard() {
  return Markup.keyboard([
    ["📺 مسلسلاتي", "➕ إنشاء مسلسل جديد"],
    ["🎬 توليد حلقة الآن", "⚙️ الإعدادات"],
    ["📊 الإحصائيات", "❓ المساعدة"],
  ])
    .resize()
    .oneTime(false);
}

export function genreKeyboard() {
  const rows: { text: string }[][] = [];
  for (let i = 0; i < GENRES.length; i += 2) {
    const row = [{ text: GENRES[i]!.label }];
    if (GENRES[i + 1]) row.push({ text: GENRES[i + 1]!.label });
    rows.push(row);
  }
  rows.push([{ text: "🔙 رجوع" }]);
  return Markup.keyboard(rows).resize();
}

export function seriesListKeyboard(series: { id: number; title: string; status: string }[]) {
  const statusIcon = (s: string) =>
    s === "active" ? "✅" : s === "paused" ? "⏸️" : "🏁";

  const rows = series.map((s) => [
    { text: `${statusIcon(s.status)} ${s.title} (#${s.id})` },
  ]);
  rows.push([{ text: "➕ مسلسل جديد" }, { text: "🔙 رجوع" }]);
  return Markup.keyboard(rows).resize();
}

export function seriesActionsKeyboard(seriesId: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("🎬 توليد حلقة الآن", `gen_ep_${seriesId}`),
      Markup.button.callback("📋 الحلقات", `list_eps_${seriesId}`),
    ],
    [
      Markup.button.callback("⚙️ الإعدادات", `series_settings_${seriesId}`),
      Markup.button.callback("🗑️ حذف المسلسل", `delete_series_${seriesId}`),
    ],
    [
      Markup.button.callback("🔄 إيقاف/تشغيل النشر التلقائي", `toggle_auto_${seriesId}`),
    ],
  ]);
}

export function episodeActionsKeyboard(episodeId: number, seriesId: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("▶️ نشر الآن", `publish_ep_${episodeId}`),
      Markup.button.callback("🗑️ حذف", `delete_ep_${episodeId}_${seriesId}`),
    ],
    [Markup.button.callback("🔙 رجوع", `list_eps_${seriesId}`)],
  ]);
}

export function confirmKeyboard(action: string, cancelAction: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ تأكيد", action),
      Markup.button.callback("❌ إلغاء", cancelAction),
    ],
  ]);
}

export function settingsKeyboard(seriesId: number, autoPublish: boolean) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        autoPublish ? "⏸️ إيقاف النشر التلقائي" : "▶️ تشغيل النشر التلقائي",
        `toggle_auto_${seriesId}`
      ),
    ],
    [Markup.button.callback("🎙️ تغيير الصوت", `change_voice_${seriesId}`)],
    [Markup.button.callback("🔙 رجوع", `series_info_${seriesId}`)],
  ]);
}

export function voiceSelectionKeyboard(seriesId: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("👩 Rachel (إنجليزي)", `set_voice_${seriesId}_EXAVITQu4vr4xnSDxMaL`),
      Markup.button.callback("👨 Adam (إنجليزي)", `set_voice_${seriesId}_21m00Tcm4TlvDq8ikWAM`),
    ],
    [
      Markup.button.callback("🔙 رجوع", `series_settings_${seriesId}`),
    ],
  ]);
}

export function cancelKeyboard() {
  return Markup.keyboard([["❌ إلغاء"]]).resize();
}

export function backKeyboard() {
  return Markup.keyboard([["🔙 رجوع"]]).resize();
}
