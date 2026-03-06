# Suggestions — Future Enhancements for Tiffany

Theoretically possible functions and features that could be added to the bot.

---

## 🎵 Music & Playback

- **Song lyrics display** — Fetch and display lyrics for the currently playing song (via Genius or Musixmatch API).
- **Crossfade between songs** — Fade out the current song and fade in the next for seamless transitions.
- **Equalizer presets** — Allow users to apply audio filters (bass boost, vocal clarity, nightcore, etc.) using FFmpeg audio filters.
- **Song rating / favourites** — Let users ❤️ songs to build a favourites playlist, or 👎 songs to auto-skip them in future.
- **Play history** — Track recently played songs and allow users to view and replay from history.
- **Queue reordering** — Let users move songs to specific positions in the queue (e.g., `Tiffany move song 5 to position 2`).
- **DJ mode** — Restrict playback commands to a specific DJ role so only designated users can control the music.
- **Song recommendations** — Suggest similar songs based on the current playlist using YouTube's related videos.
- **Audio effects** — Apply real-time effects like reverb, echo, or speed changes to playback.
- **Multi-playlist support** — Allow users to create, name, save, and switch between multiple playlists.
- **Sleep timer** — Automatically stop playback after a specified duration (`Tiffany sleep in 30 minutes`).
- **Song dedications** — Dedicate a song to another user with an announcement (`Tiffany dedicate this song to @user`).

## 🤖 Personal Assistant Features

- **Reminders** — Set timed reminders (`Tiffany remind me in 20 minutes to check the oven`).
- **Time and date** — Ask Tiffany for the current time or date (`Tiffany what time is it?`).
- **Weather integration** — Fetch weather info for a given location using a weather API.
- **Daily briefing** — Summarise server activity, upcoming events, and birthdays on command.
- **Custom greetings** — Personalised welcome messages when users join the voice channel.
- **User nicknames** — Allow users to set preferred names so Tiffany addresses them by their chosen nickname.
- **Note taking** — Store quick notes per user (`Tiffany remember that my favourite genre is lo-fi`).
- **Calculator** — Perform basic math operations (`Tiffany what is 42 times 7?`).
- **Dice roller** — Roll dice for tabletop gaming (`Tiffany roll 2d6`).
- **Poll creation** — Create quick reaction-based polls (`Tiffany poll "Pizza or Burgers?"`).

## 🛡️ Server Management

- **Auto-moderation** — Detect and warn/mute users for spam or inappropriate content.
- **AFK detection** — Automatically move AFK users to a designated channel after inactivity.
- **Channel cleanup scheduler** — Periodically purge old messages from designated channels.
- **Role-based access** — Restrict certain commands to specific Discord roles.
- **Server statistics** — Display member counts, voice channel activity, and message stats.

## 🎙️ Voice & Speech Improvements

- **Wake word detection** — Listen for "Hey Tiffany" as a wake word, only processing speech after it is detected (reduces false positives).
- **Multi-language support** — Load multiple Vosk models for different languages and auto-detect the spoken language.
- **Voice activity logging** — Log voice channel join/leave events and total time spent.
- **Voice-controlled playlists** — Create and manage playlists entirely through voice commands.
- **Speaker diarisation** — Distinguish between different speakers more accurately for multi-user voice commands.
- **Confidence thresholds** — Only act on voice commands that meet a minimum confidence score from Vosk.
- **Voice feedback sounds** — Play short audio cues (beeps, chimes) to acknowledge voice commands instead of TTS.

## 🔗 Integrations

- **Spotify integration** — Search and queue songs from Spotify (convert to YouTube for playback).
- **SoundCloud support** — Extended support for SoundCloud playlists and tracks.
- **Last.fm scrobbling** — Scrobble played songs to users' Last.fm profiles.
- **Twitch notifications** — Announce when followed streamers go live.
- **GitHub integration** — Post commit summaries or PR notifications to a designated channel.

---

## 🎙️ Voice Recognition Investigation — Vosk & Alternatives

### Current State

Tiffany uses **Vosk** (`vosk-model-small-en-us-0.15`) for fully offline speech-to-text.
Audio receive is currently degraded due to Discord's DAVE E2EE implementation in
`@discordjs/voice` 0.19.x ([upstream issue #11419](https://github.com/discordjs/discord.js/issues/11419)).

### Other Bots Using Voice Recognition

The following bots and projects have tackled Discord voice recognition and may offer
insights or fixes:

| Project | Approach | Notes |
|---------|----------|-------|
| **[discord-speech-recognition](https://github.com/Rei-x/discord-speech-recognition)** | Google Web Speech API | Cloud-based, high accuracy but has API cost. Source of the original `speechEvent` hook pattern. |
| **[Kuvbot](https://github.com/Kuuuube/Kuvbot)** | Vosk offline | Similar pipeline to Tiffany; uses a larger Vosk model for better accuracy. |
| **[Discord-Speech-Bot](https://github.com/healzer/Discord-Speech-Bot)** | Wit.ai | Free cloud STT with good accuracy; requires internet. |
| **[Speechchat](https://github.com/ianpatt/speechchat)** | Whisper (OpenAI) | Uses `whisper.cpp` for fast local transcription; significantly more accurate than Vosk small model. |
| **[JMusicBot](https://github.com/jagrosh/MusicBot)** | N/A (music only) | No speech recognition, but excellent audio pipeline patterns. |

### Possible Vosk Improvements

1. **Use a larger model** — Replace `vosk-model-small-en-us-0.15` (45 MB) with
   `vosk-model-en-us-0.22` (1.8 GB) for significantly better accuracy. The small model
   struggles with music-related vocabulary (artist names, song titles).

2. **Add a custom vocabulary / grammar** — Vosk supports restricting recognition to a
   custom word list or grammar. Since Tiffany only needs to recognise a small set of
   commands, a constrained grammar could drastically reduce false positives:
   ```json
   ["tiffany", "play", "pause", "stop", "skip", "previous", "louder", "softer",
    "whisper", "volume", "shuffle", "queue", "find", "summon", "leave", "help",
    "explain", "remove", "clear", "mood", "clean", "[unk]"]
   ```

3. **Noise gate / Voice Activity Detection** — Add a simple energy-based VAD before
   feeding audio to Vosk. This filters out background music bleed-through from the
   bot's own playback, which is a major source of garbage transcriptions.

4. **Consider Whisper.cpp** — OpenAI's Whisper model (via `whisper.cpp` or the
   `whisper-node` npm package) provides much higher accuracy than Vosk, runs locally,
   and supports multiple languages. The trade-off is higher CPU/memory usage and
   slightly higher latency (~1–3 seconds for short utterances).

5. **Hybrid approach** — Use Vosk for real-time wake-word detection ("Tiffany") and
   only send the subsequent speech to a more accurate (but slower) engine like Whisper
   for command parsing.

6. **Monitor `@discordjs/voice` updates** — The DAVE E2EE audio receive issue is the
   primary blocker. Track [discord.js#11419](https://github.com/discordjs/discord.js/issues/11419)
   and update `@discordjs/voice` when a fix is released.
