'use strict';

const config = require('./config');

/**
 * Delete a Discord message after a delay.
 * Returns a cancel function that clears the timer (e.g. if a collector already
 * handled the message before the timeout fires).
 * All errors are silently ignored — the message may already have been deleted.
 *
 * @param {import('discord.js').Message|null|undefined} msg
 * @param {number} [delay]  Milliseconds; defaults to config.messageDeleteDelay
 * @returns {() => void}  Call to cancel the pending deletion
 */
function deleteAfter(msg, delay) {
  const ms = delay !== undefined ? delay : config.messageDeleteDelay;
  if (!msg || ms <= 0) return () => {};
  const timer = setTimeout(() => msg.delete().catch(() => {}), ms);
  return () => clearTimeout(timer);
}

/**
 * Delete recent messages sent by Tiffany in a channel.
 *
 * @param {import('discord.js').TextBasedChannel|null|undefined} channel
 * @param {{ limit?: number }} [options]
 * @returns {Promise<number>}
 */
async function deleteBotMessages(channel, options = {}) {
  if (!channel?.messages?.fetch) return 0;

  const limit = Math.min(Math.max(options.limit || 25, 1), 100);
  const botId = channel.client?.user?.id;
  if (!botId) return 0;

  const messages = await channel.messages.fetch({ limit }).catch(() => null);
  if (!messages?.size) return 0;

  const botMessages = messages.filter((msg) => msg.author?.id === botId);
  let deleted = 0;

  for (const [, msg] of botMessages) {
    await msg.delete().then(() => {
      deleted++;
    }).catch(() => {});
  }

  return deleted;
}

module.exports = { deleteAfter, deleteBotMessages };
