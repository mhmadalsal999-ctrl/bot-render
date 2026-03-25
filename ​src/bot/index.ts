import { Telegraf } from "telegraf";
import { logger } from "../lib/logger.js";

const BOT_TOKEN = process.env["TELEGRAM_BOT_TOKEN"];

if (!BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN must be set in environment variables");
}

export const bot = new Telegraf(BOT_TOKEN);

// Start command
bot.start(async (ctx) => {
  await ctx.reply(
    "🎬 مرحباً بك في بوت مسلسلات الأنيميشن!\n\nأنا أساعدك على إنشاء مسلسلات أنيميشن بالذكاء الاصطناعي.",
    {
      reply_markup: {
        keyboard: [
          ["📺 مسلسلاتي", "➕ إنشاء مسلسل جديد"],
          ["🎬 توليد حلقة الآن", "⚙️ الإعدادات"],
          ["📊 الإحصائيات", "❓ المساعدة"],
        ],
        resize_keyboard: true,
      },
    }
  );
});

bot.help(async (ctx) => {
  await ctx.reply(
    "❓ المساعدة:\n\n" +
    "📺 مسلسلاتي - عرض مسلسلاتك\n" +
    "➕ إنشاء مسلسل جديد - إنشاء مسلسل جديد\n" +
    "🎬 توليد حلقة - توليد حلقة جديدة\n"
  );
});

export async function setupWebhook(webhookUrl: string): Promise<void> {
  await bot.telegram.setWebhook(`${webhookUrl}/bot${BOT_TOKEN}`);
  logger.info({ webhookUrl }, "Webhook set");
}

export async function startPolling(): Promise<void> {
  await bot.telegram.deleteWebhook();
  bot.launch();
  logger.info("Bot started with polling");
}
