'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./logger');

const PLAYLIST_FILE = path.join(config.dataDir, 'playlist.json');

/**
 * @typedef {Object} Song
 * @property {string} id        - YouTube video ID
 * @property {string} url       - Full YouTube watch URL
 * @property {string} title     - Video title
 * @property {string} duration  - Human-readable duration (e.g. "3:45")
 * @property {string} addedAt   - ISO timestamp when queued
 */

class Playlist {
  constructor() {
    /** @type {Song[]} */
    this.songs = [];
    /** @type {number} Index of the currently playing song */
    this.currentIndex = 0;
    this._load();
  }

  // ─── Persistence ──────────────────────────────────────────────────────────

  _load() {
    try {
      if (fs.existsSync(PLAYLIST_FILE)) {
        const raw = fs.readFileSync(PLAYLIST_FILE, 'utf8');
        const data = JSON.parse(raw);
        this.songs = Array.isArray(data.songs) ? data.songs : [];
        this.currentIndex = typeof data.currentIndex === 'number' ? data.currentIndex : 0;
        // Guard against out-of-bound index after manual edits
        if (this.currentIndex >= this.songs.length) {
          this.currentIndex = 0;
        }
        logger.info(`Playlist loaded: ${this.songs.length} songs, starting at index ${this.currentIndex}`);
      }
    } catch (err) {
      logger.error('Failed to load playlist', err);
      this.songs = [];
      this.currentIndex = 0;
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(PLAYLIST_FILE), { recursive: true });
      fs.writeFileSync(
        PLAYLIST_FILE,
        JSON.stringify({ songs: this.songs, currentIndex: this.currentIndex }, null, 2),
        'utf8'
      );
    } catch (err) {
      logger.error('Failed to save playlist', err);
    }
  }

  // ─── Read helpers ──────────────────────────────────────────────────────────

  /** @returns {Song|null} */
  get current() {
    return this.songs[this.currentIndex] || null;
  }

  /** @returns {Song|null} The next song that will play (without advancing). */
  get next() {
    if (this.songs.length === 0) return null;
    const nextIndex = (this.currentIndex + 1) % this.songs.length;
    return this.songs[nextIndex] || null;
  }

  get length() {
    return this.songs.length;
  }

  isEmpty() {
    return this.songs.length === 0;
  }

  // ─── Mutations ─────────────────────────────────────────────────────────────

  /**
   * Add a song to play next in the playlist.
   * @param {Omit<Song, 'addedAt'>} song
   */
  add(song) {
    const songWithTimestamp = { ...song, addedAt: new Date().toISOString() };
    if (this.songs.length === 0) {
      this.songs.push(songWithTimestamp);
    } else {
      const insertAt = Math.min(this.currentIndex + 1, this.songs.length);
      this.songs.splice(insertAt, 0, songWithTimestamp);
    }
    this._save();
  }

  /**
   * Add multiple songs at once (e.g. from a YouTube playlist).
   * @param {Omit<Song, 'addedAt'>[]} songs
   */
  addMany(songs) {
    const now = new Date().toISOString();
    for (const song of songs) {
      this.songs.push({ ...song, addedAt: now });
    }
    this._save();
  }

  /**
   * Remove the song at the given index.
   * Adjusts currentIndex so playback continues correctly.
   * @param {number} index
   * @returns {Song|null} The removed song, or null if index is invalid.
   */
  removeAt(index) {
    if (index < 0 || index >= this.songs.length) return null;
    const [removed] = this.songs.splice(index, 1);
    // If we removed a song before the current position, shift index back
    if (index < this.currentIndex) {
      this.currentIndex = Math.max(0, this.currentIndex - 1);
    } else if (index === this.currentIndex) {
      // Stay at same index (next song slides into this slot), but clamp
      this.currentIndex = Math.min(this.currentIndex, this.songs.length - 1);
      if (this.currentIndex < 0) this.currentIndex = 0;
    }
    this._save();
    return removed;
  }

  /**
   * Remove the currently playing song.
   * @returns {Song|null}
   */
  removeCurrent() {
    return this.removeAt(this.currentIndex);
  }

  /**
   * Advance to the next song (wraps around).
   * @returns {Song|null} The new current song.
   */
  advance() {
    if (this.songs.length === 0) return null;
    this.currentIndex = (this.currentIndex + 1) % this.songs.length;
    this._save();
    return this.current;
  }

  /**
   * Advance to the next song and detect when the playlist wraps around.
   * When a full loop completes the playlist is shuffled in-place and
   * currentIndex resets to 0 so the next run starts in a fresh random order.
   *
   * @returns {{ song: Song|null, looped: boolean }}
   *   `looped` is true when the playlist just completed a full cycle.
   */
  advanceWithLoop() {
    if (this.songs.length === 0) return { song: null, looped: false };

    const isLast = this.currentIndex === this.songs.length - 1;
    this.currentIndex = (this.currentIndex + 1) % this.songs.length;

    if (isLast) {
      // _shuffleInPlace resets currentIndex to 0 and saves
      this._shuffleInPlace();
    } else {
      this._save();
    }

    return { song: this.current, looped: isLast };
  }

  /**
   * Shuffle the songs array in-place using Fisher-Yates and reset to index 0.
   * @private
   */
  _shuffleInPlace() {
    for (let i = this.songs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.songs[i], this.songs[j]] = [this.songs[j], this.songs[i]];
    }
    this.currentIndex = 0;
    this._save();
  }

  /**
   * Go back to the previous song (wraps around to the last song).
   * @returns {Song|null}
   */
  previous() {
    if (this.songs.length === 0) return null;
    this.currentIndex = (this.currentIndex - 1 + this.songs.length) % this.songs.length;
    this._save();
    return this.current;
  }

  /**
   * Shuffle the playlist on demand.
   * The currently playing song is moved to the front (index 0) so the stream
   * is not interrupted – the next song after it will be a random pick.
   */
  shuffle() {
    if (this.songs.length <= 1) return;
    const currentSong = this.current;
    // Fisher-Yates shuffle of the whole array
    for (let i = this.songs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.songs[i], this.songs[j]] = [this.songs[j], this.songs[i]];
    }
    // Restore the current song to position 0 so playback continues from it
    if (currentSong) {
      const newIdx = this.songs.findIndex((s) => s.id === currentSong.id);
      if (newIdx > 0) {
        this.songs.splice(newIdx, 1);
        this.songs.unshift(currentSong);
      }
    }
    this.currentIndex = 0;
    this._save();
  }

  /**
   * Remove all songs from the playlist.
   */
  clear() {
    this.songs = [];
    this.currentIndex = 0;
    this._save();
  }

  /**
   * Move the song with the given ID to play next (right after the current song).
   * If the song is already the current or the immediately next song, it is left
   * in place. Adjusts currentIndex when the removed song was before it.
   *
   * @param {string} id  YouTube video ID
   * @returns {{ song: Song, alreadyCurrent: boolean }|null}
   *   null when the ID is not found in the playlist.
   */
  moveToNext(id) {
    const fromIdx = this.songs.findIndex((s) => s.id === id);
    if (fromIdx === -1) return null;

    // Song is currently playing – leave it alone
    if (fromIdx === this.currentIndex) {
      return { song: this.songs[fromIdx], alreadyCurrent: true };
    }

    // Song is already the very next one – nothing to do
    if (fromIdx === this.currentIndex + 1) {
      return { song: this.songs[fromIdx], alreadyCurrent: false };
    }

    // Remove from current position
    const [song] = this.songs.splice(fromIdx, 1);

    // If the removed song was before the current index, the current shifts back
    if (fromIdx < this.currentIndex) {
      this.currentIndex = Math.max(0, this.currentIndex - 1);
    }

    // Insert right after the current song
    const insertAt = Math.min(this.currentIndex + 1, this.songs.length);
    this.songs.splice(insertAt, 0, song);

    this._save();
    return { song, alreadyCurrent: false };
  }

  /**
   * Check whether a YouTube video ID is already in the playlist.
   * @param {string} id
   * @returns {boolean}
   */
  has(id) {
    return this.songs.some((s) => s.id === id);
  }

  /**
   * Return a display-friendly numbered list (up to maxItems).
   * @param {number} [maxItems=10]
   * @returns {string}
   */
  toDisplayString(maxItems = 10) {
    if (this.songs.length === 0) return '*(empty playlist)*';
    return this.songs
      .slice(0, maxItems)
      .map((s, i) => {
        const marker = i === this.currentIndex ? '▶ ' : '   ';
        return `${marker}${i + 1}. ${s.title} (${s.duration})`;
      })
      .join('\n');
  }
}

module.exports = new Playlist();
