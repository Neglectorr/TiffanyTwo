'use strict';

const player = require('../player');
const logger = require('../logger');
const { deleteAfter } = require('../utils');

/**
 * Tiffany summon
 * Joins the voice channel of the command issuer.
 */
module.exports = {
  name: 'summon',
  /** Text triggers: "tiffany summon" */
  patterns: [/^summon$/i],
  /** Voice triggers: "summon" or "tiffany summon" */
  voicePatterns: [/\bsummon\b/i],

  /**
   * @param {{ message: import('discord.js').Message, guildId: string }} ctx
   */
  async execute({ message }) {
    const member = message.member;
    const voiceChannel = member?.voice?.channel;

    if (!voiceChannel) {
      return message.reply('You need to be in a voice channel first!');
    }

    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions?.has('Connect') || !permissions?.has('Speak')) {
      return message.reply(
        "I don't have permission to join or speak in that voice channel."
      );
    }

    try {
      await player.join(voiceChannel, message.channel);
      deleteAfter(await message.reply(`👋 Joined **${voiceChannel.name}**!`));
      logger.info(`Joined voice channel ${voiceChannel.name} in guild ${voiceChannel.guild.id}`);
    } catch (err) {
      logger.error('Failed to join voice channel', err);
      deleteAfter(await message.reply('❌ Failed to join the voice channel.'));
    }
  },
};
