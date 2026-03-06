'use strict';

const player = require('../player');
const playlist = require('../playlist');
const logger = require('../logger');
const { deleteAfter } = require('../utils');

/**
 * Tiffany previous  |  Tiffany back
 * Goes back to the previous song and replays it from the start.
 * Works for both the persistent playlist and the mood queue.
 */
module.exports = {
  name: 'previous',
  patterns: [/^(previous|back|prev)$/i],
  voicePatterns: [/\b(previous|back|go back)\b/i],

  async execute({ message, guildId }) {
    const state = player.getState(guildId);
    if (!state) {
      return message.reply("I'm not connected to a voice channel. Use **Tiffany summon** first.");
    }

    const isMood = state.moodMode;

    if (!isMood && playlist.isEmpty()) {
      return message.reply('The playlist is empty.');
    }

    if (isMood && state.moodQueue.length === 0) {
      return message.reply('The mood queue is empty.');
    }

    await player.previous(guildId);

    const song = isMood
      ? state.moodQueue[state.moodIndex]
      : playlist.current;

    deleteAfter(await message.reply(`⏮️ Going back to **${song?.title ?? 'previous song'}**.`));
    logger.info(`Previous song in guild ${guildId}: ${song?.title}`);
  },
};
