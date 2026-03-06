'use strict';

const { spawnSync } = require('child_process');
const config = require('./config');
const logger = require('./logger');
const { client } = require('./bot');

logger.info('Starting Tiffany Discord Bot…');

// ─── FFmpeg startup check ──────────────────────────────────────────────────
// @discordjs/voice uses prism-media to transcode audio streams via FFmpeg.
// Without a working FFmpeg the bot will connect to voice but produce no audio
// (Discord shows the bot as muted / "onhoorbaar gemaakt").
// prism-media checks ffmpeg-static first, then falls back to the system binary.
(function checkFfmpeg() {
  const candidates = [];
  try {
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic) candidates.unshift(ffmpegStatic);
  } catch {
    // ffmpeg-static not available
  }
  candidates.push('ffmpeg');

  for (const cmd of candidates) {
    try {
      const result = spawnSync(cmd, ['-version'], { windowsHide: true, timeout: 2000 });
      if (!result.error && result.status === 0) {
        logger.info(`FFmpeg ready (${cmd})`);
        return;
      }
    } catch {
      // try next candidate
    }
  }

  logger.warn(
    'FFmpeg not found – the bot will be unable to transcode audio and will appear muted in Discord. ' +
    'On Linux/Docker: sudo apt-get install ffmpeg. ' +
    'On Windows: download from https://ffmpeg.org/download.html and add to PATH.'
  );
}());

client.login(config.token).catch((err) => {
  logger.error('Failed to log in to Discord', err);
  process.exit(1);
});
