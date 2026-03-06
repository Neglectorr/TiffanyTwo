'use strict';

const player = require('../player');
const logger = require('../logger');
const { deleteAfter } = require('../utils');

/**
 * Tiffany leave  |  Tiffany bye  |  Tiffany disconnect
 * Stops playback and leaves the voice channel.
 */
module.exports = {
  name: 'leave',
  patterns: [/^(leave|bye|disconnect)$/i],
  voicePatterns: [/\b(leave|bye|disconnect)\b/i],

  async execute({ message, guildId }) {
    const state = player.getState(guildId);

    if (!state) {
      return message.reply("I'm not in a voice channel right now.");
    }

    const channelName = state.connection?.joinConfig?.channelId
      ? (message.guild?.channels?.cache?.get(state.connection.joinConfig.channelId)?.name ?? 'the voice channel')
      : 'the voice channel';

    player.leave(guildId);
    deleteAfter(await message.reply(`👋 Left **${channelName}**. See you next time!`));
    logger.info(`Left voice channel in guild ${guildId}`);
  },
};
