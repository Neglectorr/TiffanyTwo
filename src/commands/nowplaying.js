'use strict';

const { EmbedBuilder } = require('discord.js');
const player = require('../player');
const playlist = require('../playlist');

/**
 * Tiffany now playing
 * Shows the currently playing song, its position in the playlist,
 * and whether mood mode is active.
 */
module.exports = {
  name: 'nowplaying',
  patterns: [/^now\s*playing$/i],
  voicePatterns: [/\bnow\s*playing\b/i],

  async execute({ message, guildId }) {
    const state = player.getState(guildId);

    if (!state || (!state.playing && !state.stopped)) {
      return message.reply('Nothing is playing right now.');
    }

    const isMood = state.moodMode;
    const song = isMood
      ? state.moodQueue[state.moodIndex]
      : playlist.current;

    if (!song) {
      return message.reply('Nothing is playing right now.');
    }

    const statusEmoji = state.player.state.status === 'paused' ? '⏸️' : '▶️';
    const positionInfo = isMood
      ? `Song ${state.moodIndex + 1} of ${state.moodQueue.length} in mood queue`
      : `Song ${playlist.currentIndex + 1} of ${playlist.length} in playlist`;

    const embed = new EmbedBuilder()
      .setColor(isMood ? 0x9b59b6 : 0xff0000)
      .setTitle(`${statusEmoji} Now Playing`)
      .setDescription(`**[${song.title}](${song.url})**`)
      .addFields(
        { name: 'Duration', value: song.duration, inline: true },
        { name: 'Position', value: positionInfo, inline: true }
      );

    if (isMood) {
      embed.setFooter({ text: `🎶 Mood mode: ${state.moodStyle}` });
    }

    await message.channel.send({ embeds: [embed] });
  },
};
