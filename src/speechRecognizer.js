'use strict';

/**
 * Offline speech recognition powered by OpenAI Whisper via @xenova/transformers.
 *
 * Replaces the Vosk-based pipeline with a pure JavaScript/WASM implementation
 * that requires no native compilation and works on Node.js 22+:
 *
 *   Discord voice receiver (Opus) → prism-media Opus decoder (48 kHz stereo PCM)
 *     → simple 3:1 decimation + channel-average (→ 16 kHz mono PCM)
 *       → Float32 normalisation → Whisper STT → emit 'speech' event
 *
 * The model is downloaded automatically on first use (~150 MB, one-time).
 * No native compilation, no external API, no ongoing cost.
 */

const EventEmitter = require('events');
const path = require('path');
const { EndBehaviorType } = require('@discordjs/voice');
const logger = require('./logger');
const config = require('./config');

// ─── Constants ──────────────────────────────────────────────────────────────

/** Sample rate expected by Whisper */
const WHISPER_SAMPLE_RATE = 16000;

/** Discord sends 48 kHz stereo Opus audio */
const DISCORD_SAMPLE_RATE = 48000;
const DISCORD_CHANNELS = 2;
const DISCORD_FRAME_SIZE = 960; // 20 ms at 48 kHz

/** Decimation factor: 48000 / 16000 = 3 */
const DECIMATE = DISCORD_SAMPLE_RATE / WHISPER_SAMPLE_RATE;

/** Minimum PCM bytes before attempting recognition (avoids spurious hits on < 0.1 s of audio) */
const MIN_PCM_BYTES = DISCORD_SAMPLE_RATE * DISCORD_CHANNELS * 2 * 0.1; // 0.1 s × 48000 Hz × 2 ch × 2 bytes

// ─── Whisper singleton ───────────────────────────────────────────────────────

/** Cached pipeline Promise (null = not started or last attempt failed) */
let _transcriberPromise = null;

/**
 * Lazily initialise (and cache) the Whisper ASR pipeline.
 * Returns a Promise that resolves to the pipeline function, or null on failure.
 */
function getTranscriber() {
  if (_transcriberPromise) return _transcriberPromise;

  const { pipeline, env } = require('@xenova/transformers');
  env.cacheDir = path.join(config.dataDir, 'transformers-cache');

  _transcriberPromise = pipeline('automatic-speech-recognition', 'Xenova/whisper-small.en')
    .then((t) => {
      logger.info('Whisper offline speech recognition model loaded successfully.');
      return t;
    })
    .catch((err) => {
      logger.warn(`Whisper model unavailable – voice input disabled: ${err.message}`);
      _transcriberPromise = null; // allow a retry on next speech event
      return null;
    });

  return _transcriberPromise;
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

/**
 * Normalise 16-bit integer PCM samples to floating-point in the range [-1.0, 1.0].
 * Whisper expects Float32 audio input.
 *
 * @param {Buffer} pcmBuffer  16 kHz mono PCM (Int16 LE)
 * @returns {Float32Array}
 */
function pcm16kToFloat32(pcmBuffer) {
  const samples = pcmBuffer.length / 2;
  const float32 = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    float32[i] = pcmBuffer.readInt16LE(i * 2) / 32768.0;
  }
  return float32;
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

    // Begin loading the model in the background immediately so it is ready
    // before the first user speaks.
    getTranscriber().catch(() => {});
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

      decoder.on('end', async () => {
        activeUsers.delete(userId);
        const rawPcm = Buffer.concat(chunks);
        if (rawPcm.length < MIN_PCM_BYTES) {
          logger.info(`Audio from ${user?.username} too short to recognize (${rawPcm.length} bytes < ${MIN_PCM_BYTES} minimum).`);
          return;
        }

        const transcriber = await getTranscriber();
        if (!transcriber) return;

        // Convert 48 kHz stereo → 16 kHz mono → Float32
        const pcm16k = convertTo16kMono(rawPcm);
        const float32Audio = pcm16kToFloat32(pcm16k);

        try {
          const result = await transcriber(float32Audio, { sampling_rate: WHISPER_SAMPLE_RATE });
          const text = (result.text ?? '').trim();

          if (text) {
            logger.info(`[STT] ${user?.username}: "${text}"`);
          } else {
            logger.info(`[STT] ${user?.username}: (no speech recognized)`);
          }

          if (text) {
            // Resolve the channel: prefer the voice channel the speaker is in,
            // fall back to the first text channel in the guild.
            const channel =
              guild.channels.cache.find(
                (ch) => ch.isVoiceBased?.() && ch.members?.has(userId)
              ) ?? guild.channels.cache.find((ch) => ch.isTextBased?.());

            this.emit('speech', { content: text, author: user, channel, userId });
          }
        } catch (err) {
          logger.warn(`Whisper recognition error: ${err.message}`);
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
