'use strict';

/**
 * yt-dlp integration for audio streaming.
 *
 * play-dl's stream() has become unreliable for YouTube (returns "Invalid URL"
 * for all quality levels due to YouTube API changes). yt-dlp is actively
 * maintained and supports the latest YouTube streaming formats.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, spawn } = require('child_process');
const { StreamType } = require('@discordjs/voice');
const logger = require('./logger');
const config = require('./config');

/** Cached path to yt-dlp binary, or null if not found. */
let _ytdlpPath = undefined; // undefined = not yet searched

/**
 * Find the yt-dlp binary on the system.
 * Checks common install locations in addition to PATH.
 * @returns {string|null} Absolute path or command name, or null if not found.
 */
function findYtDlp() {
  if (_ytdlpPath !== undefined) return _ytdlpPath;

  const candidates = [
    'yt-dlp',
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    // Linux/macOS pip user-install path
    ...(process.env.HOME ? [`${process.env.HOME}/.local/bin/yt-dlp`] : []),
    // Windows: check APPDATA and USERPROFILE locations
    ...(process.env.USERPROFILE
      ? [
          `${process.env.USERPROFILE}\\AppData\\Roaming\\Python\\Scripts\\yt-dlp.exe`,
          `${process.env.USERPROFILE}\\AppData\\Local\\Programs\\yt-dlp\\yt-dlp.exe`,
        ]
      : []),
  ];

  for (const candidate of candidates) {
    try {
      const result = spawnSync(candidate, ['--version'], {
        timeout: 5000,
        windowsHide: true,
      });
      if (!result.error && result.status === 0) {
        const version = result.stdout?.toString().trim();
        logger.info(`yt-dlp found at '${candidate}' (version ${version})`);
        _ytdlpPath = candidate;
        return _ytdlpPath;
      }
    } catch {
      // try next candidate
    }
  }

  logger.warn('yt-dlp not found. YouTube streaming will fall back to play-dl.');
  _ytdlpPath = null;
  return null;
}

/**
 * Returns true if yt-dlp is available on this system.
 * @returns {boolean}
 */
function isAvailable() {
  return findYtDlp() !== null;
}

/**
 * Reset the cached yt-dlp path (useful for testing).
 */
function resetCache() {
  _ytdlpPath = undefined;
}

/** Supported audio file extensions for cache lookup and output detection. */
const AUDIO_EXTENSIONS = ['mp3', 'opus', 'webm', 'm4a', 'mp4', 'ogg', 'flac', 'wav'];

/**
 * Return the persistent cache directory for downloaded audio files
 * and ensure it exists. Cached files live under `data/music/` (or
 * wherever DATA_DIR points) so the user can see them in the app folder.
 * @returns {string}
 */
function getCacheDir() {
  const dir = path.join(config.dataDir, 'music');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    logger.error(`[yt-dlp] Failed to create cache directory ${dir}: ${err.message}`);
    throw err;
  }
  return dir;
}

/**
 * Look for an already-cached audio file for the given video ID.
 * Returns the full path if found, or null otherwise.
 * @param {string} cacheDir
 * @param {string} videoId
 * @returns {string|null}
 */
function findCachedFile(cacheDir, videoId) {
  for (const ext of AUDIO_EXTENSIONS) {
    const candidate = path.join(cacheDir, `${videoId}.${ext}`);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Download audio from a URL to a local cached file using yt-dlp.
 *
 * This is the preferred playback method because it avoids piping issues and
 * format-mismatch silence that occur when streaming directly to Discord.
 * The caller receives a local file path.  Downloaded files are cached in
 * `data/music/` (keyed by video ID) so subsequent plays of the same song
 * skip the download entirely — matching the caching behaviour of the
 * original Tiffany bot.
 *
 * Audio is extracted with `-x --audio-format mp3` so the file is always a
 * clean MP3.  `StreamType.Arbitrary` tells @discordjs/voice to route it
 * through FFmpeg, which guarantees audible output regardless of container
 * quirks.
 *
 * @param {string} url      URL supported by yt-dlp (YouTube, SoundCloud, …)
 * @param {string} [videoId]  Optional video ID used as the cache key.
 * @returns {Promise<{filePath: string, streamType: string, cleanup: () => void}>}
 * @throws {Error} If yt-dlp is not available or the download fails.
 */
async function downloadToFile(url, videoId) {
  const cacheDir = getCacheDir();

  // ── Check cache first ────────────────────────────────────────────────────
  // Serve cached files even when yt-dlp is not (or no longer) installed.
  if (videoId) {
    const cached = findCachedFile(cacheDir, videoId);
    if (cached) {
      logger.info(`[yt-dlp] Cache hit – reusing ${cached}`);
      return { filePath: cached, streamType: StreamType.Arbitrary, cleanup: () => {} };
    }
  }

  const ytdlpPath = findYtDlp();
  if (!ytdlpPath) {
    throw new Error('yt-dlp is not installed. Cannot download audio.');
  }

  // ── Download & extract audio ─────────────────────────────────────────────
  const fileBase = videoId || `tiffany_${crypto.randomUUID()}`;
  const outputTemplate = path.join(cacheDir, `${fileBase}.%(ext)s`);

  const args = [
    '-x',                      // Extract audio from the container
    '--audio-format', 'mp3',   // Convert to MP3 (universal, always playable)
    '-f', 'bestaudio/best',    // Best audio-only; fall back to best combined format
    '--no-playlist',
    '-o', outputTemplate,
    '--quiet',
    '--no-warnings',
    '--no-cache-dir',          // Disable yt-dlp's internal cache (we cache in data/music/)
    url,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(ytdlpPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stderrBuf = '';
    proc.stderr?.on('data', (chunk) => {
      stderrBuf += chunk.toString();
    });

    proc.on('error', (err) => {
      logger.error(`[yt-dlp] Spawn error for ${url}`, err);
      reject(err);
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        if (stderrBuf.trim()) logger.warn(`[yt-dlp] ${stderrBuf.trim()}`);
        reject(new Error(`yt-dlp exited with code ${code}`));
        return;
      }

      // Search for the output file (yt-dlp fills in the real extension).
      let filePath = null;
      for (const ext of AUDIO_EXTENSIONS) {
        const candidate = path.join(cacheDir, `${fileBase}.${ext}`);
        if (fs.existsSync(candidate)) {
          filePath = candidate;
          break;
        }
      }

      if (!filePath) {
        reject(new Error('yt-dlp did not produce an output file'));
        return;
      }

      logger.info(`[yt-dlp] Downloaded ${url} → ${filePath}`);

      // Cached files are kept for reuse — cleanup is a no-op.
      resolve({ filePath, streamType: StreamType.Arbitrary, cleanup: () => {} });
    });
  });
}

/**
 * Create an audio stream for a YouTube (or other yt-dlp-supported) URL.
 *
 * Spawns yt-dlp with best-audio format and pipes raw audio bytes to stdout.
 * Uses StreamType.Arbitrary so @discordjs/voice always routes through FFmpeg,
 * avoiding silence caused by format-mismatch when the video has no WebM track.
 *
 * Prefer `downloadToFile` for more reliable playback; use this only when a
 * local temp file is not acceptable (e.g. very long streams).
 *
 * @param {string} url  YouTube URL (or any URL supported by yt-dlp)
 * @returns {{ stream: import('stream').Readable, type: string }}
 * @throws {Error} If yt-dlp is not available or fails to start.
 */
function createStream(url) {
  const ytdlpPath = findYtDlp();
  if (!ytdlpPath) {
    throw new Error('yt-dlp is not installed. Cannot create stream.');
  }

  const args = [
    // Prefer WebM/Opus but fall back to any available audio format.
    // Using StreamType.Arbitrary means FFmpeg handles decoding regardless of
    // the actual format, preventing the silence that occurred when only
    // bestaudio[ext=webm] was requested and no WebM track was available.
    '-f', 'bestaudio[ext=webm]/bestaudio/best',
    '--no-playlist',
    // Output raw audio bytes to stdout.
    '-o', '-',
    '--quiet',
    '--no-warnings',
    // Do not cache cookies; run as stateless as possible.
    '--no-cache-dir',
    url,
  ];

  const proc = spawn(ytdlpPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  // Log yt-dlp stderr at warn level (it typically contains warnings/errors).
  proc.stderr?.on('data', (chunk) => {
    const msg = chunk.toString().trim();
    if (msg) logger.warn(`[yt-dlp] ${msg}`);
  });

  // If the process errors at spawn time (e.g. binary not found), log it.
  proc.on('error', (err) => {
    logger.error(`[yt-dlp] Spawn error for ${url}`, err);
  });

  return {
    stream: proc.stdout,
    // Always use Arbitrary so FFmpeg handles the stream regardless of format.
    // This avoids silence when the video has no WebM audio-only track.
    type: StreamType.Arbitrary,
  };
}

/**
 * Returns true if the given URL is a YouTube (or YouTube Music) URL
 * that yt-dlp can handle.
 * @param {string} url
 * @returns {boolean}
 */
function isYouTubeUrl(url) {
  return /^https?:\/\/((www\.|music\.)?youtube\.com|youtu\.be)\//.test(url);
}

module.exports = { findYtDlp, isAvailable, resetCache, createStream, downloadToFile, isYouTubeUrl, getCacheDir };
