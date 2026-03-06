'use strict';

const player = require('../player');
const playlist = require('../playlist');
const logger = require('../logger');
const config = require('../config');
const { deleteAfter } = require('../utils');

/**
 * Tiffany clear playlist  |  Tiffany clear
 * Removes all songs from the persistent playlist after a confirmation reaction.
 * Does not affect the mood queue.
 */
module.exports = {
  name: 'clear',
  patterns: [/^clear(\s+playlist)?$/i],
  voicePatterns: [/\bclear(\s+playlist)?\b/i],

  async execute({ message, guildId }) {
    if (playlist.isEmpty()) {
      return message.reply('The playlist is already empty.');
    }

    const count = playlist.length;
    const confirm = await message.reply(
      `⚠️ This will remove all **${count}** songs from the persistent playlist.\n✅ Confirm  |  ❌ Cancel`
    );

    await confirm.react('✅').catch(() => {});
    await confirm.react('❌').catch(() => {});

    const collector = confirm.createReactionCollector({
      filter: (r, u) => ['✅', '❌'].includes(r.emoji.name) && u.id === message.author.id,
      max: 1,
      time: config.messageDeleteDelay,
    });

    const cancelDelete = deleteAfter(confirm);

    collector.on('collect', async (reaction) => {
      cancelDelete();
      confirm.delete().catch(() => {});
      if (reaction.emoji.name === '✅') {
        const state = player.getState(guildId);
        if (state && !state.moodMode) {
          player.stop(guildId);
        }
        playlist.clear();
        deleteAfter(await message.channel.send(`🗑️ Cleared ${count} songs from the playlist.`));
        logger.info(`Playlist cleared in guild ${guildId} (${count} songs removed)`);
      } else {
        deleteAfter(await message.channel.send('❌ Clear cancelled.'));
      }
    });

    collector.on('end', (collected) => {
      if (collected.size === 0) {
        confirm.delete().catch(() => {});
        message.channel
          .send('⏰ No response – clear cancelled.')
          .then((m) => deleteAfter(m))
          .catch(() => {});
      }
    });
  },
};
