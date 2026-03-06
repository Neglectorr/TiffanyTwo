'use strict';

const player = require('../player');
const playlist = require('../playlist');
const logger = require('../logger');
const { deleteAfter } = require('../utils');

/**
 * Tiffany remove current song
 * Removes the currently playing song from the playlist and skips it.
 */
module.exports = {
  name: 'remove',
  /** Text triggers */
  patterns: [/^remove(\s+current(\s+song)?)?$/i],
  /** Voice triggers */
  voicePatterns: [/\bremove(\s+current(\s+song)?)?\b/i],

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

    const removed = playlist.removeCurrent();
    if (!removed) {
      return message.reply('Could not remove the current song.');
    }

    player.skip(guildId);
    deleteAfter(await message.reply(`🗑️ Removed **${removed.title}** from the playlist and skipped it.`));
    logger.info(`Removed song "${removed.title}" from playlist in guild ${guildId}`);
  },
};
