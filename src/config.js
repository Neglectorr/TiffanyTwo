'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const config = {
  /** Discord bot token */
  token: process.env.DISCORD_TOKEN,

  /** Channel ID for bot logs / errors */
  logChannelId: process.env.LOG_CHANNEL_ID,

  /** Command prefix, case-insensitive (default: tiffany) */
  prefix: (process.env.BOT_PREFIX || 'tiffany').toLowerCase(),

  /** Root data directory for playlist and TTS files */
  dataDir: path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data')),

  /** Default playback volume 0.0 – 1.0 */
  defaultVolume: parseFloat(process.env.DEFAULT_VOLUME || '0.5'),

  /** Volume step for louder / softer commands */
  volumeStep: parseFloat(process.env.VOLUME_STEP || '0.1'),

  /** Volume level for whisper mode */
  whisperVolume: parseFloat(process.env.WHISPER_VOLUME || '0.1'),

  /** TTS voice name (platform-specific) */
  ttsVoice: process.env.TTS_VOICE || null,

  /** Maximum number of YouTube search results shown */
  findResultsCount: parseInt(process.env.FIND_RESULTS_COUNT || '5', 10),

  /** Milliseconds to wait for reaction / voice confirmation */
  reactionTimeout: parseInt(process.env.REACTION_TIMEOUT || '60000', 10),

  /** Milliseconds before temporary bot messages are auto-deleted (0 = disabled) */
  messageDeleteDelay: parseInt(process.env.MESSAGE_DELETE_DELAY || '20000', 10),

  /** Milliseconds to wait for the voice connection to become ready */
  voiceConnectTimeout: parseInt(process.env.VOICE_CONNECT_TIMEOUT || '30000', 10),

  /** Number of times to retry joining a voice channel before giving up */
  voiceConnectRetries: parseInt(process.env.VOICE_CONNECT_RETRIES || '3', 10),
};

if (!config.token) {
  console.error('[Config] DISCORD_TOKEN is not set. The bot cannot start without it.');
  process.exit(1);
}

module.exports = config;
