'use strict';

const { deleteAfter } = require('../utils');

/**
 * Parse dice notation (e.g. "2d6", "1d20", "4d8+3", "d12").
 * @param {string} input
 * @returns {{ count: number, sides: number, modifier: number }|null}
 */
function parseDice(input) {
  const match = input.trim().match(/^(\d*)d(\d+)(?:\s*([+-])\s*(\d+))?$/i);
  if (!match) return null;

  const count = match[1] ? parseInt(match[1], 10) : 1;
  const sides = parseInt(match[2], 10);
  const modSign = match[3] === '-' ? -1 : 1;
  const modifier = match[4] ? parseInt(match[4], 10) * modSign : 0;

  if (count < 1 || count > 100) return null; // sanity limit
  if (sides < 2 || sides > 1000) return null;

  return { count, sides, modifier };
}

/**
 * Tiffany roll {dice notation}
 * Rolls dice using standard notation (e.g. 2d6, 1d20+5, 4d8-2).
 */
module.exports = {
  name: 'dice',
  patterns: [
    /^roll\s+(.+)$/i,
    /^dice\s+(.+)$/i,
  ],
  voicePatterns: [
    /\broll\s+(.+)/i,
    /\bdice\s+(.+)/i,
  ],

  async execute({ message, match }) {
    const input = match[1].trim();
    const parsed = parseDice(input);

    if (!parsed) {
      return message.reply(
        '❌ Invalid dice notation. Use formats like `2d6`, `1d20`, `4d8+3`, or `d12`.'
      );
    }

    const { count, sides, modifier } = parsed;
    const rolls = [];
    for (let i = 0; i < count; i++) {
      rolls.push(Math.floor(Math.random() * sides) + 1);
    }

    const sum = rolls.reduce((a, b) => a + b, 0);
    const total = sum + modifier;
    const modStr = modifier > 0 ? ` + ${modifier}` : modifier < 0 ? ` - ${Math.abs(modifier)}` : '';

    let response;
    if (count === 1) {
      response = `🎲 **${total}**` + (modifier !== 0 ? ` (${rolls[0]}${modStr})` : '');
    } else {
      response = `🎲 **${total}** [${rolls.join(', ')}]${modStr}`;
    }

    deleteAfter(await message.reply(response));
  },

  // Exposed for testing
  _parseDice: parseDice,
};
