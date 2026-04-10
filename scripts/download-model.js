#!/usr/bin/env node
'use strict';

/**
 * Pre-download the Whisper speech recognition model.
 *
 * Run once before starting the bot:
 *   node scripts/download-model.js
 *
 * The model (~150 MB) is downloaded from Hugging Face and cached in:
 *   data/transformers-cache/
 *
 * It is entirely offline after this one-time download.
 * No API key or account is required.
 */

const path = require('path');

const { pipeline, env } = require('@xenova/transformers');

const DATA_DIR = path.resolve(
  process.env.DATA_DIR || path.join(__dirname, '..', 'data')
);

env.cacheDir = path.join(DATA_DIR, 'transformers-cache');

console.log('Downloading Whisper speech recognition model (Xenova/whisper-small.en)…');
console.log(`Cache directory: ${env.cacheDir}`);
console.log('This is a one-time ~150 MB download.\n');

(async () => {
  try {
    await pipeline('automatic-speech-recognition', 'Xenova/whisper-small.en');
    console.log('\n✅  Whisper model downloaded and cached successfully.');
    console.log('    Voice recognition is now available. Start the bot normally.');
    process.exit(0);
  } catch (err) {
    console.error(`\n❌  Failed to download Whisper model: ${err.message}`);
    process.exit(1);
  }
})();
