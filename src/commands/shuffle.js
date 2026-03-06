'use strict';

const player = require('../player');
const playlist = require('../playlist');
const logger = require('../logger');
const { deleteAfter } = require('../utils');

/**
 * Tiffany shuffle
 * Shuffles the persistent playlist on demand.
 * The currently playing song is placed at the front so the stream is not
 * interrupted – all subsequent songs play in a new random order.
 * Does not affect the mood queue.
 */
module.exports = {
  name: 'shuffle',
  patterns: [/^shuffle$/i],
  voicePatterns: [/\bshuffle\b/i],

  async execute({ message, guildId }) {
    const state = player.getState(guildId);

    if (state?.moodMode) {
      return message.reply(
        "I'm in mood mode right now – shuffle applies only to the regular playlist."
      );
    }

    if (playlist.isEmpty()) {
      return message.reply(
        'The playlist is empty. Add songs with **Tiffany find** or **Tiffany play {url}**.'
      );
    }

    playlist.shuffle();
    const current = playlist.current;
    deleteAfter(await message.reply(
      `🔀 Playlist shuffled! Currently playing **${current?.title ?? 'nothing'}** — next songs are randomised.`
    ));
    logger.info(`Playlist shuffled in guild ${guildId}`);
  },
};
