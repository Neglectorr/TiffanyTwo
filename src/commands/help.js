'use strict';

const { EmbedBuilder } = require('discord.js');

/**
 * Tiffany help
 * Shows a rich embed listing every available command organised by category.
 */
module.exports = {
  name: 'help',
  patterns: [/^help$/i],
  voicePatterns: [/\bhelp\b/i],

  async execute({ message }) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🎵 Tiffany — Command Reference')
      .setDescription(
        'All commands start with **Tiffany** (text) or can be spoken in a voice channel.\n' +
          'Voice commands omit the prefix where indicated.'
      )
      .addFields(
        {
          name: '📡 Connection',
          value: [
            '`Tiffany summon` — Join your voice channel',
            '`Tiffany leave` / `bye` / `disconnect` — Leave the voice channel',
          ].join('\n'),
        },
        {
          name: '🔍 Discovery',
          value: [
            '`Tiffany find {song name}` — Search YouTube; pick a result with reactions (1️⃣–5️⃣) or voice _"I choose {number}"_',
            '`Tiffany play {youtube url}` — Queue a specific video or playlist (asks before adding full playlist)',
            '`Tiffany i am in the mood for {style}` / `Tiffany vibe {style}` — Temporary mood playlist or fallback vibe mix; on end choose 🔄 another or ▶️ resume',
          ].join('\n'),
        },
        {
          name: '▶️ Playback',
          value: [
            '`Tiffany play` — Start / resume the persistent playlist',
            '`Tiffany pause` — Pause mid-stream',
            '`Tiffany resume` — Continue after pause or stop',
            '`Tiffany stop` — Stop playback (keeps position for resume)',
            '`Tiffany skip this song` — Skip to the next song',
            '`Tiffany previous` / `back` — Go back one song',
          ].join('\n'),
        },
        {
          name: '📋 Playlist',
          value: [
            '`Tiffany queue` / `playlist` / `list` — Browse the current queue (paginated)',
            '`Tiffany now playing` — Show the current song and its position',
            '`Tiffany shuffle` — Shuffle the persistent playlist immediately',
            '`Tiffany remove current song` — Remove the current song and skip',
            '`Tiffany clear playlist` — Remove all songs (asks for confirmation)',
            '`Tiffany save track` — Save the current vibe/mood song into the regular playlist',
          ].join('\n'),
        },
        {
          name: '🔊 Volume',
          value: [
            '`Tiffany louder` — +10% volume',
            '`Tiffany softer` — −10% volume',
            '`Tiffany whisper` — Set to background volume (10%)',
            '`Tiffany volume {0–100}` — Set an exact volume percentage',
          ].join('\n'),
        },
        {
          name: '⭐ Song Rating',
          value: [
            '`Tiffany like` / `love` / `favourite` — ❤️ the current song',
            '`Tiffany dislike` / `hate` — 👎 the current song',
            '`Tiffany rating` — View likes/dislikes for the current song',
            '_Majority rules: if more present members dislike a song than like it, the song is auto-skipped._',
          ].join('\n'),
        },
        {
          name: '🤖 Personal Assistant',
          value: [
            '`Tiffany remind me in {time} to {task}` — Set a timed reminder (max 24h)',
            '`Tiffany roll {dice}` — Roll dice, e.g. `2d6`, `1d20+5`, `d12`',
            '`Tiffany poll "Question" "Opt1" "Opt2"` — Create a reaction-based poll',
          ].join('\n'),
        },
        {
          name: '📖 Documentation',
          value: [
            '`Tiffany help` — This quick-reference overview',
            '`Tiffany explain how you work` — Detailed guide sent as a DM',
            '`Tiffany clean chat` — Remove all Tiffany-related messages from the channel',
          ].join('\n'),
        },
      )
      .setFooter({ text: 'All commands are case-insensitive. Voice commands work when I am in your channel.' });

    await message.channel.send({ embeds: [embed] });
  },
};
