'use strict';

/**
 * Logger – writes messages to the designated Discord log channel and to stdout.
 * The Discord client reference is set once the bot is ready.
 */

const config = require('./config');

let discordClient = null;

/**
 * Attach the Discord client so the logger can post to the log channel.
 * @param {import('discord.js').Client} client
 */
function setClient(client) {
  discordClient = client;
}

/**
 * Send a message to the configured log channel.
 * Falls back to console if the channel is unavailable.
 * @param {string} content
 */
async function toChannel(content) {
  if (!discordClient || !config.logChannelId) return;
  try {
    const channel = await discordClient.channels.fetch(config.logChannelId).catch(() => null);
    if (channel && channel.isTextBased()) {
      // Discord messages are limited to 2000 characters
      const chunks = splitMessage(content, 1990);
      for (const chunk of chunks) {
        await channel.send(`\`\`\`\n${chunk}\n\`\`\``);
      }
    }
  } catch {
    // Silently ignore logging failures
  }
}

/**
 * Log an informational message.
 * @param {string} message
 */
function info(message) {
  const line = `[INFO] ${new Date().toISOString()} ${message}`;
  console.log(line);
}

/**
 * Log a warning message (console + Discord channel).
 * @param {string} message
 */
function warn(message) {
  const line = `[WARN] ${new Date().toISOString()} ${message}`;
  console.warn(line);
  toChannel(line);
}

/**
 * Log an error (console + Discord channel).
 * @param {string} message
 * @param {Error|unknown} [error]
 */
function error(message, err) {
  const detail = err instanceof Error ? `\n${err.stack}` : err ? String(err) : '';
  const line = `[ERROR] ${new Date().toISOString()} ${message}${detail}`;
  console.error(line);
  toChannel(line);
}

/**
 * Split a long string into chunks that fit within Discord's message limit.
 * @param {string} text
 * @param {number} maxLen
 * @returns {string[]}
 */
function splitMessage(text, maxLen) {
  const chunks = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  return chunks;
}

module.exports = { setClient, info, warn, error };
