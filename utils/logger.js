// ═══════════════════════════════════════════════════════════════════
// logger.js — Colored terminal logger
// ═══════════════════════════════════════════════════════════════════

const C = {
  reset:   '\x1b[0m',
  green:   '\x1b[32m',
  red:     '\x1b[31m',
  yellow:  '\x1b[33m',
  cyan:    '\x1b[36m',
  magenta: '\x1b[35m',
  blue:    '\x1b[34m',
  gray:    '\x1b[90m'
};

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export const logger = {
  info:    (tag, msg) => console.log(`${C.gray}[${ts()}]${C.reset} ${C.cyan}[${tag}]${C.reset} ${msg}`),
  success: (tag, msg) => console.log(`${C.gray}[${ts()}]${C.reset} ${C.green}[${tag}]${C.reset} ✅ ${msg}`),
  error:   (tag, msg) => console.error(`${C.gray}[${ts()}]${C.reset} ${C.red}[${tag}]${C.reset} ❌ ${msg}`),
  warn:    (tag, msg) => console.warn(`${C.gray}[${ts()}]${C.reset} ${C.yellow}[${tag}]${C.reset} ⚠️  ${msg}`),
  bot:     (msg)      => console.log(`${C.gray}[${ts()}]${C.reset} ${C.magenta}[BOT]${C.reset} 🤖 ${msg}`),
  clip:    (msg)      => console.log(`${C.gray}[${ts()}]${C.reset} ${C.blue}[CLIP]${C.reset} 🎬 ${msg}`),
  cron:    (msg)      => console.log(`${C.gray}[${ts()}]${C.reset} ${C.yellow}[CRON]${C.reset} ⏰ ${msg}`)
};
