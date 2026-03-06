'use strict';

const player = require('../player');
const playlist = require('../playlist');
const logger = require('../logger');
const { deleteAfter } = require('../utils');
const { AudioPlayerStatus } = require('@discordjs/voice');

/**
 * Tiffany resume
 * Resumes playback after a pause or stop.
 *   - After "Tiffany pause": unpauses in-place (stream continues from same position).
 *   - After "Tiffany stop": re-streams the current song from the beginning.
 */
module.exports = {
  name: 'resume',
  /** Text triggers */
  patterns: [/^resume$/i],
  /** Voice triggers */
  voicePatterns: [/\bresume\b/i],

  /**
   * @param {{ message: import('discord.js').Message, guildId: string }} ctx
   */
  async execute({ message, guildId }) {
    const state = player.getState(guildId);
    if (!state) {
      return message.reply("I'm not connected to a voice channel. Use **Tiffany summon** first.");
    }

    const status = state.player.state.status;
    const isStopped = state.stopped;

    if (
      status !== AudioPlayerStatus.Paused &&
      status !== AudioPlayerStatus.AutoPaused &&
      !isStopped
    ) {
      if (status === AudioPlayerStatus.Playing) {
        return message.reply('Already playing!');
      }
      return message.reply('Nothing to resume. Use **Tiffany play** to start the playlist.');
    }

    if (playlist.isEmpty()) {
      return message.reply(
        'The playlist is empty. Use **Tiffany find** or **Tiffany play {url}** to add songs first.'
      );
    }

    await player.resume(guildId);

    const current = playlist.current;
    const action = isStopped && status !== AudioPlayerStatus.Paused ? 'Restarting' : 'Resuming';
    deleteAfter(await message.reply(`▶️ ${action} **${current?.title ?? 'current song'}**.`));
    logger.info(`Playback resumed in guild ${guildId} (was ${isStopped ? 'stopped' : 'paused'})`);
  },
};
