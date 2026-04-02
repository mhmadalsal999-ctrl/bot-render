// ═══════════════════════════════════════════════════════════════════
// messages.js — All keyboards + message templates (Professional UI)
// ═══════════════════════════════════════════════════════════════════

// ── Main Menu ─────────────────────────────────────────────────────
export function mainKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '✂️ New Clip' },        { text: '📁 My Clips'       }],
        [{ text: '📊 Stats & Earnings' }, { text: '📺 YouTube Setup'  }],
        [{ text: '❓ Help'             }]
      ],
      resize_keyboard:    true,
      one_time_keyboard:  false,
      input_field_placeholder: 'Choose an option or send a YouTube link...'
    }
  };
}

// ── Cancel only ───────────────────────────────────────────────────
export function cancelKeyboard() {
  return {
    reply_markup: {
      keyboard: [[{ text: '❌ Cancel' }]],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}

// ── Duration picker (inline) ──────────────────────────────────────
export function durationKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '⚡ 15s',  callback_data: 'dur:15'  },
          { text: '🔥 30s',  callback_data: 'dur:30'  },
          { text: '🎬 45s',  callback_data: 'dur:45'  }
        ],
        [
          { text: '📽️ 60s',  callback_data: 'dur:60'  },
          { text: '🎥 90s',  callback_data: 'dur:90'  }
        ]
      ]
    }
  };
}

// ── Quality picker (inline) ───────────────────────────────────────
export function qualityKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🎯 1080p  (Fast)',    callback_data: 'q:1080' },
          { text: '💎 1440p  (2K)',      callback_data: 'q:1440' }
        ],
        [
          { text: '👑 2160p  (4K)',      callback_data: 'q:2160' }
        ]
      ]
    }
  };
}

// ── Clip action buttons ───────────────────────────────────────────
export function clipActionsKeyboard(clipId, hasYT = false) {
  const rows = [];

  if (!hasYT) {
    rows.push([{ text: '📺 Upload to YouTube Shorts', callback_data: `yt_upload:${clipId}` }]);
  }

  rows.push([
    { text: '📊 View Stats',      callback_data: `stats:${clipId}`  },
    { text: '🔄 Refresh Views',   callback_data: `refresh:${clipId}` }
  ]);

  rows.push([
    { text: '🎵 Set TikTok Link',     callback_data: `set_tt:${clipId}` },
    { text: '📸 Set Instagram Link',  callback_data: `set_ig:${clipId}` }
  ]);

  rows.push([
    { text: '🗑 Delete Clip',  callback_data: `del_clip:${clipId}` },
    { text: '🔙 My Clips',    callback_data: 'my_clips'           }
  ]);

  return { reply_markup: { inline_keyboard: rows } };
}

// ── Clips list (after clip is ready) ─────────────────────────────
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
      const icon  = ICON[c.status] || '📹';
      const title = (c.source_title || 'Clip').slice(0, 30);
      return [{ text: `${icon} ${title}`, callback_data: `clip:${c.id}` }];
    });

  rows.push([{ text: '🔙 Main Menu', callback_data: 'back_main' }]);
  return { reply_markup: { inline_keyboard: rows } };
}

// ── Confirm delete ────────────────────────────────────────────────
export function confirmDeleteKeyboard(clipId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Yes, delete',  callback_data: `confirm_del:${clipId}` },
          { text: '❌ No, keep it',  callback_data: `clip:${clipId}`         }
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

I turn any video into a viral short clip that *earns you money* on:
• 🎵 TikTok  • 📸 Instagram Reels  • 🎬 YouTube Shorts

*What I do automatically:*
✅ Crop to 9:16 vertical (smart — no black bars)
✅ Transcribe every word spoken
✅ Hormozi-style word-by-word captions
✅ Add trending background music
✅ Brand watermark
✅ Upload to YouTube Shorts
✅ Track views & calculate earnings

*To start, tap ✂️ New Clip or just send me:*
• 🔗 A YouTube link
• 📤 A video file (up to 50MB)`;

export const HELP_MSG =
`❓ *ClipBot Pro — Help*

*✂️ New Clip*
Send a YouTube link or upload any video.
Choose start time + duration → done!

*📁 My Clips*
See all your clips with status:
⏳ Pending → ⚙️ Processing → ✅ Ready → 📤 Published

*📊 Stats & Earnings*
Total views across all platforms + estimated earnings.
Default CPM: $3 / 1,000 views.

*📺 YouTube Setup*
Connect your YouTube channel to auto-upload Shorts.

*Supported video formats:*
MP4, MOV, AVI, MKV (any aspect ratio)

*Earnings platforms:*
• Clipping.net — up to $3 CPM
• Reach.cat — up to $6 CPM  
• Whop — $1–$5 CPM`;

export const STATUS_LABELS = {
  pending:    '⏳ Pending',
  processing: '⚙️ Processing',
  ready:      '✅ Ready',
  published:  '📤 Published',
  failed:     '❌ Failed'
};
