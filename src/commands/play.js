'use strict';

const { EmbedBuilder } = require('discord.js');
const play = require('play-dl');
const playlist = require('../playlist');
const player = require('../player');
const logger = require('../logger');
const config = require('../config');
const { deleteAfter } = require('../utils');

const YOUTUBE_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i;

/**
 * Tiffany play {youtube url}
 * Queues a specific YouTube video or (with confirmation) an entire playlist.
 *
 * Tiffany play   (no arguments)
 * Starts or resumes playback of the current playlist.  When the playlist
 * finishes it is automatically shuffled and replayed from the beginning.
 *
 * NOTE: The URL variant is text-only; vocal spelling of URLs is not supported.
 */
module.exports = {
  name: 'play',
  /** Text triggers – URL variant OR no-arg variant */
  patterns: [/^play\s+(https?:\/\/\S+)$/i, /^play$/i],
  /** Voice trigger – no-arg only (humans can't spell URLs) */
  voicePatterns: [/^play$/i],

  /**
   * @param {{ message: import('discord.js').Message, guildId: string, match: RegExpMatchArray }} ctx
   */
  async execute({ message, guildId, match }) {
    const url = match[1]?.trim();

    // ── No-arg: start / resume playlist playback ───────────────────────────
    if (!url) {
      if (playlist.isEmpty()) {
        return message.reply(
          'The playlist is empty. Use **Tiffany find** or **Tiffany play {url}** to add songs first.'
        );
      }

      const voiceChannel = message.member?.voice?.channel;
      if (!voiceChannel && !player.getState(guildId)) {
        return message.reply('You need to be in a voice channel for me to join.');
      }

      if (voiceChannel && !player.getState(guildId)) {
        await player.join(voiceChannel, message.channel);
      }

      await player.startIfIdle(guildId);
      const current = playlist.current;
      if (current) {
        await message.reply(`▶️ Playing playlist — current song: **${current.title}**`);
      }
      return;
    }

    if (!YOUTUBE_REGEX.test(url)) {
      return message.reply('❌ Please provide a valid YouTube URL.');
    }

    await message.channel.sendTyping().catch(() => {});

    const voiceChannel = message.member?.voice?.channel;

    // ── Detect playlist vs single video ────────────────────────────────────
    const isPlaylistUrl =
      url.includes('list=') &&
      !url.includes('index=') &&
      !url.includes('watch?v=');

    const hasListParam = url.includes('list=');
    const hasVideoId = url.includes('watch?v=') || url.includes('youtu.be/');

    if (hasListParam && hasVideoId) {
      // URL points to a specific video that is also part of a playlist
      await handleMixedUrl(url, message, guildId, voiceChannel);
    } else if (isPlaylistUrl || (hasListParam && !hasVideoId)) {
      await handlePlaylistUrl(url, message, guildId, voiceChannel);
    } else {
      await handleVideoUrl(url, message, guildId, voiceChannel);
    }
  },
};

// ─── URL handlers ──────────────────────────────────────────────────────────

/**
 * Handle a URL that is a playlist-only link.
 */
async function handlePlaylistUrl(url, message, guildId, voiceChannel) {
  let playlistInfo;
  try {
    playlistInfo = await play.playlist_info(url, { incomplete: true });
  } catch (err) {
    logger.error('Failed to fetch playlist info', err);
    return message.reply('❌ Could not fetch playlist info. Is the playlist public?');
  }

  if (!playlistInfo) {
    return message.reply('❌ Could not fetch playlist info.');
  }

  const count = playlistInfo.total_videos || playlistInfo.videos?.length || 0;
  const title = playlistInfo.title || 'Unknown Playlist';

  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle('📋 Playlist detected')
    .setDescription(
      `**${title}**\n${count} videos\n\n✅ React to add the **entire playlist**\n❌ React to cancel`
    );

  const msg = await message.channel.send({ embeds: [embed] });
  await msg.react('✅').catch(() => {});
  await msg.react('❌').catch(() => {});

  const filter = (r, u) =>
    ['✅', '❌'].includes(r.emoji.name) && u.id === message.author.id;

  const collector = msg.createReactionCollector({
    filter,
    max: 1,
    time: config.messageDeleteDelay,
  });

  const cancelDelete = deleteAfter(msg);

  collector.on('collect', async (reaction) => {
    cancelDelete();
    msg.delete().catch(() => {});

    if (reaction.emoji.name === '✅') {
      await addPlaylistToQueue(playlistInfo, guildId, message.channel, voiceChannel);
    } else {
      deleteAfter(await message.channel.send('❌ Playlist import cancelled.'));
    }
  });

  collector.on('end', (collected) => {
    if (collected.size === 0) {
      msg.delete().catch(() => {});
      message.channel
        .send('⏰ No response – playlist import cancelled.')
        .then((m) => deleteAfter(m))
        .catch(() => {});
    }
  });
}

/**
 * Handle a URL that points to a specific video inside a playlist.
 * Ask whether to add just the video or the whole playlist.
 */
async function handleMixedUrl(url, message, guildId, voiceChannel) {
  // Extract just the video URL (strip list param)
  const videoUrl = extractVideoUrl(url);

  let videoInfo;
  try {
    videoInfo = await play.video_info(videoUrl);
  } catch {
    return message.reply('❌ Could not fetch video info. Is the video available?');
  }

  if (!videoInfo?.video_details) {
    return message.reply('❌ Could not retrieve video details.');
  }

  const video = videoInfo.video_details;

  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle('🎵 Video is part of a playlist')
    .setDescription(
      `**${video.title}** (${formatDuration(video.durationInSec)})\n\n` +
        '✅ Add the **entire playlist**\n' +
        '❌ Add **only this video**'
    );

  const msg = await message.channel.send({ embeds: [embed] });
  await msg.react('✅').catch(() => {});
  await msg.react('❌').catch(() => {});

  const filter = (r, u) =>
    ['✅', '❌'].includes(r.emoji.name) && u.id === message.author.id;

  const collector = msg.createReactionCollector({
    filter,
    max: 1,
    time: config.messageDeleteDelay,
  });

  const cancelDelete = deleteAfter(msg);

  collector.on('collect', async (reaction) => {
    cancelDelete();
    msg.delete().catch(() => {});

    if (reaction.emoji.name === '✅') {
      let playlistInfo;
      try {
        playlistInfo = await play.playlist_info(url, { incomplete: true });
      } catch {
        deleteAfter(await message.channel.send('❌ Could not fetch playlist. Adding just the video instead.'));
        return;
      }
      await addPlaylistToQueue(playlistInfo, guildId, message.channel, voiceChannel);
    } else {
      await queueSingleVideo(video, guildId, message.channel, voiceChannel);
    }
  });

  collector.on('end', (collected) => {
    if (collected.size === 0) {
      msg.delete().catch(() => {});
      // Default to single video on timeout
      queueSingleVideo(video, guildId, message.channel, voiceChannel).catch(() => {});
    }
  });
}

/**
 * Handle a plain video URL.
 */
async function handleVideoUrl(url, message, guildId, voiceChannel) {
  let videoInfo;
  try {
    videoInfo = await play.video_info(url);
  } catch (err) {
    logger.error('Failed to fetch video info', err);
    return message.reply('❌ Could not fetch video info. Is the video available?');
  }

  if (!videoInfo?.video_details) {
    return message.reply('❌ Could not retrieve video details.');
  }

  await queueSingleVideo(videoInfo.video_details, guildId, message.channel, voiceChannel);
}

// ─── Queue helpers ─────────────────────────────────────────────────────────

async function queueSingleVideo(video, guildId, textChannel, voiceChannel) {
  const song = {
    id: video.id,
    url: video.url,
    title: video.title || 'Unknown title',
    duration: formatDuration(video.durationInSec),
  };

  if (playlist.has(song.id)) {
    const result = playlist.moveToNext(song.id);
    if (result?.alreadyCurrent) {
      deleteAfter(await textChannel.send(`▶️ **${song.title}** is already playing.`));
    } else {
      deleteAfter(await textChannel.send(`⏭️ **${song.title}** is already in the playlist and will play next.`));
    }
    return;
  }

  playlist.add(song);
  deleteAfter(await textChannel.send(`✅ Added **${song.title}** (${song.duration}) to the playlist.`));
  logger.info(`Queued video: ${song.title}`);

  if (voiceChannel && !player.getState(guildId)) {
    await player.join(voiceChannel, textChannel);
  }
  await player.startIfIdle(guildId);
}

async function addPlaylistToQueue(playlistInfo, guildId, textChannel, voiceChannel) {
  try {
    await playlistInfo.fetch();
  } catch {
    // partial fetch is acceptable
  }

  const videos = playlistInfo.videos || [];
  if (videos.length === 0) {
    return textChannel.send('❌ The playlist appears to be empty.');
  }

  const songs = videos
    .filter((v) => v && v.id && !playlist.has(v.id))
    .map((v) => ({
      id: v.id,
      url: v.url,
      title: v.title || 'Unknown title',
      duration: formatDuration(v.durationInSec),
    }));

  if (songs.length === 0) {
    return textChannel.send('ℹ️ All songs from this playlist are already in the queue.');
  }

  playlist.addMany(songs);
  await textChannel.send(
    `✅ Added **${songs.length}** songs from the playlist to the queue.`
  );
  logger.info(`Queued ${songs.length} songs from playlist`);

  if (voiceChannel && !player.getState(guildId)) {
    await player.join(voiceChannel, textChannel);
  }
  await player.startIfIdle(guildId);
}

// ─── Util ──────────────────────────────────────────────────────────────────

function extractVideoUrl(url) {
  try {
    const parsed = new URL(url);
    const v = parsed.searchParams.get('v');
    if (v) return `https://www.youtube.com/watch?v=${v}`;
    // youtu.be short links
    const match = url.match(/youtu\.be\/([^?&]+)/);
    if (match) return `https://www.youtube.com/watch?v=${match[1]}`;
  } catch {
    // fall through
  }
  return url;
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '?:??';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}
