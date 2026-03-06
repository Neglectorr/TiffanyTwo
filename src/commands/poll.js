'use strict';

const { EmbedBuilder } = require('discord.js');
const logger = require('../logger');

/** Number emoji for options (up to 10) */
const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

/**
 * Parse poll options from the command body.
 * Supports:
 *   - Quoted options: Tiffany poll "Question" "Option1" "Option2" "Option3"
 *   - Pipe-separated: Tiffany poll Question | Option1 | Option2
 *
 * @param {string} body  Everything after "poll "
 * @returns {{ question: string, options: string[] }|null}
 */
function parsePoll(body) {
  // Try quoted format first: "question" "opt1" "opt2" ...
  const quoted = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim());
  if (quoted.length >= 2) {
    return { question: quoted[0], options: quoted.slice(1) };
  }

  // Try pipe-separated: Question | Opt1 | Opt2
  if (body.includes('|')) {
    const parts = body.split('|').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return { question: parts[0], options: parts.slice(1) };
    }
  }

  // Simple yes/no poll for a bare question
  if (body.trim().length > 0) {
    return { question: body.trim(), options: ['Yes', 'No'] };
  }

  return null;
}

/**
 * Tiffany poll "Question" "Option1" "Option2"
 * Tiffany poll Question | Option1 | Option2
 * Tiffany poll Should we play jazz?   (defaults to Yes/No)
 *
 * Creates a reaction-based poll.
 */
module.exports = {
  name: 'poll',
  patterns: [/^poll\s+(.+)$/is],
  voicePatterns: [/\bpoll\s+(.+)/i],

  async execute({ message, match }) {
    const body = match[1];
    const parsed = parsePoll(body);

    if (!parsed) {
      return message.reply(
        '❌ Usage: `Tiffany poll "Question" "Option1" "Option2"` or `Tiffany poll Question | Option1 | Option2`'
      );
    }

    const { question, options } = parsed;

    if (options.length > 10) {
      return message.reply('❌ Polls support a maximum of 10 options.');
    }

    const optionLines = options
      .map((opt, i) => `${NUMBER_EMOJIS[i]} ${opt}`)
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📊 ${question}`)
      .setDescription(optionLines)
      .setFooter({ text: `Poll by ${message.author.username} — react to vote!` })
      .setTimestamp();

    const pollMsg = await message.channel.send({ embeds: [embed] });

    // Add reaction options
    for (let i = 0; i < options.length; i++) {
      await pollMsg.react(NUMBER_EMOJIS[i]).catch((err) =>
        logger.warn(`Failed to add poll reaction: ${err.message}`)
      );
    }
  },

  // Exposed for testing
  _parsePoll: parsePoll,
};
