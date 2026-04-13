'use strict';

const logger = require('./logger');
const config = require('./config');
const { handleVoiceChoice, COMMANDS } = require('./commandHandler');
const player = require('./player');

// ─── Wake word patterns ────────────────────────────────────────────────────
// Matches "hey tiffany", "hi tiffany", "yo tiffany" etc. as wake word prefix.
// After the wake word, the rest of the utterance is treated as a command
// without requiring the "tiffany" prefix again.
const WAKE_WORD_PATTERNS = [
  new RegExp(`^(?:hey|hi|yo|okay|ok)\\s+${config.prefix}[,;.!?\\s]*(.*)$`, 'i'),
];

/**
 * Strip the wake word prefix and optional repeated "tiffany" prefix from an
 * utterance. Returns the command body or null if no wake word was detected.
 *
 * Examples:
 *   "Hey Tiffany louder"          → "louder"
 *   "Hey Tiffany; Tiffany louder" → "louder"
 *   "Hey tiffany; play"           → "play"
 *
 * @param {string} text  Lower-cased transcript
 * @returns {string|null}
 */
function extractAfterWakeWord(text) {
  const prefixLower = config.prefix.toLowerCase();
  for (const pattern of WAKE_WORD_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      let body = (match[1] || '').trim();
      // Strip an optional repeated prefix (e.g. "Hey Tiffany; Tiffany louder")
      if (body.toLowerCase().startsWith(prefixLower)) {
        body = body.slice(prefixLower.length).trim();
      }
      return body;
    }
  }
  return null;
}

/** @type {Map<string, number>} userId → timestamp of last wake word detection */
const wakeWordTimestamps = new Map();

/** Window in ms during which commands after a wake word don't need the prefix */
const WAKE_WORD_WINDOW = 5_000; // 5 seconds

/**
 * Process a recognised speech string and dispatch it to the matching command.
 *
 * @param {import('discord.js').Message} message  A message-like object synthesised from voice
 * @param {string} transcript  Raw recognised text
 */
async function handleSpeech(message, transcript) {
  if (!transcript) return;
  if (!message.guild) return;

  const guildId = message.guild.id;
  const lower = transcript.toLowerCase();
  const prefixLower = config.prefix.toLowerCase();
  const userId = message.author?.id;

  // ── "I choose N" handled regardless of prefix ─────────────────────────────
  const choiceHandled = await handleVoiceChoice({ message, guildId, content: lower });
  if (choiceHandled) return;

  // ── Wake word detection ────────────────────────────────────────────────────
  // "Hey Tiffany" followed by a command in the same utterance
  const wakeBody = extractAfterWakeWord(lower);
  if (wakeBody !== null) {
    if (wakeBody.length > 0) {
      // Wake word + command in one utterance: dispatch the command part
      if (userId) wakeWordTimestamps.set(userId, Date.now());
      await dispatchVoiceCommand(message, guildId, wakeBody);
    } else {
      // Just the wake word alone — remember it for the next utterance
      if (userId) wakeWordTimestamps.set(userId, Date.now());
      logger.info(`Wake word detected from ${message.author?.username} — awaiting command.`);
      await player.playBeep(guildId).catch((err) =>
        logger.warn(`Wake-word beep failed in guild ${guildId}: ${err.message}`)
      );
    }
    return;
  }

  // ── Check if within wake word window ───────────────────────────────────────
  // If the user recently said "Hey Tiffany", treat the next utterance as a
  // command without the prefix.
  if (userId && wakeWordTimestamps.has(userId)) {
    const lastWake = wakeWordTimestamps.get(userId);
    if (Date.now() - lastWake <= WAKE_WORD_WINDOW) {
      wakeWordTimestamps.delete(userId);
      // Strip optional prefix if they still said "Tiffany louder" after the wake word
      let body = lower;
      if (body.startsWith(prefixLower)) {
        body = body.slice(prefixLower.length).trim();
      }
      await dispatchVoiceCommand(message, guildId, body);
      return;
    }
    // Window expired — clean up
    wakeWordTimestamps.delete(userId);
  }

  // No wake word detected and not within the wake word window — ignore.
}

/**
 * Match the body text against voice patterns for each command and dispatch.
 * @param {import('discord.js').Message} message
 * @param {string} guildId
 * @param {string} body  Command text (already stripped of prefix/wake word)
 */
async function dispatchVoiceCommand(message, guildId, body) {
  for (const cmd of COMMANDS) {
    if (!cmd.voicePatterns || cmd.voicePatterns.length === 0) continue;

    for (const pattern of cmd.voicePatterns) {
      const match = body.match(pattern);
      if (match) {
        try {
          await cmd.execute({ message, guildId, match });
        } catch (err) {
          logger.error(`Voice command "${cmd.name}" threw an error`, err);
          await message.channel
            ?.send('❌ Something went wrong processing that voice command.')
            .catch(() => {});
        }
        return;
      }
    }
  }
}

/**
 * Return true if the given user is currently within a wake-word window
 * (i.e. they said "Hey Tiffany" recently and the window has not expired).
 *
 * Used by speechRecognizer to skip full transcription when the user is not
 * in an active wake-word window and the utterance is unlikely to be a command.
 *
 * @param {string} userId
 * @returns {boolean}
 */
function isInWakeWordWindow(userId) {
  if (!userId || !wakeWordTimestamps.has(userId)) return false;
  const lastWake = wakeWordTimestamps.get(userId);
  if (Date.now() - lastWake <= WAKE_WORD_WINDOW) return true;
  // Window expired — clean up
  wakeWordTimestamps.delete(userId);
  return false;
}

module.exports = { handleSpeech, extractAfterWakeWord, isInWakeWordWindow };
