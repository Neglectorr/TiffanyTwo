'use strict';

const { EmbedBuilder, ComponentType } = require('discord.js');
const play = require('play-dl');
const playlist = require('../playlist');
const player = require('../player');
const logger = require('../logger');
const config = require('../config');
const { deleteAfter } = require('../utils');

/** Number emojis for reaction navigation */
const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

/**
 * Pending search sessions keyed by userId.
 * Allows voice "I choose {number}" to reference the latest search.
 * @type {Map<string, import('play-dl').YouTubeVideo[]>}
 */
const pendingSearches = new Map();

/**
 * Tiffany find {songname}
 * Searches YouTube and presents up to 5 results with numbered reaction navigation.
 */
module.exports = {
  name: 'find',
  /** Text triggers – captures everything after "find" */
  patterns: [/^find\s+(.+)$/i],
  /** Voice triggers – captures everything after "find" */
  voicePatterns: [/\bfind\s+(.+)/i],
  /** Voice triggers for selecting a result: "i choose 3" */
  choicePatterns: [/\bi\s+choose\s+(\d+)\b/i],

  /**
   * @param {{ message: import('discord.js').Message, guildId: string, match: RegExpMatchArray }} ctx
   */
  async execute({ message, guildId, match }) {
    const query = match[1].trim();
    if (!query) return message.reply('Please provide a song name to search for.');

    await message.channel.sendTyping().catch(() => {});

    let results;
    try {
      results = await play.search(query, {
        source: { youtube: 'video' },
        limit: config.findResultsCount,
      });
    } catch (err) {
      logger.error(`YouTube search failed for query "${query}"`, err);
      return message.reply('❌ YouTube search failed. Please try again later.');
    }

    if (!results || results.length === 0) {
      return message.reply(`No YouTube results found for **${query}**.`);
    }

    // Store results for this user so voice "I choose N" works
    pendingSearches.set(message.author.id, results);
    setTimeout(() => pendingSearches.delete(message.author.id), config.reactionTimeout);

    const embed = buildResultsEmbed(query, results);
    const msg = await message.channel.send({ embeds: [embed] });

    // Add number reactions
    const reactionCount = Math.min(results.length, NUMBER_EMOJIS.length);
    for (let i = 0; i < reactionCount; i++) {
      await msg.react(NUMBER_EMOJIS[i]).catch(() => {});
    }

    // Wait for a reaction from the same user; clean up after messageDeleteDelay
    const filter = (reaction, user) => {
      return (
        NUMBER_EMOJIS.includes(reaction.emoji.name) &&
        user.id === message.author.id
      );
    };

    const collector = msg.createReactionCollector({
      filter,
      max: 1,
      time: config.messageDeleteDelay,
    });

    // Schedule deletion; cancel early if the collector collects a reaction
    const cancelDelete = deleteAfter(msg);

    collector.on('collect', async (reaction, user) => {
      cancelDelete();
      msg.delete().catch(() => {});
      const index = NUMBER_EMOJIS.indexOf(reaction.emoji.name);
      if (index === -1 || index >= results.length) return;
      await queueResult(results[index], guildId, message.channel, message.member?.voice?.channel);
    });

    collector.on('end', () => {
      msg.delete().catch(() => {});
    });
  },

  /**
   * Handle voice "I choose {number}" after a pending search.
   * @param {{ message: import('discord.js').Message, guildId: string, match: RegExpMatchArray }} ctx
   */
  async handleChoice({ message, guildId, match }) {
    const number = parseInt(match[1], 10);
    const results = pendingSearches.get(message.author.id);

    if (!results || results.length === 0) {
      return message.reply('No pending search results. Use **Tiffany find {song}** first.');
    }

    const index = number - 1;
    if (index < 0 || index >= results.length) {
      return message.reply(
        `Please choose a number between 1 and ${results.length}.`
      );
    }

    pendingSearches.delete(message.author.id);
    await queueResult(results[index], guildId, message.channel, message.member?.voice?.channel);
  },

  /** Expose pending searches for voice handler */
  pendingSearches,
};

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Add a search result to the playlist and start playback if needed.
 * @param {import('play-dl').YouTubeVideo} video
 * @param {string} guildId
 * @param {import('discord.js').TextChannel} textChannel
 * @param {import('discord.js').VoiceChannel|null} voiceChannel
 */
async function queueResult(video, guildId, textChannel, voiceChannel) {
  const song = {
    id: video.id,
    url: video.url,
    title: video.title || 'Unknown title',
    duration: formatDuration(video.durationInSec),
  };

  if (playlist.has(song.id)) {
    // Song already in playlist — move it to play next instead of ignoring
    const result = playlist.moveToNext(song.id);
    if (result?.alreadyCurrent) {
      deleteAfter(await textChannel.send(`▶️ **${song.title}** is already playing.`));
    } else {
      deleteAfter(await textChannel.send(`⏭️ **${song.title}** is already in the playlist and will play next.`));
    }
    return;
  }

  playlist.add(song);
  deleteAfter(await textChannel.send(`✅ Added **${song.title}** (${song.duration}) to the playlist.`));
  logger.info(`Queued song: ${song.title} (${song.url})`);

  // If not yet connected, try to join the requester's voice channel
  if (voiceChannel && !player.getState(guildId)) {
    await player.join(voiceChannel, textChannel);
  }

  // Start playback if idle
  await player.startIfIdle(guildId);
}

/**
 * Build an embed listing search results.
 * @param {string} query
 * @param {import('play-dl').YouTubeVideo[]} results
 * @returns {EmbedBuilder}
 */
function buildResultsEmbed(query, results) {
  const description = results
    .map((v, i) => {
      const duration = formatDuration(v.durationInSec);
      return `${NUMBER_EMOJIS[i]} **${v.title}** — ${duration}`;
    })
    .join('\n');

  return new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle(`🔍 Search results for "${query}"`)
    .setDescription(description)
    .setFooter({ text: 'React with the number to queue a song' });
}

/**
 * Convert seconds to mm:ss or h:mm:ss string.
 * @param {number} seconds
 * @returns {string}
 */
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '?:??';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}
