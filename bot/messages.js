// ═══════════════════════════════════════════════════════════════════
// messages.js — Professional UI: keyboards + message templates
// ═══════════════════════════════════════════════════════════════════

// ── Main Menu ─────────────────────────────────────────────────────
export function mainKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '🎬 New Clip' },     { text: '📂 My Clips'      }],
        [{ text: '📊 My Stats' },     { text: '📺 YouTube Setup' }],
        [{ text: '💡 Help'    }]
      ],
      resize_keyboard:         true,
      one_time_keyboard:       false,
      input_field_placeholder: '📤 Drop a video or paste a YouTube link...'
    }
  };
}

// ── Cancel ────────────────────────────────────────────────────────
export function cancelKeyboard() {
  return {
    reply_markup: {
      keyboard: [[{ text: '❌ Cancel' }]],
      resize_keyboard:   true,
      one_time_keyboard: false,
      input_field_placeholder: 'Type here or cancel...'
    }
  };
}

// ── Duration picker ───────────────────────────────────────────────
export function durationKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '⚡ 15s',  callback_data: 'dur:15'  },
          { text: '🔥 30s',  callback_data: 'dur:30'  },
          { text: '✨ 45s',  callback_data: 'dur:45'  }
        ],
        [
          { text: '🎬 60s',  callback_data: 'dur:60'  },
          { text: '🎥 90s',  callback_data: 'dur:90'  }
        ]
      ]
    }
  };
}

// ── Quality picker ────────────────────────────────────────────────
export function qualityKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '⚡ 1080p — Fast & Smooth', callback_data: 'q:1080' }
        ],
        [
          { text: '💎 1440p — High Quality',  callback_data: 'q:1440' }
        ],
        [
          { text: '👑 2160p — Ultra 4K',      callback_data: 'q:2160' }
        ]
      ]
    }
  };
}

// ── Clip action buttons ───────────────────────────────────────────
export function clipActionsKeyboard(clipId, hasYT = false) {
  const rows = [];

  if (!hasYT) {
    rows.push([
      { text: '📺 Upload to YouTube Shorts', callback_data: `yt_upload:${clipId}` }
    ]);
  }

  rows.push([
    { text: '📊 View Stats',    callback_data: `stats:${clipId}`   },
    { text: '🔄 Refresh',       callback_data: `refresh:${clipId}` }
  ]);

  rows.push([
    { text: '🎵 TikTok Link',   callback_data: `set_tt:${clipId}`  },
    { text: '📸 Instagram Link',callback_data: `set_ig:${clipId}`  }
  ]);

  rows.push([
    { text: '🗑 Delete',        callback_data: `del_clip:${clipId}` },
    { text: '↩️ Back',          callback_data: 'my_clips'           }
  ]);

  return { reply_markup: { inline_keyboard: rows } };
}

// ── Clips list ────────────────────────────────────────────────────
export function clipsListKeyboard(clips) {
  const ICON = {
    pending:    '⏳',
    processing: '⚙️',
    ready:      '✅',
    published:  '📤',
    failed:     '❌',
    deleted:    '🗑'
  };

  const rows = clips
    .filter(c => c.status !== 'deleted')
    .slice(0, 8)
    .map(c => {
      const icon  = ICON[c.status] || '🎬';
      const title = (c.source_title || 'Untitled Clip').slice(0, 28);
      return [{ text: `${icon}  ${title}`, callback_data: `clip:${c.id}` }];
    });

  rows.push([{ text: '↩️ Back to Menu', callback_data: 'back_main' }]);
  return { reply_markup: { inline_keyboard: rows } };
}

// ── Confirm delete ────────────────────────────────────────────────
export function confirmDeleteKeyboard(clipId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🗑 Yes, delete it',  callback_data: `confirm_del:${clipId}` },
          { text: '↩️ Keep it',          callback_data: `clip:${clipId}`         }
        ]
      ]
    }
  };
}

// ═══════════════════════════════════════════════════════════════════
// MESSAGE TEMPLATES
// ═══════════════════════════════════════════════════════════════════

export const WELCOME_MSG =
`🎬 *Welcome to ClipBot Pro!*

Transform any video into a viral short clip — automatically.

*What I do for you:*
┌ ✂️ Smart crop to 9:16 vertical
├ 🎙 Transcribe every word spoken
├ 📝 Hormozi-style word captions
├ 🎵 Add background music
├ 💧 Brand watermark
├ 📺 Upload to YouTube Shorts
└ 📊 Track views & earnings

*Getting started is simple:*
🔗 Paste a YouTube link
— or —
📤 Send a video file directly \\(up to 50MB\\)

Then tap *🎬 New Clip* and let me handle the rest\\.`;

export const HELP_MSG =
`💡 *How to use ClipBot Pro*

*🎬 New Clip*
Send a video file \\(up to 50MB\\) or a YouTube link\\.
I'll crop, caption, and produce it automatically\\.

*📂 My Clips*
View all your clips and their status:
⏳ Queued → ⚙️ Processing → ✅ Ready → 📤 Published

*📊 My Stats*
See total views across all platforms and your estimated earnings\\.

*📺 YouTube Setup*
Connect your channel to auto\\-upload clips as Shorts\\.

━━━━━━━━━━━━━━━━━━━━━
*Supported formats:* MP4 · MOV · AVI · MKV
*Max file size:* 50MB
*Clip length:* 15s – 90s
━━━━━━━━━━━━━━━━━━━━━

*💰 Earn money with your clips on:*
• Clipping\\.net — up to \\$3 CPM
• Reach\\.cat — up to \\$6 CPM
• Whop — \\$1–\\$5 CPM`;

export const STATUS_LABELS = {
  pending:    '⏳ Queued',
  processing: '⚙️ Processing',
  ready:      '✅ Ready',
  published:  '📤 Published',
  failed:     '❌ Failed'
};
