'use strict';

const playlist = require('../playlist');
const player = require('../player');
const { deleteAfter } = require('../utils');

module.exports = {
  name: 'save-track',
  patterns: [/^(?:save\s+track|save\s+(?:this\s+)?song)$/i],
  voicePatterns: [/\b(?:save\s+track|save\s+(?:this\s+)?song)\b/i],

  async execute({ message, guildId }) {
    const state = player.getState(guildId);
    if (!state?.moodMode) {
      return message.reply('❌ `save track` works while a vibe or mood track is playing.');
    }

    const song = state.moodQueue[state.moodIndex];
    if (!song) {
      return message.reply('❌ No vibe track is currently playing.');
    }

    if (playlist.has(song.id)) {
      const result = playlist.moveToNext(song.id);
      if (result?.alreadyCurrent) {
        return deleteAfter(await message.channel.send(`▶️ **${song.title}** is already the current song in the regular playlist.`));
      }
      return deleteAfter(await message.channel.send(`⏭️ Saved **${song.title}** is already in the regular playlist and will play next there.`));
    }

    playlist.add(song);
    return deleteAfter(await message.channel.send(`💾 Saved **${song.title}** to the regular playlist. It will play next when vibe mode ends.`));
  },
};
