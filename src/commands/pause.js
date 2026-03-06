'use strict';

const player = require('../player');
const playlist = require('../playlist');
const logger = require('../logger');
const { deleteAfter } = require('../utils');
const { AudioPlayerStatus } = require('@discordjs/voice');

/**
 * Tiffany pause
 * Pauses the currently playing song mid-stream.
 * Use "Tiffany resume" to continue from the same position.
 */
module.exports = {
  name: 'pause',
  /** Text triggers */
  patterns: [/^pause$/i],
  /** Voice triggers */
  voicePatterns: [/\bpause\b/i],

  /**
   * @param {{ message: import('discord.js').Message, guildId: string }} ctx
   */
  async execute({ message, guildId }) {
    const state = player.getState(guildId);
    if (!state) {
      return message.reply("I'm not connected to a voice channel. Use **Tiffany summon** first.");
    }

    const status = state.player.state.status;

    if (status === AudioPlayerStatus.Paused || status === AudioPlayerStatus.AutoPaused) {
      return message.reply('Already paused. Use **Tiffany resume** to continue.');
    }

    if (status !== AudioPlayerStatus.Playing && status !== AudioPlayerStatus.Buffering) {
      return message.reply('Nothing is playing right now.');
    }

    const success = player.pause(guildId);
    if (!success) {
      return message.reply('❌ Could not pause playback at this time.');
    }

    const current = playlist.current;
    deleteAfter(await message.reply(`⏸️ Paused **${current?.title ?? 'current song'}**. Use **Tiffany resume** to continue.`));
    logger.info(`Playback paused in guild ${guildId}`);
  },
};
