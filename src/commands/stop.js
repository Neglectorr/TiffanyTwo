'use strict';

const player = require('../player');
const playlist = require('../playlist');
const logger = require('../logger');
const { deleteAfter } = require('../utils');
const { AudioPlayerStatus } = require('@discordjs/voice');

/**
 * Tiffany stop
 * Stops playback without advancing the playlist.
 * The current song is preserved so "Tiffany resume" will restart it.
 */
module.exports = {
  name: 'stop',
  /** Text triggers */
  patterns: [/^stop$/i],
  /** Voice triggers */
  voicePatterns: [/\bstop\b/i],

  /**
   * @param {{ message: import('discord.js').Message, guildId: string }} ctx
   */
  async execute({ message, guildId }) {
    const state = player.getState(guildId);
    if (!state) {
      return message.reply("I'm not connected to a voice channel. Use **Tiffany summon** first.");
    }

    const status = state.player.state.status;
    if (status === AudioPlayerStatus.Idle && !state.stopped) {
      return message.reply('Nothing is playing right now.');
    }

    player.stop(guildId);

    const current = playlist.current;
    deleteAfter(await message.reply(
      `⏹️ Stopped. Use **Tiffany resume** to continue playing${current ? ` **${current.title}**` : ''}.`
    ));
    logger.info(`Playback stopped in guild ${guildId}`);
  },
};
