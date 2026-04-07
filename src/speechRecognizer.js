'use strict';

/**
 * Offline speech recognition powered by Vosk.
 *
 * Replaces `discord-speech-recognition` (which relayed audio to Google's Web
 * Speech API) with a fully local pipeline:
 *
 *   Discord voice receiver (Opus) → prism-media Opus decoder (48 kHz stereo PCM)
 *     → simple 3:1 decimation + channel-average (→ 16 kHz mono PCM)
 *       → Vosk offline STT → emit 'speech' event
 *
 * No external service, no API key, no ongoing cost.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { EndBehaviorType } = require('@discordjs/voice');
const logger = require('./logger');
const config = require('./config');

// ─── Constants ──────────────────────────────────────────────────────────────

/** Sample rate expected by the Vosk small-en model */
const VOSK_SAMPLE_RATE = 16000;

/** Discord sends 48 kHz stereo Opus audio */
const DISCORD_SAMPLE_RATE = 48000;
const DISCORD_CHANNELS = 2;
const DISCORD_FRAME_SIZE = 960; // 20 ms at 48 kHz

/** Decimation factor: 48000 / 16000 = 3 */
const DECIMATE = DISCORD_SAMPLE_RATE / VOSK_SAMPLE_RATE;

/** Minimum PCM bytes before attempting recognition (avoids spurious hits on < 0.1 s of audio) */
const MIN_PCM_BYTES = DISCORD_SAMPLE_RATE * DISCORD_CHANNELS * 2 * 0.1; // 0.1 s × 48000 Hz × 2 ch × 2 bytes

/** Minimum average confidence score (0.0–1.0) for a voice command to be acted upon */
const CONFIDENCE_THRESHOLD = 0.45;

/** Path where the Vosk model should be installed */
const MODEL_PATH = path.join(config.dataDir, 'vosk-model-small-en-us-0.15');

// ─── Lazy-loaded singletons ──────────────────────────────────────────────────

let voskLib = null;
let voskUnavailable = false;
let voskModel = null;
let voskModelMissing = false;

function getVosk() {
  if (voskLib) return voskLib;
  if (voskUnavailable) return null;
  try {
    voskLib = require('vosk');
    voskLib.setLogLevel(-1);
    return voskLib;
  } catch (err) {
    voskUnavailable = true;
    logger.warn(`Vosk library unavailable – voice input disabled: ${err.message}`);
    return null;
  }
}

function getModel() {
  if (voskModel) return voskModel;
  const vosk = getVosk();
  if (!vosk) return null;
  if (!fs.existsSync(MODEL_PATH)) {
    if (!voskModelMissing) {
      voskModelMissing = true;
      logger.warn(
        `Vosk model not found at ${MODEL_PATH}. ` +
          'Run "node scripts/download-model.js" to install it. ' +
          'Voice recognition is disabled until the model is present.'
      );
    }
    return null;
  }
  try {
    voskModel = new vosk.Model(MODEL_PATH);
    logger.info('Vosk offline speech recognition model loaded successfully.');
    return voskModel;
  } catch (err) {
    logger.warn(`Failed to load Vosk model: ${err.message}`);
    return null;
  }
}

// ─── PCM conversion ──────────────────────────────────────────────────────────

/**
 * Convert 48 kHz stereo PCM (Int16 LE) to 16 kHz mono PCM (Int16 LE).
 *
 * Uses simple integer decimation (factor 3) with left+right channel averaging.
 * Adequate for voice-command recognition; no anti-aliasing filter required.
 *
 * @param {Buffer} src  48 kHz stereo PCM buffer
 * @returns {Buffer}    16 kHz mono PCM buffer
 */
function convertTo16kMono(src) {
  const bytesPerStereoFrame = DISCORD_CHANNELS * 2; // 4 bytes per stereo sample
  const totalFrames = Math.floor(src.length / bytesPerStereoFrame);
  const outFrames = Math.floor(totalFrames / DECIMATE);
  const out = Buffer.allocUnsafe(outFrames * 2);

  for (let i = 0; i < outFrames; i++) {
    const offset = i * DECIMATE * bytesPerStereoFrame;
    const left = src.readInt16LE(offset);
    const right = src.readInt16LE(offset + 2);
    const mono = Math.round((left + right) / 2);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, mono)), i * 2);
  }

  return out;
}

// ─── SpeechRecognizer ────────────────────────────────────────────────────────

/**
 * Offline speech recognizer for Discord voice channels.
 *
 * Usage:
 *   const recognizer = new SpeechRecognizer(client);
 *   recognizer.registerConnection(connection, guild);
 *   recognizer.on('speech', ({ content, author, channel }) => { … });
 */
class SpeechRecognizer extends EventEmitter {
  /**
   * @param {import('discord.js').Client} discordClient
   */
  constructor(discordClient) {
    super();
    this._client = discordClient;
    /** @type {Set<string>} guildIds that already have an active receiver */
    this._active = new Set();
  }

  /**
   * Attach the recognizer to an existing voice connection.
   * Idempotent – safe to call multiple times for the same guild.
   *
   * @param {import('@discordjs/voice').VoiceConnection} connection
   * @param {import('discord.js').Guild} guild
   */
  registerConnection(connection, guild) {
    const guildId = guild.id;
    if (this._active.has(guildId)) return;
    this._active.add(guildId);

    this._setupReceiver(connection, guild);

    // Remove tracking entry when the connection is torn down
    connection.on('stateChange', (_, next) => {
      if (next.status === 'destroyed') {
        this._active.delete(guildId);
      }
    });
  }

  /**
   * @param {import('@discordjs/voice').VoiceConnection} connection
   * @param {import('discord.js').Guild} guild
   */
  _setupReceiver(connection, guild) {
    let prism;
    try {
      // prism-media is a direct dependency of @discordjs/voice
      prism = require('prism-media');
    } catch (err) {
      logger.warn(`prism-media not available – voice input disabled: ${err.message}`);
      return;
    }

    const { receiver } = connection;

    /** @type {Set<string>} userIds with an active decode pipeline in this guild */
    const activeUsers = new Set();

    receiver.speaking.on('start', (userId) => {
      const user = this._client.users.cache.get(userId);
      if (!user || user.bot) return;

      // Prevent a second pipeline from being created while the first is still
      // draining — avoids feeding concurrent Opus frames into separate decoders
      // which triggers "memory access out of bounds" in libopus.
      if (activeUsers.has(userId)) return;
      activeUsers.add(userId);

      logger.info(`Receiving audio from ${user.username} (${userId}) in guild ${guild.name}`);

      // Subscribe to this user's Opus audio stream; end after 1 s of silence
      const opusStream = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
      });

      // Decode Opus → 48 kHz stereo PCM (Int16 LE)
      const decoder = new prism.opus.Decoder({
        rate: DISCORD_SAMPLE_RATE,
        channels: DISCORD_CHANNELS,
        frameSize: DISCORD_FRAME_SIZE,
      });

      const chunks = [];
      let pipelineTornDown = false;

      const tearDownPipeline = () => {
        if (pipelineTornDown) return;
        pipelineTornDown = true;
        activeUsers.delete(userId);
        opusStream.unpipe(decoder);
        decoder.destroy();
        opusStream.destroy();
      };

      opusStream.pipe(decoder);

      decoder.on('data', (chunk) => chunks.push(chunk));

      decoder.on('end', () => {
        activeUsers.delete(userId);
        const rawPcm = Buffer.concat(chunks);
        if (rawPcm.length < MIN_PCM_BYTES) {
          logger.info(`Audio from ${user?.username} too short to recognize (${rawPcm.length} bytes < ${MIN_PCM_BYTES} minimum).`);
          return;
        }

        const vosk = getVosk();
        const model = getModel();
        if (!vosk || !model) return;

        // Convert 48 kHz stereo → 16 kHz mono
        const pcm16k = convertTo16kMono(rawPcm);

        let rec;
        try {
          rec = new vosk.Recognizer({ model, sampleRate: VOSK_SAMPLE_RATE });

          // Enable word-level confidence scores for threshold filtering
          rec.setWords(true);

          rec.acceptWaveform(pcm16k);
          const voskResult = rec.finalResult();
          const text = (voskResult.text ?? '').trim();

          // Calculate average confidence from word-level results
          let confidence = 1.0;
          if (voskResult.result && voskResult.result.length > 0) {
            const totalConf = voskResult.result.reduce((sum, w) => sum + (w.conf ?? 0), 0);
            confidence = totalConf / voskResult.result.length;
          }

          // Always log the raw recognition result so every utterance is visible
          // in the console regardless of confidence level – useful for tuning
          // CONFIDENCE_THRESHOLD and verifying that audio receive is working.
          if (text) {
            logger.info(`[STT] ${user?.username}: "${text}" – conf ${(confidence * 100).toFixed(0)}%`);
          } else {
            logger.info(`[STT] ${user?.username}: (no speech recognized)`);
          }

          if (text && confidence >= CONFIDENCE_THRESHOLD) {
            // Resolve the channel: prefer the voice channel the speaker is in,
            // fall back to the first text channel in the guild.
            const channel =
              guild.channels.cache.find(
                (ch) => ch.isVoiceBased?.() && ch.members?.has(userId)
              ) ?? guild.channels.cache.find((ch) => ch.isTextBased?.());

            this.emit('speech', { content: text, author: user, channel, userId, confidence });
          } else if (text && confidence < CONFIDENCE_THRESHOLD) {
            logger.info(
              `Vosk transcript below confidence threshold (${(confidence * 100).toFixed(0)}% < ${(CONFIDENCE_THRESHOLD * 100).toFixed(0)}%): "${text}"`
            );
          }
        } catch (err) {
          logger.warn(`Vosk recognition error: ${err.message}`);
        } finally {
          if (rec) rec.free();
        }
      });

      // On decoder/stream error: tear down the whole pipeline exactly once and
      // release the user slot so the next speech start can create a fresh decoder.
      decoder.on('error', (err) => {
        logger.warn(`Opus decoder error for user ${userId}: ${err.message}`);
        tearDownPipeline();
      });

      opusStream.on('error', (err) => {
        logger.warn(`Opus receive stream error for user ${userId}: ${err.message}`);
        tearDownPipeline();
      });
    });
  }
}

module.exports = SpeechRecognizer;
