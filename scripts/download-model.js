#!/usr/bin/env node
'use strict';

/**
 * Download the small Vosk English speech recognition model.
 *
 * Run once before starting the bot:
 *   node scripts/download-model.js
 *
 * The model is ~45 MB and is saved to:
 *   data/vosk-model-small-en-us-0.15/
 *
 * It is entirely offline after this one-time download.
 * No API key or account is required.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MODEL_NAME = 'vosk-model-small-en-us-0.15';
const MODEL_URL = `https://alphacephei.com/vosk/models/${MODEL_NAME}.zip`;
const DATA_DIR = path.resolve(
  process.env.DATA_DIR || path.join(__dirname, '..', 'data')
);
const MODEL_DIR = path.join(DATA_DIR, MODEL_NAME);
const ZIP_PATH = path.join(DATA_DIR, `${MODEL_NAME}.zip`);

// ─── Already installed? ────────────────────────────────────────────────────

if (fs.existsSync(MODEL_DIR)) {
  console.log(`✅  Model already installed at ${MODEL_DIR}`);
  process.exit(0);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Download a URL to a local file, following redirects.
 * @param {string} url
 * @param {string} dest
 * @returns {Promise<void>}
 */
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    const get = (target) => {
      https
        .get(target, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            // Follow redirect
            res.resume();
            get(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} downloading ${target}`));
            return;
          }

          const total = parseInt(res.headers['content-length'] || '0', 10);
          let received = 0;
          let lastPct = -1;

          res.on('data', (chunk) => {
            received += chunk.length;
            if (total > 0) {
              const pct = Math.floor((received / total) * 100);
              if (pct !== lastPct && pct % 10 === 0) {
                process.stdout.write(`  ${pct}%\r`);
                lastPct = pct;
              }
            }
          });

          res.pipe(file);
          file.on('finish', () => {
            file.close();
            console.log('');
            resolve();
          });
        })
        .on('error', (err) => {
          fs.unlink(dest, () => {});
          reject(err);
        });
    };

    file.on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });

    get(url);
  });
}

/**
 * Extract a ZIP archive to a directory.
 * Uses the system `unzip` command on Linux/macOS, or PowerShell on Windows.
 * @param {string} zipPath
 * @param {string} destDir
 */
function extract(zipPath, destDir) {
  const platform = process.platform;
  if (platform === 'win32') {
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force"`,
      { stdio: 'inherit' }
    );
  } else {
    execSync(`unzip -q "${zipPath}" -d "${destDir}"`, { stdio: 'inherit' });
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

(async () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log(`Downloading Vosk speech model from:\n  ${MODEL_URL}\n`);

  try {
    await download(MODEL_URL, ZIP_PATH);
  } catch (err) {
    console.error(`❌  Download failed: ${err.message}`);
    process.exit(1);
  }

  console.log('Extracting…');
  try {
    extract(ZIP_PATH, DATA_DIR);
  } catch (err) {
    console.error(`❌  Extraction failed: ${err.message}`);
    console.error(
      `Please install \`unzip\` (Linux/macOS) or ensure PowerShell is available (Windows), ` +
        `then manually extract ${ZIP_PATH} to ${DATA_DIR}.`
    );
    process.exit(1);
  }

  // Clean up the ZIP after extraction
  try {
    fs.unlinkSync(ZIP_PATH);
  } catch {
    // Non-fatal – the model itself was extracted successfully
  }

  if (fs.existsSync(MODEL_DIR)) {
    console.log(`✅  Model installed at ${MODEL_DIR}`);
    console.log('Voice recognition is now available. Start the bot normally.');
  } else {
    console.error(`❌  Expected model directory not found after extraction: ${MODEL_DIR}`);
    process.exit(1);
  }
})();
