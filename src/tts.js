'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const say = require('say');
const config = require('./config');
const logger = require('./logger');

const TTS_DIR = path.join(config.dataDir, 'tts');

/** Ensure the TTS temp directory exists */
function ensureTtsDir() {
  fs.mkdirSync(TTS_DIR, { recursive: true });
}

/**
 * Generate a TTS audio file from text and return the file path.
 * @param {string} text  Text to synthesize
 * @returns {Promise<string>} Path to the generated WAV file
 */
function generateSpeech(text) {
  return new Promise((resolve, reject) => {
    ensureTtsDir();
    const filePath = path.join(TTS_DIR, `tts_${Date.now()}.wav`);
    const voice = config.ttsVoice || undefined;

    say.export(text, voice, 1.0, filePath, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(filePath);
      }
    });
  });
}

/**
 * Delete a TTS file after use.
 * @param {string} filePath
 */
function cleanupSpeech(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    logger.warn(`Failed to clean up TTS file ${filePath}: ${err.message}`);
  }
}

module.exports = { generateSpeech, cleanupSpeech };
