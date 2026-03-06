'use strict';

const logger = require('../logger');
const { deleteAfter } = require('../utils');

/**
 * Active reminders per guild.
 * @type {Map<string, Array<{timer: NodeJS.Timeout, userId: string, text: string, time: number}>>}
 */
const guildReminders = new Map();

/**
 * Parse a human-readable duration string into milliseconds.
 * Supports: "20 minutes", "1 hour", "30 seconds", "1h30m", "90s", etc.
 * @param {string} input
 * @returns {number|null} milliseconds, or null if unparseable
 */
function parseDuration(input) {
  const normalized = input.trim().toLowerCase();

  // Compound format: "1h30m", "2h", "30m", "90s", "1h30m20s"
  const compound = /^(?:(\d+)\s*h(?:ours?)?)?[\s,]*(?:(\d+)\s*m(?:in(?:utes?)?)?)?[\s,]*(?:(\d+)\s*s(?:ec(?:onds?)?)?)?$/i;
  const cm = normalized.match(compound);
  if (cm && (cm[1] || cm[2] || cm[3])) {
    const hours = parseInt(cm[1] || '0', 10);
    const minutes = parseInt(cm[2] || '0', 10);
    const seconds = parseInt(cm[3] || '0', 10);
    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }

  // Try simple format: "20 minutes", "1 hour", "30 seconds"
  const simple = /^(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)$/i;
  const sm = normalized.match(simple);
  if (sm) {
    const value = parseInt(sm[1], 10);
    const unit = sm[2].toLowerCase();
    if (unit.startsWith('s')) return value * 1000;
    if (unit.startsWith('m')) return value * 60_000;
    if (unit.startsWith('h')) return value * 3_600_000;
  }

  return null;
}

/**
 * Format milliseconds into a human-readable string.
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);
  return parts.join(' ');
}

/**
 * Tiffany remind me in {duration} to {task}
 * Sets a timed reminder that pings the user when the time elapses.
 */
module.exports = {
  name: 'remind',
  patterns: [
    /^remind\s+(?:me\s+)?in\s+(.+?)\s+to\s+(.+)$/i,
    /^remind\s+(?:me\s+)?in\s+(.+?)\s+(?:about|that)\s+(.+)$/i,
  ],
  voicePatterns: [
    /\bremind\s+(?:me\s+)?in\s+(.+?)\s+to\s+(.+)/i,
    /\bremind\s+(?:me\s+)?in\s+(.+?)\s+(?:about|that)\s+(.+)/i,
  ],

  async execute({ message, guildId, match }) {
    const durationStr = match[1].trim();
    const task = match[2].trim();

    const ms = parseDuration(durationStr);
    if (!ms || ms <= 0) {
      return message.reply(
        `❌ I couldn't understand the duration "${durationStr}". ` +
        'Try something like "20 minutes", "1 hour", "30 seconds", or "1h30m".'
      );
    }

    // Cap reminders at 24 hours
    if (ms > 24 * 3_600_000) {
      return message.reply('❌ Reminders can be set for a maximum of 24 hours.');
    }

    const userId = message.author.id;
    const channel = message.channel;

    const timer = setTimeout(async () => {
      try {
        await channel.send(`⏰ <@${userId}> Reminder: **${task}**`);
      } catch (err) {
        logger.warn(`Failed to send reminder: ${err.message}`);
      }
      // Remove from tracking
      const reminders = guildReminders.get(guildId);
      if (reminders) {
        const idx = reminders.findIndex((r) => r.timer === timer);
        if (idx !== -1) reminders.splice(idx, 1);
      }
    }, ms);

    // Track the reminder
    if (!guildReminders.has(guildId)) guildReminders.set(guildId, []);
    guildReminders.get(guildId).push({ timer, userId, text: task, time: Date.now() + ms });

    deleteAfter(
      await message.reply(`⏰ Got it! I'll remind you in **${formatDuration(ms)}** to **${task}**.`)
    );
    logger.info(`Reminder set for ${message.author.username} in guild ${guildId}: "${task}" in ${formatDuration(ms)}`);
  },

  // Exposed for testing
  _parseDuration: parseDuration,
  _formatDuration: formatDuration,
};
