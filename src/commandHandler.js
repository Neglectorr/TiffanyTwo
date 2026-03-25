'use strict';

const logger = require('./logger');
const config = require('./config');

// ─── Load commands ──────────────────────────────────────────────────────────

const summon = require('./commands/summon');
const find = require('./commands/find');
const mood = require('./commands/mood');
const play = require('./commands/play');
const pause = require('./commands/pause');
const resume = require('./commands/resume');
const stop = require('./commands/stop');
const skip = require('./commands/skip');
const previous = require('./commands/previous');
const remove = require('./commands/remove');
const nowplaying = require('./commands/nowplaying');
const queue = require('./commands/queue');
const shuffle = require('./commands/shuffle');
const clear = require('./commands/clear');
const leave = require('./commands/leave');
const volume = require('./commands/volume');
const clean = require('./commands/clean');
const help = require('./commands/help');
const explain = require('./commands/explain');
const remind = require('./commands/remind');
const dice = require('./commands/dice');
const poll = require('./commands/poll');
const rate = require('./commands/rate');
const saveTrack = require('./commands/saveTrack');

/** All registered commands in priority order */
const COMMANDS = [
  summon, find, mood, play, pause, resume, stop,
  skip, previous, remove, nowplaying, queue, shuffle, clear, leave, volume,
  remind, dice, poll, rate, saveTrack, clean, help, explain,
];

// ─── Text command dispatch ──────────────────────────────────────────────────

/**
 * Process a Discord message and dispatch it to the matching command.
 * Expects messages that start with the configured prefix (e.g. "tiffany").
 *
 * @param {import('discord.js').Message} message
 */
async function handleMessage(message) {
  if (message.author.bot) return;
  if (!message.guild) return;

  const content = message.content.trim();
  const prefixLower = config.prefix.toLowerCase();

  // Check the message starts with the prefix (case-insensitive)
  if (!content.toLowerCase().startsWith(prefixLower)) return;

  // Strip the prefix and any trailing whitespace
  const body = content.slice(prefixLower.length).trim();
  const guildId = message.guild.id;

  for (const cmd of COMMANDS) {
    for (const pattern of cmd.patterns) {
      const match = body.match(pattern);
      if (match) {
        try {
          await cmd.execute({ message, guildId, match });
        } catch (err) {
          logger.error(`Command "${cmd.name}" threw an error`, err);
          await message.reply('❌ Something went wrong running that command.').catch(() => {});
        }
        return;
      }
    }
  }

  // If no command matched but the prefix was used, show a short hint
  if (body.length === 0) {
    await message
      .reply("Hi! I'm Tiffany 🎵 — say **Tiffany help** to see all available commands.")
      .catch(() => {});
  }
}

// ─── Voice "choice" dispatch ────────────────────────────────────────────────

/**
 * Handle the special "I choose {number}" voice pattern for find results.
 * Returns true if the message was handled.
 *
 * @param {{ message: import('discord.js').Message, guildId: string, content: string }} ctx
 * @returns {Promise<boolean>}
 */
async function handleVoiceChoice(ctx) {
  const { content } = ctx;
  for (const pattern of find.choicePatterns) {
    const match = content.match(pattern);
    if (match) {
      try {
        await find.handleChoice({ ...ctx, match });
      } catch (err) {
        logger.error('Voice choice handler threw an error', err);
      }
      return true;
    }
  }
  return false;
}

module.exports = { handleMessage, handleVoiceChoice, COMMANDS };
