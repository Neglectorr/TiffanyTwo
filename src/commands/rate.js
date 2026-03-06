'use strict';

const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../logger');
const playlist = require('../playlist');
const player = require('../player');

const RATINGS_FILE = path.join(config.dataDir, 'ratings.json');

/**
 * @typedef {Object} SongRating
 * @property {Set<string>} likes   - User IDs who liked
 * @property {Set<string>} dislikes - User IDs who disliked
 */

/**
 * In-memory ratings store.
 * Key: YouTube video ID, Value: { likes: string[], dislikes: string[] }
 * @type {Map<string, { likes: string[], dislikes: string[] }>}
 */
const ratings = new Map();

// Load ratings from disk
function loadRatings() {
  try {
    if (fs.existsSync(RATINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(RATINGS_FILE, 'utf8'));
      for (const [id, rating] of Object.entries(data)) {
        ratings.set(id, {
          likes: Array.isArray(rating.likes) ? rating.likes : [],
          dislikes: Array.isArray(rating.dislikes) ? rating.dislikes : [],
        });
      }
      logger.info(`Song ratings loaded: ${ratings.size} songs rated`);
    }
  } catch (err) {
    logger.error('Failed to load song ratings', err);
  }
}

function saveRatings() {
  try {
    fs.mkdirSync(path.dirname(RATINGS_FILE), { recursive: true });
    const obj = {};
    for (const [id, rating] of ratings) {
      obj[id] = { likes: rating.likes, dislikes: rating.dislikes };
    }
    fs.writeFileSync(RATINGS_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (err) {
    logger.error('Failed to save song ratings', err);
  }
}

loadRatings();

/**
 * Get or create rating entry for a song.
 * @param {string} songId
 * @returns {{ likes: string[], dislikes: string[] }}
 */
function getRating(songId) {
  if (!ratings.has(songId)) {
    ratings.set(songId, { likes: [], dislikes: [] });
  }
  return ratings.get(songId);
}

/**
 * Rate the currently playing song.
 * Majority rules: if more people dislike than like, the song is auto-skipped.
 *
 * Tiffany like / Tiffany dislike / Tiffany favourite / Tiffany rate
 */
module.exports = {
  name: 'rate',
  patterns: [
    /^(like|love|favourite|favorite)(?:\s+(?:this\s+)?(?:song|track))?$/i,
    /^(dislike|hate|thumbs?\s*down)(?:\s+(?:this\s+)?(?:song|track))?$/i,
    /^(rating|ratings|rate)(?:\s+(?:this\s+)?(?:song|track))?$/i,
  ],
  voicePatterns: [
    /\b(like|love|favourite|favorite)\b(?:\s+(?:this\s+)?(?:song|track))?/i,
    /\b(dislike|hate)\b(?:\s+(?:this\s+)?(?:song|track))?/i,
  ],

  async execute({ message, guildId, match }) {
    const state = player.getState(guildId);
    const song = state?.moodMode
      ? state.moodQueue[state.moodIndex]
      : playlist.current;

    if (!song) {
      return message.reply('❌ No song is currently playing.');
    }

    const action = match[1].toLowerCase();
    const userId = message.author.id;
    const rating = getRating(song.id);

    // Show rating if just asking
    if (action === 'rating' || action === 'ratings' || action === 'rate') {
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`📊 Rating for: ${song.title}`)
        .addFields(
          { name: '❤️ Likes', value: `${rating.likes.length}`, inline: true },
          { name: '👎 Dislikes', value: `${rating.dislikes.length}`, inline: true },
        )
        .setFooter({ text: 'Majority rules — if dislikes outnumber likes from present members, the song is skipped.' });
      return message.channel.send({ embeds: [embed] });
    }

    const isLike = ['like', 'love', 'favourite', 'favorite'].includes(action);
    const isDislike = action === 'dislike' || action === 'hate' || action.startsWith('thumbs') || action.startsWith('thumb');

    if (isLike) {
      // Remove from dislikes if present, add to likes
      rating.dislikes = rating.dislikes.filter((id) => id !== userId);
      if (!rating.likes.includes(userId)) {
        rating.likes.push(userId);
      }
      saveRatings();
      await message.reply(`❤️ You liked **${song.title}**! (${rating.likes.length} 👍 / ${rating.dislikes.length} 👎)`);
    } else if (isDislike) {
      // Remove from likes if present, add to dislikes
      rating.likes = rating.likes.filter((id) => id !== userId);
      if (!rating.dislikes.includes(userId)) {
        rating.dislikes.push(userId);
      }
      saveRatings();
      await message.reply(`👎 You disliked **${song.title}**. (${rating.likes.length} 👍 / ${rating.dislikes.length} 👎)`);

      // Majority rule: check voice channel members
      const voiceChannel = message.member?.voice?.channel;
      if (voiceChannel) {
        // Count human members in the voice channel
        const humanMembers = voiceChannel.members.filter((m) => !m.user.bot);
        const presentLikes = rating.likes.filter((id) => humanMembers.has(id)).length;
        const presentDislikes = rating.dislikes.filter((id) => humanMembers.has(id)).length;

        // Only auto-skip if dislikes strictly outnumber likes among present members
        if (presentDislikes > presentLikes && !state.moodMode) {
          await message.channel.send(
            `⏭️ Majority has spoken! Skipping **${song.title}** (${presentLikes} 👍 vs ${presentDislikes} 👎 from present members).`
          );
          player.skip(guildId);
        }
      }
    }
  },

  /**
   * Check if a song should be auto-skipped based on ratings of present members.
   * Called externally when a song starts playing.
   * @param {string} songId
   * @param {import('discord.js').VoiceChannel} voiceChannel
   * @returns {{ shouldSkip: boolean, likes: number, dislikes: number }}
   */
  checkMajority(songId, voiceChannel) {
    if (!voiceChannel) return { shouldSkip: false, likes: 0, dislikes: 0 };
    const rating = getRating(songId);
    const humanMembers = voiceChannel.members.filter((m) => !m.user.bot);
    const presentLikes = rating.likes.filter((id) => humanMembers.has(id)).length;
    const presentDislikes = rating.dislikes.filter((id) => humanMembers.has(id)).length;
    return {
      shouldSkip: presentDislikes > presentLikes && presentDislikes > 0,
      likes: presentLikes,
      dislikes: presentDislikes,
    };
  },

  // Exposed for testing
  _getRating: getRating,
  _ratings: ratings,
};
