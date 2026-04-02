// ═══════════════════════════════════════════════════════════════════
// bot.js — Telegram bot initialization
// ═══════════════════════════════════════════════════════════════════

import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import { handleMessage } from './handlers/messageHandler.js';
import { handleCallbackQuery } from './handlers/callbackHandler.js';
import { logger } from '../utils/logger.js';

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const CALLBACK_BASE_URL = process.env.CALLBACK_BASE_URL;

if (!token) {
  logger.error('BOT', 'TELEGRAM_BOT_TOKEN is missing');
  process.exit(1);
}

const useWebhook = !!CALLBACK_BASE_URL;
let bot;

if (useWebhook) {
  bot = new TelegramBot(token, { polling: false });
  logger.success('BOT', 'Initialized in WEBHOOK mode');
} else {
  bot = new TelegramBot(token, {
    polling: { interval: 2000, autoStart: true, params: { timeout: 10 } }
  });
  logger.success('BOT', 'Initialized in POLLING mode');
}

bot.on('error', (err) => {
  if (!err.message?.includes('409')) logger.error('BOT', err.message);
});

bot.on('polling_error', (err) => {
  if (err.code === 'ETELEGRAM' && err.response?.body?.error_code === 409) {
    logger.warn('BOT', '409 Conflict — set CALLBACK_BASE_URL for webhook mode on Render');
  } else {
    logger.error('BOT', `Polling error: ${err.message}`);
  }
});

bot.on('message', async (msg) => {
  try {
    logger.bot(`From ${msg.from?.username || msg.from?.id}: ${msg.text || '[media]'}`);
    await handleMessage(bot, msg);
  } catch (err) {
    logger.error('BOT', `Message handler: ${err.message}`);
    try {
      await bot.sendMessage(msg.chat.id, '❌ Temporary error. Try /start');
    } catch (_) {}
  }
});

bot.on('callback_query', async (query) => {
  try {
    logger.bot(`Callback from ${query.from?.id}: ${query.data}`);
    await handleCallbackQuery(bot, query);
  } catch (err) {
    logger.error('BOT', `Callback handler: ${err.message}`);
    try {
      await bot.answerCallbackQuery(query.id, { text: '❌ Error, try again.' });
    } catch (_) {}
  }
});

export { bot };
