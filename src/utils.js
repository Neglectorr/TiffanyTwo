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

module.exports = { deleteAfter };
