'use strict';

const { EmbedBuilder } = require('discord.js');
const play = require('play-dl');
const player = require('../player');
const playlist = require('../playlist');
const logger = require('../logger');
const config = require('../config');
const { deleteAfter } = require('../utils');

const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣'];

/**
 * Tiffany i am in the mood for {style}
 * Searches YouTube for playlists matching the style, lets the user pick one
 * with reaction navigation, and plays it as a temporary queue that does not
 * touch the persistent playlist.
 * When the mood queue ends the bot asks whether to play another or resume
 * the regular playlist.
 */
module.exports = {
  name: 'mood',
  patterns: [
    /^(?:i(?:'m| am) in the mood for|mood|vibe|set the vibe to)\s+(.+)$/i,
  ],
  voicePatterns: [
    /\b(?:i(?:'m| am) in the mood for|mood|vibe|set the vibe to)\s+(.+)/i,
  ],

  async execute({ message, guildId, match }) {
    const style = match[1].trim();

    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel && !player.getState(guildId)) {
      return message.reply(
        "You need to be in a voice channel! Use **Tiffany summon** first."
      );
    }

    await message.channel.sendTyping().catch(() => {});
    await runMoodSearch(style, guildId, message.channel, voiceChannel, message.author.id);
  },
};

// ─── Helpers (shared with the mood-end callback) ──────────────────────────

/**
 * Search YouTube for playlists matching `style`, show results, and start playback.
 * @param {string} style
 * @param {string} guildId
 * @param {import('discord.js').TextChannel} textChannel
 * @param {import('discord.js').VoiceChannel|null} voiceChannel
 * @param {string|null} requesterId  Discord user ID for reaction filter (null = any user)
 */
async function runMoodSearch(style, guildId, textChannel, voiceChannel, requesterId) {
  let playlists;
  try {
    playlists = await play.search(`${style} music playlist`, {
      source: { youtube: 'playlist' },
      limit: 3,
    });
  } catch (err) {
    logger.warn(`Mood playlist search failed for "${style}", trying fallback mix search: ${err.message}`);
  }

  if (playlists && playlists.length > 0) {
    const embed = buildPlaylistEmbed(style, playlists);
    const msg = await textChannel.send({ embeds: [embed] });

    const reactionCount = Math.min(playlists.length, NUMBER_EMOJIS.length);
    for (let i = 0; i < reactionCount; i++) {
      await msg.react(NUMBER_EMOJIS[i]).catch(() => {});
    }

    const filter = (r, u) =>
      NUMBER_EMOJIS.slice(0, playlists.length).includes(r.emoji.name) &&
      !u.bot &&
      (!requesterId || u.id === requesterId);

    const collector = msg.createReactionCollector({
      filter,
      max: 1,
      time: config.messageDeleteDelay,
    });

    const cancelDelete = deleteAfter(msg);

    collector.on('collect', async (reaction) => {
      cancelDelete();
      msg.delete().catch(() => {});
      const index = NUMBER_EMOJIS.indexOf(reaction.emoji.name);
      await loadAndPlay(playlists[index], style, guildId, textChannel, voiceChannel);
    });

    collector.on('end', (collected) => {
      if (collected.size === 0) {
        msg.delete().catch(() => {});
        textChannel
          .send('⏰ No response – mood mode cancelled.')
          .then((m) => deleteAfter(m))
          .catch(() => {});
      }
    });
    return;
  }

  let videos;
  try {
    videos = await play.search(`${style} music mix`, {
      source: { youtube: 'video' },
      limit: 10,
    });
  } catch (err) {
    logger.error(`Mood fallback search failed for "${style}"`, err);
    return textChannel.send('❌ YouTube search failed. Please try again later.');
  }

  const songs = (videos || [])
    .filter((video) => video?.id && video?.url)
    .map((video) => ({
      id: video.id,
      url: video.url,
      title: video.title || 'Unknown title',
      duration: formatDuration(video.durationInSec),
    }));

  if (songs.length === 0) {
    return textChannel.send(
      `No playlists or tracks found for **${style}**. Try a different style.`
    );
  }

  if (voiceChannel && !player.getState(guildId)) {
    await player.join(voiceChannel, textChannel);
  }

  const onMoodEnd = buildMoodEndCallback(style, guildId, textChannel, voiceChannel);
  player.startMoodMode(guildId, songs, style, onMoodEnd);

  await textChannel.send(
    `🎶 I couldn't find a playlist for **${style}**, so I started a vibe mix from YouTube search results (${songs.length} tracks).`
  );
  logger.info(
    `Mood fallback started in guild ${guildId}: style="${style}", songs=${songs.length}`
  );
}

/**
 * Fetch all videos from the selected playlist and start mood playback.
 */
async function loadAndPlay(playlistInfo, style, guildId, textChannel, voiceChannel) {
  const loadingMsg = await textChannel.send(`⏳ Loading **${playlistInfo.title}**…`).catch(() => null);

  let videos;
  try {
    const full = await play.playlist_info(playlistInfo.url, { incomplete: true });
    await full.fetch();
    videos = full.videos || [];
  } catch (err) {
    logger.error('Failed to fetch mood playlist', err);
    loadingMsg?.delete().catch(() => {});
    return textChannel.send(
      '❌ Could not load that playlist. It may be private or unavailable. Try another one.'
    );
  }

  // Loading is done — remove the loading message
  loadingMsg?.delete().catch(() => {});

  if (videos.length === 0) {
    return textChannel.send('❌ That playlist appears to be empty or private.');
  }

  const songs = videos.map((v) => ({
    id: v.id,
    url: v.url,
    title: v.title || 'Unknown title',
    duration: formatDuration(v.durationInSec),
  }));

  if (voiceChannel && !player.getState(guildId)) {
    await player.join(voiceChannel, textChannel);
  }

  const onMoodEnd = buildMoodEndCallback(style, guildId, textChannel, voiceChannel);
  player.startMoodMode(guildId, songs, style, onMoodEnd);

  await textChannel.send(
    `🎶 Entering mood mode: **${style}** — **${playlistInfo.title}** (${songs.length} songs)\n` +
      `_When this playlist ends I'll ask what you'd like to do next._`
  );
  logger.info(
    `Mood mode started in guild ${guildId}: style="${style}", playlist="${playlistInfo.title}", songs=${songs.length}`
  );
}

/**
 * Build the async callback fired when the mood queue finishes.
 */
function buildMoodEndCallback(style, guildId, textChannel, voiceChannel) {
  return async () => {
    try {
      const msg = await textChannel.send(
        `🎶 The **${style}** mood playlist has ended!\n` +
          `🔄 — Play **another** ${style} playlist\n` +
          `▶️ — Resume the **regular playlist**`
      );
      await msg.react('🔄').catch(() => {});
      await msg.react('▶️').catch(() => {});

      const collector = msg.createReactionCollector({
        filter: (r, u) => ['🔄', '▶️'].includes(r.emoji.name) && !u.bot,
        max: 1,
        time: config.messageDeleteDelay,
      });

      const cancelDelete = deleteAfter(msg);

      collector.on('collect', async (reaction) => {
        cancelDelete();
        msg.delete().catch(() => {});
        if (reaction.emoji.name === '🔄') {
          deleteAfter(await textChannel.send(`🔍 Finding another **${style}** playlist…`));
          await runMoodSearch(style, guildId, textChannel, voiceChannel, null);
        } else {
          player.exitMoodMode(guildId);
          if (!playlist.isEmpty()) {
            deleteAfter(await textChannel.send('▶️ Resuming the regular playlist…'));
            await player.startIfIdle(guildId);
          } else {
            deleteAfter(await textChannel.send(
              "The regular playlist is empty. Use **Tiffany find** to add songs!"
            ));
          }
        }
      });

      collector.on('end', (collected) => {
        if (collected.size === 0) {
          msg.delete().catch(() => {});
          // Timeout: resume regular playlist automatically
          player.exitMoodMode(guildId);
          if (!playlist.isEmpty()) {
            player.startIfIdle(guildId).catch(() => {});
            textChannel
              .send('⏰ No response – resuming the regular playlist.')
              .then((m) => deleteAfter(m))
              .catch(() => {});
          }
        }
      });
    } catch (err) {
      logger.error('Mood end callback failed', err);
    }
  };
}

function buildPlaylistEmbed(style, playlists) {
  const lines = playlists.map((p, i) => {
    const count = p.total_videos ? ` — ${p.total_videos} videos` : '';
    return `${NUMBER_EMOJIS[i]} **${p.title}**${count}`;
  });
  return new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`🎶 Playlists for "${style}"`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'React with a number to start that playlist' });
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '?:??';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
