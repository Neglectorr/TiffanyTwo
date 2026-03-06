'use strict';

const { EmbedBuilder } = require('discord.js');

// ─── Page definitions ─────────────────────────────────────────────────────
// Each page is { title, color, fields: [{ name, value }], footer }
// All field values must be ≤ 1024 chars; total embed ≤ 6000 chars.

const PAGES = [
  // ── Page 1: Getting started ──────────────────────────────────────────────
  {
    title: '📖 How Tiffany Works — 1/8: Getting Started',
    color: 0x5865f2,
    fields: [
      {
        name: '🗣️ How to talk to me',
        value:
          'Every text command starts with **Tiffany** followed by what you want, for example:\n' +
          '> `Tiffany summon`\n' +
          'Commands are **case-insensitive** — `TIFFANY LOUDER` works just as well.\n\n' +
          'When I am in a voice channel I also **listen to you speak**. Most commands work ' +
          'vocally without the "Tiffany" prefix, though saying "Tiffany …" is fine too. ' +
          'When you address me as _Tiffany_ I\'ll give a short spoken acknowledgement.',
      },
      {
        name: '🎤 Wake word: "Hey Tiffany"',
        value:
          'Say **"Hey Tiffany"** as a wake word, then follow with your command. Both of these work:\n' +
          '> _"Hey Tiffany, louder"_\n' +
          '> _"Hey Tiffany — Tiffany louder"_\n\n' +
          'You can also just say "Hey Tiffany" by itself — the next thing you say within 10 seconds ' +
          'is treated as a command without needing the prefix.',
      },
      {
        name: '📡 `Tiffany summon`',
        value:
          'Pulls me into **your current voice channel**. You must already be sitting in one ' +
          'when you send this command. I will stay there until you tell me to leave.\n' +
          '🗣️ _Voice: "summon"_',
      },
      {
        name: '👋 `Tiffany leave` · `bye` · `disconnect`',
        value:
          'Stops playback and **disconnects me from the voice channel**. Your persistent ' +
          'playlist is never deleted — it will be right where you left it next time.\n' +
          '🗣️ _Voice: "leave", "bye", or "disconnect"_',
      },
      {
        name: '💤 Sleep timer',
        value:
          'If everyone leaves the voice channel, I wait **2 minutes** in case someone comes back. ' +
          'If not, I stop playback and leave automatically. A new `Tiffany summon` is needed to bring me back.',
      },
    ],
    footer: 'Page 1 of 8 — use ◀️ ▶️ to navigate',
  },

  // ── Page 2: Discovering & queuing music ──────────────────────────────────
  {
    title: '📖 How Tiffany Works — 2/8: Finding Music',
    color: 0xff0000,
    fields: [
      {
        name: '🔍 `Tiffany find {song name}`',
        value:
          'Searches YouTube and shows up to **5 results** in an embed. Each result has a ' +
          'number reaction (1️⃣ – 5️⃣). Click the number you want and that song is added to the ' +
          'persistent playlist.\n' +
          '🗣️ _Voice: "find {song name}" — then say **"I choose {number}"** to pick a result._\n' +
          'If the bot is not yet in a voice channel it will automatically join yours when you queue a song.',
      },
      {
        name: '🔗 `Tiffany play {youtube url}`',
        value:
          'Queues a specific YouTube **video or playlist** from a URL.\n' +
          '• **Single video URL** → added directly to the playlist.\n' +
          '• **Playlist URL** → the bot asks for confirmation (✅ add all / ❌ cancel).\n' +
          '• **Video inside a playlist** (URL has both `v=` and `list=`) → bot asks whether to ' +
          'add just the video or the whole playlist.\n' +
          '⚠️ _Text only — vocal URL spelling is not supported._',
      },
      {
        name: '🎶 `Tiffany i am in the mood for {style}`',
        value:
          'Searches YouTube for **playlists** matching your chosen style (e.g. "jazz", "lo-fi beats", ' +
          '"80s rock"). Up to 3 playlists are shown; pick one with reactions.\n' +
          'This starts a **temporary mood queue** that plays independently of your persistent playlist — ' +
          'nothing is added or removed from your saved list.\n' +
          'When the mood playlist ends, the bot asks:\n' +
          '🔄 — Search for another {style} playlist\n' +
          '▶️ — Return to the regular playlist\n' +
          '🗣️ _Voice: "I am in the mood for {style}"_',
      },
    ],
    footer: 'Page 2 of 8 — use ◀️ ▶️ to navigate',
  },

  // ── Page 3: Playback controls ─────────────────────────────────────────────
  {
    title: '📖 How Tiffany Works — 3/8: Playback Controls',
    color: 0x2ecc71,
    fields: [
      {
        name: '▶️ `Tiffany play`  _(no URL)_',
        value:
          'Starts or resumes the **persistent playlist** if the player is idle. ' +
          'If you are not yet in a voice channel the bot will join yours automatically.\n' +
          '🗣️ _Voice: "play"_',
      },
      {
        name: '⏸️ `Tiffany pause`',
        value:
          'Freezes the audio **mid-stream** at the exact current position. ' +
          'The song does not restart from the beginning.\n' +
          '🗣️ _Voice: "pause"_',
      },
      {
        name: '▶️ `Tiffany resume`',
        value:
          'Continues playback after a pause or stop:\n' +
          '• After **pause** → stream continues from the frozen position.\n' +
          '• After **stop** → the current song restarts from the beginning.\n' +
          '🗣️ _Voice: "resume"_',
      },
      {
        name: '⏹️ `Tiffany stop`',
        value:
          'Halts playback **without advancing** the playlist. The current song is ' +
          'remembered so `resume` will bring it right back. Useful when you want ' +
          'silence without losing your place.\n' +
          '🗣️ _Voice: "stop"_',
      },
      {
        name: '⏭️ `Tiffany skip this song`',
        value:
          'Immediately skips to the **next song** in the queue. The skipped song ' +
          'stays in the playlist — it will come around again after the playlist shuffles.\n' +
          '🗣️ _Voice: "skip" or "skip this song"_',
      },
      {
        name: '⏮️ `Tiffany previous`  ·  `back`',
        value:
          'Goes back one song and **replays it from the start**. ' +
          'Works in both the persistent playlist and the mood queue.\n' +
          '🗣️ _Voice: "previous", "back", or "go back"_',
      },
    ],
    footer: 'Page 3 of 8 — use ◀️ ▶️ to navigate',
  },

  // ── Page 4: Playlist management ──────────────────────────────────────────
  {
    title: '📖 How Tiffany Works — 4/8: Playlist Management',
    color: 0xe67e22,
    fields: [
      {
        name: '🎵 `Tiffany now playing`',
        value:
          'Shows the **currently playing song** as a rich embed: title (linked to YouTube), ' +
          'duration, and its position in the queue (e.g. "Song 3 of 47"). ' +
          'During mood mode the mood style is shown in the footer.\n' +
          '🗣️ _Voice: "now playing"_',
      },
      {
        name: '📋 `Tiffany queue`  ·  `playlist`  ·  `list`',
        value:
          'Displays the full queue in a **paginated embed** (15 songs per page). ' +
          'The currently playing song is marked with ▶️. ' +
          'Navigate with ◀️ ▶️ reactions; the embed opens on the page that contains the current song. ' +
          'During mood mode the mood queue is shown instead.\n' +
          '🗣️ _Voice: "queue", "playlist", or "list"_',
      },
      {
        name: '🔀 `Tiffany shuffle`',
        value:
          'Shuffles the persistent playlist **right now** using the Fisher-Yates algorithm. ' +
          'The currently playing song is moved to the front so the audio stream is not ' +
          'interrupted — all subsequent songs play in a new random order. ' +
          'The playlist is also automatically shuffled and looped when the last song finishes.\n' +
          '🗣️ _Voice: "shuffle"_',
      },
      {
        name: '🗑️ `Tiffany remove current song`',
        value:
          'Permanently **removes the current song** from the persistent playlist and ' +
          'immediately skips to the next one. Use this to prune songs you no longer want.\n' +
          '🗣️ _Voice: "remove current song"_',
      },
      {
        name: '💥 `Tiffany clear playlist`  ·  `clear`',
        value:
          'Empties the **entire persistent playlist** after asking for confirmation ' +
          '(✅ to confirm, ❌ to cancel). If no response is given within the timeout the ' +
          'operation is cancelled automatically. Does not affect the mood queue.\n' +
          '🗣️ _Voice: "clear" or "clear playlist"_',
      },
    ],
    footer: 'Page 4 of 8 — use ◀️ ▶️ to navigate',
  },

  // ── Page 5: Volume ────────────────────────────────────────────────────────
  {
    title: '📖 How Tiffany Works — 5/8: Volume Control',
    color: 0x9b59b6,
    fields: [
      {
        name: '🔊 `Tiffany louder`',
        value:
          'Increases the playback volume by one step (default **+10%**). ' +
          'The maximum is 100%.\n' +
          '🗣️ _Voice: "louder"_',
      },
      {
        name: '🔉 `Tiffany softer`',
        value:
          'Decreases the playback volume by one step (default **−10%**). ' +
          'The minimum is 0%.\n' +
          '🗣️ _Voice: "softer"_',
      },
      {
        name: '🤫 `Tiffany whisper`',
        value:
          'Sets the volume to the configured **background level** (default **10%**) — ' +
          'perfect for background music while you\'re talking.\n' +
          '🗣️ _Voice: "whisper"_',
      },
      {
        name: '🔈 `Tiffany volume {0–100}`',
        value:
          'Sets an **exact volume percentage**, e.g. `Tiffany volume 65` or `Tiffany volume 65%`. ' +
          'Useful when the step-based commands feel too coarse.\n' +
          '🗣️ _Voice: "volume {number}" or "volume {number} percent"_',
      },
      {
        name: '⚙️ Volume persistence',
        value:
          'Volume is stored **per server session**. The default starting volume and step size ' +
          'are set in the `.env` file via `DEFAULT_VOLUME`, ' +
          '`VOLUME_STEP`, and `WHISPER_VOLUME`. Volume resets to the default when the bot ' +
          'restarts or rejoins a voice channel.',
      },
    ],
    footer: 'Page 5 of 8 — use ◀️ ▶️ to navigate',
  },

  // ── Page 6: Song Rating ───────────────────────────────────────────────────
  {
    title: '📖 How Tiffany Works — 6/8: Song Rating & Favourites',
    color: 0xe91e63,
    fields: [
      {
        name: '❤️ `Tiffany like` · `love` · `favourite`',
        value:
          'Gives a thumbs-up to the currently playing song. Your vote is stored ' +
          'persistently in `data/ratings.json`.\n' +
          '🗣️ _Voice: "like", "love", or "favourite"_',
      },
      {
        name: '👎 `Tiffany dislike` · `hate`',
        value:
          'Gives a thumbs-down. If the majority of listeners currently in the voice channel ' +
          'dislike the song (more dislikes than likes), **the song is auto-skipped**.\n' +
          '🗣️ _Voice: "dislike" or "hate"_',
      },
      {
        name: '📊 `Tiffany rating`',
        value:
          'Shows the current like/dislike count for the playing song.\n' +
          '🗣️ _Voice: "rating"_',
      },
      {
        name: '⚖️ Majority rules',
        value:
          'Only votes from members **currently in the voice channel** count toward the auto-skip decision. ' +
          'If one person dislikes a song but two others have liked it, the song keeps playing. ' +
          'The majority must agree for a song to be skipped.',
      },
    ],
    footer: 'Page 6 of 8 — use ◀️ ▶️ to navigate',
  },

  // ── Page 7: Personal Assistant ────────────────────────────────────────────
  {
    title: '📖 How Tiffany Works — 7/8: Personal Assistant',
    color: 0xf39c12,
    fields: [
      {
        name: '⏰ `Tiffany remind me in {time} to {task}`',
        value:
          'Sets a timed reminder. When the time elapses, you get pinged in the channel.\n' +
          'Supported durations: "20 minutes", "1 hour", "30 seconds", "1h30m".\n' +
          'Maximum reminder duration is **24 hours**.\n' +
          '🗣️ _Voice: "remind me in twenty minutes to check the oven"_',
      },
      {
        name: '🎲 `Tiffany roll {dice}`',
        value:
          'Roll dice using standard tabletop notation:\n' +
          '• `Tiffany roll 2d6` — Roll two six-sided dice\n' +
          '• `Tiffany roll 1d20+5` — Roll a d20 with a +5 modifier\n' +
          '• `Tiffany roll d12` — Roll a single twelve-sided die\n' +
          '🗣️ _Voice: "roll two d six"_',
      },
      {
        name: '📊 `Tiffany poll "Question" "Opt1" "Opt2"`',
        value:
          'Creates a reaction-based poll. Three formats:\n' +
          '• **Quoted:** `Tiffany poll "Pizza or Burgers?" "Pizza" "Burgers"`\n' +
          '• **Pipe-separated:** `Tiffany poll Best genre | Rock | Jazz | Pop`\n' +
          '• **Yes/No:** `Tiffany poll Should we play jazz?`\n' +
          'Up to **10 options** supported. Results are visible via reaction counts.\n' +
          '🗣️ _Voice: "poll should we play jazz"_',
      },
    ],
    footer: 'Page 7 of 8 — use ◀️ ▶️ to navigate',
  },

  // ── Page 8: Behind the scenes ─────────────────────────────────────────────
  {
    title: '📖 How Tiffany Works — 8/8: Behind the Scenes',
    color: 0x1abc9c,
    fields: [
      {
        name: '💾 Persistent playlist',
        value:
          'The playlist is saved to **`data/playlist.json`** on disk after every change. ' +
          'Each entry stores the song title, YouTube URL, video ID, duration, and the time ' +
          'it was added. The file survives restarts — the bot picks up exactly where it left off.',
      },
      {
        name: '🎵 Audio streaming',
        value:
          'Songs are streamed **directly from YouTube** using `yt-dlp` (with `play-dl` as fallback) ' +
          'without downloading to disk. Audio is encoded with the Opus codec and sent over an ' +
          'encrypted voice connection. If a stream is interrupted the song is skipped automatically.',
      },
      {
        name: '🎙️ Voice recognition',
        value:
          'Speech is processed locally using **Vosk** — fully offline, no API keys, no cost. ' +
          'Each speaker is tracked individually (speaker diarisation). ' +
          'Commands must meet a **confidence threshold** (45%) to be acted upon, reducing false positives. ' +
          'The "Hey Tiffany" **wake word** lets you address the bot naturally.',
      },
      {
        name: '🔇 Text-to-speech (TTS)',
        value:
          'When addressed by name in a voice channel, Tiffany responds with a spoken ' +
          '"Yes?" using the system\'s TTS engine (Windows SAPI, macOS `say`, or Linux `espeak`). ' +
          'The TTS voice and language are configurable via the `TTS_VOICE` setting.',
      },
      {
        name: '🚨 Error handling',
        value:
          'Tiffany **never crashes silently**. Every unhandled error is logged to the ' +
          'configured Discord channel (set `LOG_CHANNEL_ID` in `.env`). ' +
          'Errors include the full stack trace so problems are easy to diagnose.',
      },
      {
        name: '⚙️ Configuration',
        value:
          'All settings (token, log channel, volume, TTS voice, etc.) are managed via a `.env` file. ' +
          'See `requirements.md` for the full deployment guide and all available environment variables.',
      },
    ],
    footer: 'Page 8 of 8 — use ◀️ ▶️ to navigate',
  },
];

// ─── Command ──────────────────────────────────────────────────────────────

/**
 * Tiffany explain how you work
 * Displays a rich, paginated explanation of every command and how the bot
 * functions internally. Navigate pages with ◀️ ▶️ reactions.
 */
module.exports = {
  name: 'explain',
  /** Matches "explain how you work", "explain how you works", and bare "explain" */
  patterns: [/^explain(\s+how\s+(you\s+)?works?)?$/i],
  voicePatterns: [/\bexplain(\s+how\s+(you\s+)?works?)?\b/i],

  async execute({ message }) {
    let page = 0;

    const buildEmbed = (p) => {
      const def = PAGES[p];
      const embed = new EmbedBuilder()
        .setColor(def.color)
        .setTitle(def.title)
        .setFooter({ text: def.footer });
      for (const field of def.fields) {
        embed.addFields({ name: field.name, value: field.value });
      }
      return embed;
    };

    // Send as a DM so the explanation doesn't clutter the channel or get
    // pushed away when Tiffany posts the next now-playing message.
    let dmChannel;
    try {
      dmChannel = await message.author.createDM();
    } catch {
      // DMs may be disabled – fall back to the channel
      dmChannel = null;
    }

    const target = dmChannel || message.channel;
    const msg = await target.send({ embeds: [buildEmbed(page)] });

    // Let the user know it was sent as a DM (only when DM succeeded)
    if (dmChannel && message.channel.id !== dmChannel.id) {
      await message.channel
        .send('📬 Check your DMs — I sent you a detailed explanation!')
        .catch(() => {});
    }

    // Add navigation reactions
    await msg.react('◀️').catch(() => {});
    await msg.react('▶️').catch(() => {});

    const collector = msg.createReactionCollector({
      filter: (r, u) =>
        ['◀️', '▶️'].includes(r.emoji.name) && u.id === message.author.id,
      time: 120_000, // 2 minutes to read through all 6 pages
    });

    collector.on('collect', async (reaction, user) => {
      reaction.users.remove(user).catch(() => {});
      if (reaction.emoji.name === '▶️') page = Math.min(page + 1, PAGES.length - 1);
      else page = Math.max(page - 1, 0);
      await msg.edit({ embeds: [buildEmbed(page)] }).catch(() => {});
    });

    collector.on('end', () => msg.reactions.removeAll().catch(() => {}));
  },
};
