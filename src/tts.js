'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./logger');

const TTS_DIR = path.join(config.dataDir, 'tts');

/** Ensure the TTS temp directory exists */
function ensureTtsDir() {
  fs.mkdirSync(TTS_DIR, { recursive: true });
}

// ─── Platform-specific generators ───────────────────────────────────────────

/**
 * Windows: use PowerShell + System.Speech.Synthesis.SpeechSynthesizer.
 * Text and paths are passed via environment variables to avoid any
 * shell-escaping issues.
 */
function generateSpeechWindows(text, voice, filePath) {
  return new Promise((resolve, reject) => {
    const script = [
      'Add-Type -AssemblyName System.Speech;',
      '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
      'if ($env:TTS_VOICE) { $synth.SelectVoice($env:TTS_VOICE) };',
      '$synth.SetOutputToWaveFile($env:TTS_OUT_PATH);',
      '$synth.Speak($env:TTS_TEXT);',
      '$synth.Dispose();',
    ].join(' ');

    const env = { ...process.env, TTS_TEXT: text, TTS_OUT_PATH: filePath };
    if (voice) env.TTS_VOICE = voice;

    const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    if (result.error) {
      reject(result.error);
    } else if (result.status !== 0) {
      const stderr = result.stderr?.toString().trim() || '';
      reject(new Error(`PowerShell TTS failed (exit ${result.status}): ${stderr}`));
    } else {
      resolve(filePath);
    }
  });
}

/**
 * macOS: use the built-in `say` CLI.
 * Outputs WAV when the output file has a .wav extension and
 * --data-format is specified.
 */
function generateSpeechMacOS(text, voice, filePath) {
  return new Promise((resolve, reject) => {
    const args = [];
    if (voice) args.push('-v', voice);
    // LEI16@22050 gives a standard 16-bit little-endian WAV
    args.push('-o', filePath, '--data-format=LEI16@22050', text);

    const result = spawnSync('say', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.error) {
      reject(result.error);
    } else if (result.status !== 0) {
      const stderr = result.stderr?.toString().trim() || '';
      reject(new Error(`macOS say failed (exit ${result.status}): ${stderr}`));
    } else {
      resolve(filePath);
    }
  });
}

/**
 * Linux: use espeak-ng (preferred) or espeak.
 */
function generateSpeechLinux(text, voice, filePath) {
  return new Promise((resolve, reject) => {
    const args = ['-w', filePath];
    if (voice) args.push('-v', voice);
    args.push(text);

    // Try espeak-ng first, fall back to espeak
    const spawnOpts = { stdio: ['ignore', 'pipe', 'pipe'] };
    const espeak = spawnSync('espeak-ng', args, spawnOpts);
    const result = espeak.error?.code === 'ENOENT' ? spawnSync('espeak', args, spawnOpts) : espeak;

    if (result.error) {
      reject(result.error);
    } else if (result.status !== 0) {
      const stderr = result.stderr?.toString().trim() || '';
      reject(new Error(`espeak TTS failed (exit ${result.status}): ${stderr}`));
    } else {
      resolve(filePath);
    }
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate a TTS audio file from text and return the file path.
 * @param {string} text  Text to synthesize
 * @returns {Promise<string>} Path to the generated WAV file
 */
function generateSpeech(text) {
  ensureTtsDir();
  const filePath = path.join(TTS_DIR, `tts_${Date.now()}.wav`);
  const voice = config.ttsVoice || null;

  if (process.platform === 'win32') {
    return generateSpeechWindows(text, voice, filePath);
  } else if (process.platform === 'darwin') {
    return generateSpeechMacOS(text, voice, filePath);
  } else {
    return generateSpeechLinux(text, voice, filePath);
  }
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
