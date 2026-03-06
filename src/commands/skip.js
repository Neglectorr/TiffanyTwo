'use strict';

const player = require('../player');
const playlist = require('../playlist');
const logger = require('../logger');
const { deleteAfter } = require('../utils');

/**
 * Tiffany skip this song
 * Skips the currently playing song without removing it from the playlist.
 */
module.exports = {
  name: 'skip',
  /** Text triggers */
  patterns: [/^skip(\s+(this\s+)?song)?$/i],
  /** Voice triggers */
  voicePatterns: [/\bskip(\s+(this\s+)?song)?\b/i],

  /**
   * @param {{ message: import('discord.js').Message, guildId: string }} ctx
   */
  async execute({ message, guildId }) {
    const state = player.getState(guildId);
    if (!state) {
      return message.reply("I'm not connected to a voice channel. Use **Tiffany summon** first.");
    }

    const current = playlist.current;
    if (!current) {
      return message.reply('There is nothing playing right now.');
    }

    player.skip(guildId);
    deleteAfter(await message.reply(`⏭️ Skipped **${current.title}**.`));
    logger.info(`Skipped song "${current.title}" in guild ${guildId}`);
  },
};
