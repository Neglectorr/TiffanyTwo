'use strict';

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
  joinVoiceChannel,
  getVoiceConnection,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const play = require('play-dl');
const ytdlp = require('./ytdlp');
const playlist = require('./playlist');
const tts = require('./tts');
const logger = require('./logger');
const config = require('./config');
const { deleteBotMessages } = require('./utils');

/**
 * @typedef {Object} GuildPlayerState
 * @property {import('@discordjs/voice').VoiceConnection} connection
 * @property {import('@discordjs/voice').AudioPlayer} player
 * @property {number} volume  Current volume (0.0 – 1.0)
 * @property {import('discord.js').TextChannel|null} textChannel  For sending now-playing messages
 * @property {boolean} playing
 */

/** @type {Map<string, GuildPlayerState>} */
const guildStates = new Map();

/** @type {Map<string, Promise<GuildPlayerState>>} Tracks in-progress join operations to prevent concurrent attempts */
const joiningGuilds = new Map();

/** Module-level event emitter so callers can react to player lifecycle events */
const playerEmitter = new EventEmitter();

const MS_PER_SECOND = 1000;
const BEEP_FADE_SECONDS = 0.01;

// ─── Voice Connection ───────────────────────────────────────────────────────

/**
 * Join a voice channel and return the guild state.
 * Waits for the voice connection to reach the Ready state before returning
 * so that audio can be played immediately after calling this function.
 * @param {import('discord.js').VoiceChannel} voiceChannel
 * @param {import('discord.js').TextChannel} textChannel
 * @returns {Promise<GuildPlayerState>}
 */
async function join(voiceChannel, textChannel) {
  const guildId = voiceChannel.guild.id;

  // Reuse existing connection only if it is in the Ready state.
  // If the connection exists but is no longer healthy (Destroyed,
  // Disconnected, or stuck in Signalling/Connecting) we clean it up
  // and fall through to create a fresh connection.
  let state = guildStates.get(guildId);
  if (state) {
    const status = state.connection.state.status;

    if (status === VoiceConnectionStatus.Ready) {
      state.textChannel = textChannel;
      return state;
    }

    // Connection is transitioning – give it a chance to reach Ready
    if (
      status === VoiceConnectionStatus.Signalling ||
      status === VoiceConnectionStatus.Connecting
    ) {
      try {
        await entersState(
          state.connection,
          VoiceConnectionStatus.Ready,
          config.voiceConnectTimeout
        );
        state.textChannel = textChannel;
        return state;
      } catch {
        // Could not recover – tear down and rejoin below
        logger.warn(
          `Existing voice connection for guild ${guildId} stuck in ${status}; destroying and reconnecting.`
        );
      }
    }

    // Connection is Destroyed, Disconnected, or failed to recover above
    try { state.connection.destroy(); } catch { /* already destroyed */ }
    guildStates.delete(guildId);
  }

  // If a join is already in progress for this guild, wait for it instead of
  // starting a competing connection attempt (prevents the "Cannot destroy
  // VoiceConnection - it has already been destroyed" race condition).
  const pending = joiningGuilds.get(guildId);
  if (pending) {
    const state = await pending;
    // Update textChannel to the latest caller's channel (same as the
    // "reuse existing connection" path above – the shared state object
    // in guildStates is intentionally mutable).
    state.textChannel = textChannel;
    return state;
  }

  const joinPromise = _joinImpl(voiceChannel, textChannel);
  joiningGuilds.set(guildId, joinPromise);
  try {
    return await joinPromise;
  } finally {
    joiningGuilds.delete(guildId);
  }
}

/**
 * Internal join implementation. Callers must go through join() which
 * deduplicates concurrent attempts for the same guild.
 */
async function _joinImpl(voiceChannel, textChannel) {
  const guildId = voiceChannel.guild.id;

  const timeout = config.voiceConnectTimeout;
  const maxRetries = config.voiceConnectRetries;

  let connection = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Ensure no stale connection lingers in the @discordjs/voice registry
    // before creating a fresh one (prevents "already destroyed" races).
    const existing = getVoiceConnection(guildId);
    if (existing) {
      try { existing.destroy(); } catch { /* already destroyed */ }
    }

    connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: false,
      debug: true,
    });

    // Forward voice connection debug messages so networking issues are visible
    connection.on('debug', (msg) => logger.info(`[voice:${guildId}] ${msg}`));

    // Wait for the voice connection to be ready before allowing playback.
    // Without this, audio resources played immediately after joining may be
    // silently dropped because the connection has not finished signalling.
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, timeout);
      break; // Connection is ready
    } catch (err) {
      try { connection.destroy(); } catch { /* already destroyed */ }
      if (attempt < maxRetries) {
        logger.warn(
          `Voice connection attempt ${attempt}/${maxRetries} failed after ${timeout}ms: ${err.message}. Retrying…`
        );
        // Brief pause so Discord can process the disconnect before we retry.
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      } else {
        throw new Error(
          `Voice connection did not become ready after ${maxRetries} attempts (${timeout}ms each).`
        );
      }
    }
  }

  const audioPlayer = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
  });

  connection.subscribe(audioPlayer);

  let state = {
    connection,
    player: audioPlayer,
    volume: config.defaultVolume,
    textChannel,
    playing: false,
    /** Set by stop() to suppress Idle auto-advance */
    stopped: false,
    /** Set while TTS is playing so the persistent Idle handler doesn't auto-advance */
    ttsActive: false,
    /** Mood mode – plays a temporary queue without touching the persistent playlist */
    moodMode: false,
    /** @type {Array<{id:string,url:string,title:string,duration:string}>} */
    moodQueue: [],
    moodIndex: 0,
    moodStyle: null,
    /** Called when the mood queue finishes; async () => void */
    onMoodEnd: null,
    /** Cleanup function for the current song's temp file (if downloaded locally) */
    cleanupCurrentSong: null,
  };

  state._songUnavailableListener = async (song, gid, textChannel) => {
    if (!textChannel) return;
    try {
      const findCmd = require('./commands/find');
      const fakeMessage = {
        author: { id: 'system', bot: false },
        guild: textChannel.guild,
        channel: textChannel,
        member: null,
        reply: (t) => textChannel.send(t),
        content: `${config.prefix} find ${song.title}`,
      };
      await textChannel.send(
        `🔍 Searching for an alternative to **${song.title}**…`
      );
      await findCmd.execute({
        message: fakeMessage,
        guildId: gid,
        match: [null, song.title],
      });
    } catch (err) {
      logger.error('songUnavailable handler failed', err);
    }
  };
  state.player.on('songUnavailable', state._songUnavailableListener);

  guildStates.set(guildId, state);

  // Notify listeners (e.g. the speech recognizer) that a new voice connection
  // is ready.  This fires after the state is fully registered so that
  // getState(guildId) is guaranteed to return a valid state in the handler.
  playerEmitter.emit('joined', { connection, guild: voiceChannel.guild });

  // ── Player lifecycle ──────────────────────────────────────────────────────

  audioPlayer.on(AudioPlayerStatus.Idle, () => {
    // TTS ended – its own once() cleanup handles the resume; don't advance here
    if (state.ttsActive) return;

    state.playing = false;

    // Clean up any locally downloaded temp file for the song that just finished
    if (typeof state.cleanupCurrentSong === 'function') {
      state.cleanupCurrentSong();
      state.cleanupCurrentSong = null;
    }

    // Explicit stop – don't auto-advance
    if (state.stopped) return;

    // ── Mood mode advance ───────────────────────────────────────────────────
    if (state.moodMode) {
      state.moodIndex++;
      if (state.moodIndex >= state.moodQueue.length) {
        // Mood playlist finished
        state.moodMode = false;
        state.stopped = true; // Pause auto-play while user decides what to do next
        if (typeof state.onMoodEnd === 'function') {
          state.onMoodEnd().catch((err) =>
            logger.error(`onMoodEnd callback failed for guild ${guildId}`, err)
          );
        }
      } else {
        playCurrentSong(guildId).catch((err) =>
          logger.error(`Mood auto-advance failed for guild ${guildId}`, err)
        );
      }
      return;
    }

    // ── Persistent playlist advance ────────────────────────────────────────
    if (!playlist.isEmpty()) {
      const { song, looped } = playlist.advanceWithLoop();
      if (looped && state.textChannel) {
        state.textChannel
          .send('🔀 Playlist complete! Shuffling and starting over…')
          .catch(() => {});
      }
      if (song) {
        playCurrentSong(guildId).catch((err) =>
          logger.error(`Auto-advance failed for guild ${guildId}`, err)
        );
      }
    }
  });

  audioPlayer.on('error', async (err) => {
    logger.error(`Audio player error in guild ${guildId}`, err);

    // Clean up any locally downloaded temp file for the failed song
    if (typeof state.cleanupCurrentSong === 'function') {
      state.cleanupCurrentSong();
      state.cleanupCurrentSong = null;
    }

    const currentSong = state.moodMode
      ? state.moodQueue[state.moodIndex]
      : playlist.current;
    if (state.textChannel) {
      await state.textChannel
        .send(`⚠️ Could not play **${currentSong?.title || 'unknown song'}**. Skipping…`)
        .catch(() => {});
    }
    // Skip broken song in the appropriate queue
    if (state.moodMode) {
      state.moodIndex++;
      if (state.moodIndex < state.moodQueue.length) {
        playCurrentSong(guildId).catch((e) =>
          logger.error(`Mood recovery advance failed for guild ${guildId}`, e)
        );
      }
    } else if (!playlist.isEmpty()) {
      const { song } = playlist.advanceWithLoop();
      if (song) {
        playCurrentSong(guildId).catch((e) =>
          logger.error(`Recovery advance failed for guild ${guildId}`, e)
        );
      }
    }
  });

  // Disconnect cleanup – attempt automatic reconnection.
  // When Discord moves the bot (e.g. server region change) the connection
  // transitions to Disconnected and then to Signalling/Connecting.
  // We give it time to finish that transition; if it never reaches Ready
  // we tear it down so the next summon creates a clean connection.
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      // Connection is attempting to reconnect – wait for Ready
      await entersState(connection, VoiceConnectionStatus.Ready, config.voiceConnectTimeout);
    } catch {
      // Could not reconnect – destroy so the next join() starts fresh
      try { connection.destroy(); } catch { /* already destroyed */ }
      guildStates.delete(guildId);
    }
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    guildStates.delete(guildId);
  });

  return state;
}

/**
 * Return the current guild state (or undefined).
 * @param {string} guildId
 * @returns {GuildPlayerState|undefined}
 */
function getState(guildId) {
  return guildStates.get(guildId);
}

/**
 * Disconnect and destroy the voice connection for a guild.
 * @param {string} guildId
 */
function leave(guildId) {
  const state = guildStates.get(guildId);
  if (state) {
    state.player.stop(true);
    // Clean up any locally downloaded temp file
    if (typeof state.cleanupCurrentSong === 'function') {
      state.cleanupCurrentSong();
      state.cleanupCurrentSong = null;
    }
    state.connection.destroy();
    guildStates.delete(guildId);
  }
}

// ─── Playback ──────────────────────────────────────────────────────────────

/**
 * Stream and play the current song in the given guild.
 * Reads from the mood queue when in mood mode, otherwise from the persistent playlist.
 * @param {string} guildId
 * @returns {Promise<void>}
 */
async function playCurrentSong(guildId) {
  const state = guildStates.get(guildId);
  if (!state) return;

  const song = state.moodMode
    ? state.moodQueue[state.moodIndex]
    : playlist.current;

  if (!song) {
    logger.info(`No current song for guild ${guildId}`);
    return;
  }

  try {
    // Validate availability (only for persistent playlist songs; mood queue skips unavailable).
    // Skip play-dl validation for YouTube URLs when yt-dlp is available because
    // play-dl's video_info() is unreliable for YouTube (returns "Invalid URL"
    // due to YouTube API changes).  yt-dlp handles these URLs correctly.
    const isYouTubeUrl = ytdlp.isYouTubeUrl(song.url);
    if (!state.moodMode && (!isYouTubeUrl || !ytdlp.isAvailable())) {
      const info = await play.video_info(song.url).catch(() => null);
      if (!info) {
        if (state.textChannel) {
          await state.textChannel.send(
            `⚠️ **${song.title}** is no longer available on YouTube. Searching for an alternative…`
          );
        }
        // 'songUnavailable' is a custom event emitted on the AudioPlayer so the
        // listener registered in join() can trigger a find-command search.
        // Node.js EventEmitter supports arbitrary custom event names.
        state.player.emit('songUnavailable', song, guildId, state.textChannel);
        playlist.advance();
        return;
      }
    }

    let stream;
    // ── Primary: yt-dlp with local file caching ────────────────────────────
    // Download the audio to a persistent local cache (data/music/) first,
    // then stream it to Discord.  Cached files are kept for reuse so
    // subsequent plays of the same song skip the download entirely.
    // downloadToFile() checks the cache before requiring yt-dlp, so cached
    // songs still play even if yt-dlp becomes unavailable later.
    if (isYouTubeUrl) {
      try {
        if (state.textChannel) {
          await state.textChannel
            .send(`⏳ Buffering **${song.title}**…`)
            .catch(() => {});
        }
        const { filePath, streamType, cleanup } = await ytdlp.downloadToFile(song.url, song.id);
        state.cleanupCurrentSong = cleanup;
        stream = { stream: fs.createReadStream(filePath), type: streamType };
        logger.info(`[player] Playing from local cache via yt-dlp: ${filePath}`);
      } catch (ytdlpErr) {
        logger.warn(`[player] yt-dlp download failed, falling back to yt-dlp stream: ${ytdlpErr.message}`);
        state.cleanupCurrentSong = null;

        // ── Secondary yt-dlp attempt: direct streaming (no local file) ──
        // downloadToFile may fail for reasons unrelated to format availability
        // (e.g. disk I/O, post-processing). createStream uses a different
        // pipeline so it may still succeed.
        try {
          stream = ytdlp.createStream(song.url);
          logger.info(`[player] Streaming directly via yt-dlp: ${song.url}`);
        } catch (streamErr) {
          logger.warn(`[player] yt-dlp stream also failed, falling back to play-dl: ${streamErr.message}`);
        }
      }
    }

    // ── Fallback: play-dl (works for non-YouTube sources; try all quality levels) ──
    if (!stream) {
      const qualityAttempts = [{ quality: 2 }, { quality: 1 }, { quality: 0 }, null];
      let lastStreamErr;
      for (const opts of qualityAttempts) {
        try {
          stream = opts ? await play.stream(song.url, opts) : await play.stream(song.url);
          logger.info(`[player] Streaming via play-dl (opts=${JSON.stringify(opts)}): ${song.url}`);
          break;
        } catch (streamErr) {
          lastStreamErr = streamErr;
          // Only retry on "Invalid URL" – propagate other errors immediately.
          if (!(streamErr instanceof TypeError && streamErr.message === 'Invalid URL')) {
            throw streamErr;
          }
        }
      }
      if (!stream) throw lastStreamErr;
    }

    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
      inlineVolume: true,
    });
    resource.volume?.setVolume(state.volume);

    state.player.play(resource);
    state.playing = true;

    if (state.textChannel) {
      const moodTag = state.moodMode ? ` *(mood: ${state.moodStyle})*` : '';
      await deleteBotMessages(state.textChannel, { limit: 25 }).catch(() => {});
      await state.textChannel.send(
        `🎵 Now playing: **${song.title}** (${song.duration})${moodTag}`
      );
    }

    // ── Pre-cache the next song ────────────────────────────────────────────
    preCacheNextSong(guildId).catch((err) =>
      logger.warn(`[player] Pre-cache failed: ${err.message}`)
    );
  } catch (err) {
    logger.error(`Failed to play ${song.url} in guild ${guildId}`, err);
    if (state.textChannel) {
      await state.textChannel
        .send(`⚠️ Error playing **${song.title}**. Skipping…`)
        .catch(() => {});
    }

    if (state.moodMode) {
      // Advance the mood queue index and continue if more songs remain.
      state.moodIndex++;
      if (state.moodIndex < state.moodQueue.length) {
        playCurrentSong(guildId).catch((e) =>
          logger.error(`Retry play failed for guild ${guildId}`, e)
        );
      }
    } else {
      const failedId = song.id;
      playlist.advance();
      // If advancing loops back to the same failing song (e.g. single-song
      // playlist), remove it so we don't retry the same broken track forever.
      if (playlist.current?.id === failedId) {
        playlist.removeCurrent();
        state.textChannel
          ?.send(`🗑️ Removed **${song.title}** from the playlist (unplayable).`)
          .catch(() => {});
      }
      if (!playlist.isEmpty()) {
        playCurrentSong(guildId).catch((e) =>
          logger.error(`Retry play failed for guild ${guildId}`, e)
        );
      }
    }
  }
}

// ─── Pre-caching ───────────────────────────────────────────────────────────

/**
 * Pre-cache the next song in the queue so playback transitions are seamless.
 * Downloads the audio file in the background while the current song is playing.
 * Only applies to YouTube URLs when yt-dlp is available.
 * @param {string} guildId
 */
async function preCacheNextSong(guildId) {
  const state = guildStates.get(guildId);
  if (!state) return;

  let nextSong;
  if (state.moodMode) {
    const nextIdx = state.moodIndex + 1;
    nextSong = nextIdx < state.moodQueue.length ? state.moodQueue[nextIdx] : null;
  } else {
    nextSong = playlist.next;
  }

  if (!nextSong) return;

  // Only pre-cache YouTube URLs via yt-dlp's file download
  if (!ytdlp.isYouTubeUrl(nextSong.url) || !ytdlp.isAvailable()) return;

  // downloadToFile will return immediately on cache hit, or download in background
  try {
    await ytdlp.downloadToFile(nextSong.url, nextSong.id);
    logger.info(`[player] Pre-cached next song: ${nextSong.title}`);
  } catch (err) {
    // Pre-cache failures are non-critical – the song will be fetched on demand
    logger.warn(`[player] Pre-cache of "${nextSong.title}" failed: ${err.message}`);
  }
}

/**
 * Start playback if not already playing.
 * @param {string} guildId
 */
async function startIfIdle(guildId) {
  const state = guildStates.get(guildId);
  if (!state) return;
  if (state.player.state.status === AudioPlayerStatus.Idle && !playlist.isEmpty()) {
    await playCurrentSong(guildId);
  }
}

/**
 * Skip the currently playing song.
 * @param {string} guildId
 */
function skip(guildId) {
  const state = guildStates.get(guildId);
  if (!state) return;
  // Stopping triggers the Idle handler which auto-advances
  state.player.stop();
}

/**
 * Set the volume for the current resource.
 * @param {string} guildId
 * @param {number} volume  0.0 – 1.0
 */
function setVolume(guildId, volume) {
  const state = guildStates.get(guildId);
  if (!state) return;
  const clamped = Math.min(1.0, Math.max(0.0, volume));
  state.volume = clamped;

  // Apply to the currently playing resource if it supports inline volume
  const playerState = state.player.state;
  if (playerState.status !== AudioPlayerStatus.Idle && playerState.resource?.volume) {
    playerState.resource.volume.setVolume(clamped);
  }
}

// ─── TTS Playback ──────────────────────────────────────────────────────────

/**
 * Say something via TTS in the voice channel.
 * Sets ttsActive=true while TTS is playing so the persistent Idle handler
 * does not auto-advance the playlist (fixes the double-advance bug).
 * @param {string} guildId
 * @param {string} text
 */
async function speak(guildId, text) {
  const state = guildStates.get(guildId);
  if (!state) return;

  let ttsFile = null;
  try {
    ttsFile = await tts.generateSpeech(text);

    const resource = createAudioResource(fs.createReadStream(ttsFile), {
      inputType: StreamType.Arbitrary,
      inlineVolume: true,
    });
    resource.volume?.setVolume(state.volume);

    const wasPlaying = state.player.state.status === AudioPlayerStatus.Playing;
    // Snapshot current song (mood-aware) so we can resume correctly
    const currentSong = state.moodMode
      ? state.moodQueue[state.moodIndex]
      : playlist.current;

    // Signal to the Idle handler that this is TTS – don't auto-advance
    state.ttsActive = true;
    state.player.play(resource);

    const cleanup = () => {
      state.ttsActive = false;
      tts.cleanupSpeech(ttsFile);
      ttsFile = null;
      if (!wasPlaying || !currentSong) return;
      // Only resume if the same song is still current (not skipped while TTS played)
      const stillCurrent = state.moodMode
        ? state.moodQueue[state.moodIndex]?.id === currentSong.id
        : playlist.current?.id === currentSong.id;
      if (stillCurrent) {
        playCurrentSong(guildId).catch((err) =>
          logger.error(`TTS resume failed for guild ${guildId}`, err)
        );
      }
    };

    state.player.once(AudioPlayerStatus.Idle, cleanup);
  } catch (err) {
    if (state) state.ttsActive = false;
    logger.error(`TTS generation failed for guild ${guildId}`, err);
    if (ttsFile) tts.cleanupSpeech(ttsFile);
  }
}

function createBeepWav({
  durationMs = 140,
  frequency = 880,
  sampleRate = 48_000,
  volume = 0.12,
} = {}) {
  const sampleCount = Math.max(1, Math.floor((sampleRate * durationMs) / MS_PER_SECOND));
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  const fadeSamples = Math.max(1, Math.floor(sampleRate * BEEP_FADE_SECONDS));
  for (let i = 0; i < sampleCount; i++) {
    const fadeIn = Math.min(1, i / fadeSamples);
    const fadeOut = Math.min(1, (sampleCount - i) / fadeSamples);
    const envelope = Math.min(fadeIn, fadeOut);
    const sample = Math.round(
      Math.sin((2 * Math.PI * frequency * i) / sampleRate) *
      32767 *
      volume *
      envelope
    );
    buffer.writeInt16LE(sample, 44 + (i * 2));
  }

  return buffer;
}

async function playBeep(guildId) {
  const state = guildStates.get(guildId);
  if (!state) return;

  const resource = createAudioResource(Readable.from(createBeepWav()), {
    inputType: StreamType.Arbitrary,
    inlineVolume: true,
  });
  resource.volume?.setVolume(Math.min(state.volume, 0.35));

  const wasPlaying = state.player.state.status === AudioPlayerStatus.Playing;
  const currentSong = state.moodMode
    ? state.moodQueue[state.moodIndex]
    : playlist.current;

  state.ttsActive = true;
  state.player.play(resource);

  const cleanup = () => {
    state.ttsActive = false;
    if (!wasPlaying || !currentSong) return;
    const stillCurrent = state.moodMode
      ? state.moodQueue[state.moodIndex]?.id === currentSong.id
      : playlist.current?.id === currentSong.id;
    if (stillCurrent) {
      playCurrentSong(guildId).catch((err) =>
        logger.error(`Wake-word beep resume failed for guild ${guildId}`, err)
      );
    }
  };

  state.player.once(AudioPlayerStatus.Idle, cleanup);
}

// ─── Mood mode ─────────────────────────────────────────────────────────────

/**
 * Enter mood mode: play a temporary song queue without touching the persistent playlist.
 * @param {string} guildId
 * @param {Array<{id:string,url:string,title:string,duration:string}>} songs
 * @param {string} style  Human-readable music style label
 * @param {()=>Promise<void>} onMoodEnd  Async callback invoked when the queue ends
 */
function startMoodMode(guildId, songs, style, onMoodEnd) {
  const state = guildStates.get(guildId);
  if (!state) return;
  state.moodMode = true;
  state.moodQueue = songs;
  state.moodIndex = 0;
  state.moodStyle = style;
  state.onMoodEnd = onMoodEnd;
  state.stopped = false;
  playCurrentSong(guildId).catch((err) =>
    logger.error(`startMoodMode initial play failed for guild ${guildId}`, err)
  );
}

/**
 * Exit mood mode and return to the persistent playlist.
 * Clears the stopped flag so startIfIdle() can resume normal playback.
 * @param {string} guildId
 */
function exitMoodMode(guildId) {
  const state = guildStates.get(guildId);
  if (!state) return;
  state.moodMode = false;
  state.moodQueue = [];
  state.moodIndex = 0;
  state.moodStyle = null;
  state.onMoodEnd = null;
  state.stopped = false;
}

/**
 * Go back to the previous song and restart playback from it.
 * @param {string} guildId
 */
async function previous(guildId) {
  const state = guildStates.get(guildId);
  if (!state) return;
  // Mood mode: step back in mood queue
  if (state.moodMode) {
    state.moodIndex = Math.max(0, state.moodIndex - 1);
  } else {
    playlist.previous();
  }
  // Set stopped=true BEFORE stop(true) so the synchronous Idle handler
  // does not auto-advance the playlist.  Reset to false immediately after
  // so that playCurrentSong (and future Idle transitions) can proceed normally.
  state.stopped = true;
  state.player.stop(true);
  state.stopped = false;
  await playCurrentSong(guildId);
}

// ─── Stop / Pause / Resume ─────────────────────────────────────────────────

async function resume(guildId) {
  const state = guildStates.get(guildId);
  if (!state) return;

  const status = state.player.state.status;

  if (status === AudioPlayerStatus.Paused || status === AudioPlayerStatus.AutoPaused) {
    state.player.unpause();
  } else if (state.stopped) {
    state.stopped = false;
    await playCurrentSong(guildId);
  }
}

/**
 * Stop playback entirely without advancing the playlist.
 * The current song is preserved so it can be resumed later.
 * @param {string} guildId
 */
function stop(guildId) {
  const state = guildStates.get(guildId);
  if (!state) return;
  state.stopped = true;
  // force=true prevents the Idle event from firing a new song
  state.player.stop(true);
  state.playing = false;
}

/**
 * Pause the currently playing song mid-stream.
 * @param {string} guildId
 * @returns {boolean} true if the player was successfully paused.
 */
function pause(guildId) {
  const state = guildStates.get(guildId);
  if (!state) return false;
  return state.player.pause();
}

module.exports = {
  join,
  leave,
  getState,
  playCurrentSong,
  startIfIdle,
  skip,
  stop,
  pause,
  resume,
  previous,
  setVolume,
  speak,
  playBeep,
  startMoodMode,
  exitMoodMode,
  on: playerEmitter.on.bind(playerEmitter),
  off: playerEmitter.off.bind(playerEmitter),
};
