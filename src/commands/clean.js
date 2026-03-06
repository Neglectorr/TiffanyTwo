'use strict';

const config = require('../config');
const logger = require('../logger');

/**
 * Tiffany clean chat
 * Deletes all messages in the current channel that are either:
 * - Directed at Tiffany (start with the bot prefix)
 * - Sent by Tiffany herself
 *
 * Messages are fetched in batches and bulk-deleted where possible.
 */
module.exports = {
  name: 'clean',
  patterns: [/^clean\s*(?:chat|messages?)?$/i],
  voicePatterns: [/\bclean\s*(?:chat|messages?)?\b/i],

  async execute({ message }) {
    const channel = message.channel;
    if (!channel) return;

    const botId = channel.client?.user?.id;
    if (!botId) return;

    const prefixLower = config.prefix.toLowerCase();

    await channel.send('🧹 Cleaning up Tiffany messages…').catch(() => {});

    let totalDeleted = 0;
    let lastMessageId;

    try {
      // Fetch messages in batches (Discord allows max 100 per fetch).
      // Capped at 10 batches (1000 messages) to avoid excessive API usage.
      for (let batch = 0; batch < 10; batch++) {
        const fetchOptions = { limit: 100 };
        if (lastMessageId) fetchOptions.before = lastMessageId;

        const messages = await channel.messages.fetch(fetchOptions);
        if (messages.size === 0) break;

        lastMessageId = messages.last().id;

        // Filter messages that are from Tiffany or directed at Tiffany
        const toDelete = messages.filter((msg) => {
          // Messages sent by Tiffany
          if (msg.author.id === botId) return true;
          // Messages directed at Tiffany (start with prefix)
          if (msg.content.toLowerCase().startsWith(prefixLower)) return true;
          return false;
        });

        if (toDelete.size === 0) continue;

        // bulkDelete only works for messages < 14 days old
        const now = Date.now();
        const twoWeeks = 14 * 24 * 60 * 60 * 1000;
        const bulkDeletable = toDelete.filter(
          (msg) => now - msg.createdTimestamp < twoWeeks
        );
        const tooOld = toDelete.filter(
          (msg) => now - msg.createdTimestamp >= twoWeeks
        );

        // Bulk delete recent messages
        if (bulkDeletable.size > 0) {
          try {
            const deleted = await channel.bulkDelete(bulkDeletable, true);
            totalDeleted += deleted.size;
          } catch (err) {
            logger.warn(`Bulk delete failed, falling back to individual delete: ${err.message}`);
            // Fall back to individual delete
            for (const [, msg] of bulkDeletable) {
              await msg.delete().catch(() => {});
              totalDeleted++;
            }
          }
        }

        // Delete old messages individually
        for (const [, msg] of tooOld) {
          await msg.delete().catch(() => {});
          totalDeleted++;
        }

        // If we got fewer than 100 messages, we've reached the end
        if (messages.size < 100) break;
      }

      const summary = await channel
        .send(`✅ Cleaned up **${totalDeleted}** message${totalDeleted !== 1 ? 's' : ''}.`)
        .catch(() => null);

      // Auto-delete the summary after a short delay
      if (summary) {
        setTimeout(() => summary.delete().catch(() => {}), 5000);
      }
    } catch (err) {
      logger.error('Clean chat command failed', err);
      await channel
        .send('❌ Something went wrong while cleaning up messages.')
        .catch(() => {});
    }
  },
};
