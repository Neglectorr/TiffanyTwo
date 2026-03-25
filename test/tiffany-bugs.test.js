'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function clearModule(relPath) {
  const absPath = path.join(ROOT, relPath);
  delete require.cache[require.resolve(absPath)];
}

function loadFresh(relPath) {
  clearModule('src/config.js');
  clearModule('src/logger.js');
  clearModule(relPath);
  return require(path.join(ROOT, relPath));
}

function withFreshEnv() {
  process.env.DISCORD_TOKEN = 'test-token';
  process.env.MESSAGE_DELETE_DELAY = '0';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tiffany-data-'));
}

test('playlist.add inserts new songs directly after the current song', () => {
  withFreshEnv();
  const playlist = loadFresh('src/playlist.js');

  playlist.clear();
  playlist.add({ id: 'a', url: 'https://example.com/a', title: 'Song A', duration: '1:00' });
  playlist.add({ id: 'b', url: 'https://example.com/b', title: 'Song B', duration: '1:00' });
  playlist.add({ id: 'c', url: 'https://example.com/c', title: 'Song C', duration: '1:00' });

  assert.deepEqual(
    playlist.songs.map((song) => song.id),
    ['a', 'c', 'b']
  );
  assert.equal(playlist.next.id, 'c');
});

test('voice wake-word parsing keeps supporting wake-only prompts', () => {
  withFreshEnv();
  const { extractAfterWakeWord } = loadFresh('src/voiceHandler.js');

  assert.equal(extractAfterWakeWord('hey tiffany'), '');
  assert.equal(extractAfterWakeWord('hey tiffany, louder'), 'louder');
  assert.equal(extractAfterWakeWord('random text'), null);
});

test('mood command accepts vibe aliases', () => {
  withFreshEnv();
  const mood = loadFresh('src/commands/mood.js');

  assert.equal('vibe rock'.match(mood.patterns[0])[1], 'rock');
  assert.equal('set the vibe to jazz'.match(mood.patterns[0])[1], 'jazz');
});

test('save track stores the current mood song in the regular playlist', async () => {
  withFreshEnv();
  const player = loadFresh('src/player.js');
  const playlist = loadFresh('src/playlist.js');
  const saveTrack = loadFresh('src/commands/saveTrack.js');

  const originalGetState = player.getState;
  const originalHas = playlist.has;
  const originalAdd = playlist.add;
  const originalMoveToNext = playlist.moveToNext;

  const savedSongs = [];
  player.getState = () => ({
    moodMode: true,
    moodIndex: 0,
    moodQueue: [
      { id: 'mood-1', url: 'https://example.com/mood-1', title: 'Mood Song', duration: '2:00' },
    ],
  });
  playlist.has = () => false;
  playlist.add = (song) => savedSongs.push(song);
  playlist.moveToNext = () => null;

  const sentMessages = [];
  const message = {
    channel: {
      send: async (text) => {
        sentMessages.push(text);
        return { delete: () => Promise.resolve() };
      },
    },
    reply: async () => {
      throw new Error('reply should not be used for a valid save-track request');
    },
  };

  try {
    await saveTrack.execute({ message, guildId: 'guild-1' });
  } finally {
    player.getState = originalGetState;
    playlist.has = originalHas;
    playlist.add = originalAdd;
    playlist.moveToNext = originalMoveToNext;
  }

  assert.equal(savedSongs.length, 1);
  assert.equal(savedSongs[0].id, 'mood-1');
  assert.match(sentMessages[0], /Saved \*\*Mood Song\*\* to the regular playlist/i);
});
