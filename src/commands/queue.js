'use strict';

const { EmbedBuilder } = require('discord.js');
const player = require('../player');
const playlist = require('../playlist');
const config = require('../config');

const PAGE_SIZE = 15;

/**
 * Tiffany queue  |  Tiffany playlist  |  Tiffany list
 * Shows the current queue in a paginated embed (15 songs per page).
 * Displays the mood queue when mood mode is active.
 */
module.exports = {
  name: 'queue',
  patterns: [/^(queue|playlist|list)$/i],
  voicePatterns: [/\b(queue|playlist|list)\b/i],

  async execute({ message, guildId }) {
    const state = player.getState(guildId);
    const isMood = state?.moodMode;

    let songs, currentIndex, title, color;

    if (isMood) {
      songs = state.moodQueue;
      currentIndex = state.moodIndex;
      title = `🎶 Mood Queue — ${state.moodStyle}`;
      color = 0x9b59b6;
    } else {
      songs = playlist.songs;
      currentIndex = playlist.currentIndex;
      title = '🎵 Persistent Playlist';
      color = 0xff0000;
    }

    if (songs.length === 0) {
      return message.reply(
        isMood
          ? 'The mood queue is empty.'
          : 'The playlist is empty. Use **Tiffany find** or **Tiffany play {url}** to add songs.'
      );
    }

    const totalPages = Math.ceil(songs.length / PAGE_SIZE);
    let page = Math.floor(currentIndex / PAGE_SIZE); // open on the page containing the current song

    const buildEmbed = (p) => {
      const start = p * PAGE_SIZE;
      const end = Math.min(start + PAGE_SIZE, songs.length);
      const lines = songs.slice(start, end).map((s, i) => {
        const abs = start + i;
        const marker = abs === currentIndex ? '▶️' : `\`${abs + 1}.\``;
        return `${marker} **${s.title}** (${s.duration})`;
      });
      return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(lines.join('\n'))
        .setFooter({
          text: `Page ${p + 1} / ${totalPages}  ·  ${songs.length} song${songs.length !== 1 ? 's' : ''} total`,
        });
    };

    const msg = await message.channel.send({ embeds: [buildEmbed(page)] });

    if (totalPages <= 1) return;

    await msg.react('◀️').catch(() => {});
    await msg.react('▶️').catch(() => {});

    const collector = msg.createReactionCollector({
      filter: (r, u) =>
        ['◀️', '▶️'].includes(r.emoji.name) && u.id === message.author.id,
      time: 60_000,
    });

    collector.on('collect', async (reaction, user) => {
      reaction.users.remove(user).catch(() => {});
      if (reaction.emoji.name === '▶️') page = Math.min(page + 1, totalPages - 1);
      else page = Math.max(page - 1, 0);
      await msg.edit({ embeds: [buildEmbed(page)] }).catch(() => {});
    });

    collector.on('end', () => msg.reactions.removeAll().catch(() => {}));
  },
};
