'use strict';

const player = require('../player');
const logger = require('../logger');
const { deleteAfter } = require('../utils');
const config = require('../config');

const VOLUME_EMOJIS = {
  louder: '🔊',
  softer: '🔉',
  whisper: '🤫',
};

/**
 * Volume control commands:
 *   Tiffany louder        – increase volume by one step
 *   Tiffany softer        – decrease volume by one step
 *   Tiffany whisper       – set to background (whisper) volume
 *   Tiffany volume {0-100} – set an exact volume percentage
 */
module.exports = {
  name: 'volume',
  /** Text triggers – keyword variant and numeric variant */
  patterns: [/^(louder|softer|whisper)$/i, /^volume\s+(\d{1,3})%?$/i],
  /** Voice triggers */
  voicePatterns: [/\b(louder|softer|whisper)\b/i, /\bvolume\s+(\d{1,3})(?:\s*percent)?\b/i],

  /**
   * @param {{ message: import('discord.js').Message, guildId: string, match: RegExpMatchArray }} ctx
   */
  async execute({ message, guildId, match }) {
    const state = player.getState(guildId);
    if (!state) {
      return message.reply("I'm not connected to a voice channel. Use **Tiffany summon** first.");
    }

    // Numeric variant: "volume 75" or "volume 75%"
    const numericValue = match[1] !== undefined ? parseInt(match[1], 10) : NaN;
    if (!isNaN(numericValue) && !/^(louder|softer|whisper)$/i.test(match[1] || '')) {
      const pct = Math.min(100, Math.max(0, numericValue));
      player.setVolume(guildId, pct / 100);
      deleteAfter(await message.reply(`🔈 Volume set to **${pct}%**.`));
      logger.info(`Volume set to ${pct}% in guild ${guildId} (numeric command)`);
      return;
    }

    // Keyword variant
    const command = (match[1] || '').toLowerCase();
    let newVolume;

    switch (command) {
      case 'louder':
        newVolume = Math.min(1.0, state.volume + config.volumeStep);
        break;
      case 'softer':
        newVolume = Math.max(0.0, state.volume - config.volumeStep);
        break;
      case 'whisper':
        newVolume = config.whisperVolume;
        break;
      default:
        return message.reply('Unknown volume command.');
    }

    player.setVolume(guildId, newVolume);
    const pct = Math.round(newVolume * 100);
    const emoji = VOLUME_EMOJIS[command] || '🔈';

    deleteAfter(await message.reply(`${emoji} Volume set to **${pct}%**.`));
    logger.info(`Volume set to ${pct}% in guild ${guildId} via "${command}" command`);
  },
};
