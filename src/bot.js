'use strict';

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { generateDependencyReport } = require('@discordjs/voice');
const logger = require('./logger');
const config = require('./config');
const { handleMessage } = require('./commandHandler');
const { handleSpeech } = require('./voiceHandler');
const player = require('./player');
const SpeechRecognizer = require('./speechRecognizer');

// Log the @discordjs/voice dependency report at startup so missing native
// libraries (opus, encryption, FFmpeg, DAVE) are immediately visible.
const depReport = generateDependencyReport();
logger.info(`Voice dependency report:\n${depReport}`);

// Warn if @snazzah/davey is missing – voice connections will fail without it
// because Discord enforces DAVE (E2EE) on most voice channels.
if (depReport.includes('@snazzah/davey: not found')) {
  logger.warn(
    '@snazzah/davey is not installed. Voice connections will likely fail because ' +
    'Discord requires DAVE (E2EE) support. Install it with: npm install @snazzah/davey'
  );
}

// Audio receive (listening to users) is currently broken in @discordjs/voice
// 0.19.x with DAVE enabled. Speech recognition via Vosk will be unavailable
// until this upstream issue is resolved.
// See: https://github.com/discordjs/discord.js/issues/11419
logger.info(
  'Note: Audio receive (voice recognition) is degraded with DAVE E2EE in ' +
  '@discordjs/voice 0.19.x. Voice commands via Vosk may not work until the ' +
  'upstream issue is fixed. Text commands are unaffected.'
);

// ─── Discord Client ────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// ─── Offline speech recognition ────────────────────────────────────────────
// Uses Vosk for fully local, cost-free speech-to-text.
// No Google (or any external) API is involved.

const speechRecognizer = new SpeechRecognizer(client);

// ─── Events ────────────────────────────────────────────────────────────────

client.once('clientReady', () => {
  logger.setClient(client);
  logger.info(`Logged in as ${client.user.tag}`);
  client.user.setActivity('🎵 Tiffany | say "Tiffany summon"', { type: 0 });
});

client.on('messageCreate', async (message) => {
  try {
    await handleMessage(message);
  } catch (err) {
    logger.error('Unhandled error in messageCreate', err);
  }
});

// ─── Sleep timer: leave when voice channel is empty ────────────────────────
// When all human users leave the bot's voice channel, start a 2-minute timer.
// If no one returns within that time, stop playback and leave the channel.
// A new `summon` is required to bring the bot back.

/** @type {Map<string, NodeJS.Timeout>} guildId → sleep timer */
const sleepTimers = new Map();

/** Duration in ms before the bot auto-leaves an empty channel (2 minutes) */
const SLEEP_TIMEOUT = 2 * 60_000;

/**
 * Check if the bot is alone (no human members) in its voice channel.
 * @param {import('discord.js').Guild} guild
 * @returns {{ alone: boolean, channel: import('discord.js').VoiceChannel|null }}
 */
function isBotAlone(guild) {
  const botMember = guild.members.cache.get(client.user.id);
  const voiceChannel = botMember?.voice?.channel;
  if (!voiceChannel) return { alone: false, channel: null };
  const humanMembers = voiceChannel.members.filter((m) => !m.user.bot);
  return { alone: humanMembers.size === 0, channel: voiceChannel };
}

// Register the speech recognizer whenever the bot joins a voice channel so
// it can listen to users speaking.  We use voiceStateUpdate rather than
// hooking into player.join() directly to keep the modules decoupled.
//
// Also handles the sleep timer for empty voice channels.
client.on('voiceStateUpdate', (oldState, newState) => {
  // ── Register speech recognizer when bot joins ────────────────────────────
  if (newState.member?.id === client.user?.id && newState.channelId) {
    const guildId = newState.guild.id;
    const state = player.getState(guildId);
    if (state?.connection) {
      speechRecognizer.registerConnection(state.connection, newState.guild);
    }
  }

  // ── Sleep timer logic ────────────────────────────────────────────────────
  // Trigger on any voice state change in guilds where the bot is connected
  const guild = newState.guild || oldState.guild;
  if (!guild) return;
  const guildId = guild.id;
  const botState = player.getState(guildId);
  if (!botState) return; // bot not in a voice channel for this guild

  const { alone, channel } = isBotAlone(guild);

  if (alone && !sleepTimers.has(guildId)) {
    // Start the sleep timer — bot is alone
    logger.info(`Voice channel empty in guild ${guildId}. Starting 2-minute sleep timer.`);
    const timer = setTimeout(async () => {
      sleepTimers.delete(guildId);
      // Double-check we're still alone
      const { alone: stillAlone } = isBotAlone(guild);
      if (stillAlone) {
        const channelName = channel?.name || 'the voice channel';
        logger.info(`Sleep timer expired for guild ${guildId}. Leaving ${channelName}.`);
        const textChannel = botState.textChannel;
        player.leave(guildId);
        if (textChannel) {
          textChannel
            .send(`💤 Left **${channelName}** — nobody was listening for 2 minutes. Say **Tiffany summon** to bring me back!`)
            .catch(() => {});
        }
      }
    }, SLEEP_TIMEOUT);
    sleepTimers.set(guildId, timer);
  } else if (!alone && sleepTimers.has(guildId)) {
    // Someone returned — cancel the sleep timer
    clearTimeout(sleepTimers.get(guildId));
    sleepTimers.delete(guildId);
    logger.info(`Sleep timer cancelled for guild ${guildId} — someone returned.`);
  }
});

// Voice speech recognition
speechRecognizer.on('speech', async ({ content, author, channel, userId, confidence }) => {
  if (!content) return;
  if (!channel?.guild) return;

  const confStr = confidence !== undefined ? ` (conf: ${(confidence * 100).toFixed(0)}%)` : '';
  logger.info(`Speech from ${author?.username}${confStr}: "${content}"`);

  // Build a message-like object so voice commands reuse the same command code
  const syntheticMessage = {
    author,
    guild: channel.guild,
    channel,
    member: channel.guild.members.cache.get(author.id),
    reply: (text) => channel.send(typeof text === 'string' ? text : text),
    content,
  };

  // Optionally respond via TTS if addressed as "Tiffany"
  const lower = content.toLowerCase();
  if (lower.includes(config.prefix)) {
    const guildId = channel.guild.id;
    const state = player.getState(guildId);
    if (state) {
      // Personal assistant greeting – address the speaker by name
      const member = channel.guild.members.cache.get(author.id);
      const speakerName = member?.displayName || author?.displayName || author?.username || '';
      const greeting = speakerName ? `Yes, ${speakerName}?` : 'Yes?';
      await player.speak(guildId, greeting).catch((err) =>
        logger.warn(`TTS ack failed: ${err.message}`)
      );
    }
  }

  try {
    await handleSpeech(syntheticMessage, content);
  } catch (err) {
    logger.error('Unhandled error in speech handler', err);
  }
});

// Graceful shutdown
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function shutdown() {
  logger.info('Shutting down Tiffany…');
  client.destroy();
  process.exit(0);
}

// ─── Unhandled rejections / exceptions ────────────────────────────────────

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled promise rejection', err);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', err);
  // Give the logger time to send before exiting
  setTimeout(() => process.exit(1), 2000);
});

module.exports = { client };
