# Tiffany Discord Bot – Requirements & Deployment Guide

## Node.js Version

**Minimum: Node.js 22.12.0** (LTS recommended: 22.x or later)

`@discordjs/voice` 0.19.0 and `@snazzah/davey` require Node.js 22.12.0 or newer for modern JavaScript features and native crypto support needed by the DAVE E2EE protocol.

> **AMP users:** The Node.js App Runner template downloads and manages its own self-contained Node.js installation automatically. Make sure to select **Node.js 22 - LTS** (or newer) as the Release Stream in the AMP instance configuration. You do **not** need to pre-install Node.js on the AMP host. All bot settings are managed through the `.env` file (see *Configuration* below).

---

## Plugin / Dependency List

| Package | Version | Purpose |
|---------|---------|---------|
| `discord.js` | ^14.14.1 | Core Discord API library – handles all bot interactions, messages, reactions, and embeds. |
| `@discordjs/voice` | 0.19.0 | Discord voice channel support – joining channels, creating audio players, streaming audio resources. Supports the DAVE E2EE protocol required by Discord for voice connections. |
| `@snazzah/davey` | 0.1.10 | DAVE (Discord Audio/Visual Encryption) protocol library. Required by `@discordjs/voice` 0.19.0 – Discord enforces DAVE E2EE on most voice channels and connections will fail without it. |
| `play-dl` | ^1.9.7 | YouTube/SoundCloud/Spotify search (no API key required). Used for non-YouTube audio sources; acts as fallback when yt-dlp is unavailable. |
| `vosk` | ^0.3.39 | Offline, free speech-to-text engine. Processes audio entirely on the host machine — no external API, no cost. Requires a one-time model download (see *Setting Up Voice Recognition* below). **Note:** currently degraded due to DAVE audio receive limitations – see *Known Limitations*. |
| `say` | ^0.16.0 | Cross-platform text-to-speech. Uses Windows SAPI (`Microsoft Zira Desktop` etc.) on Windows, `say` on macOS, and `espeak`/`festival` on Linux. Replaces the PowerShell TTS script. |
| `ffmpeg-static` | ^5.2.0 | Bundles a pre-built FFmpeg binary used by `@discordjs/voice` for transcoding non-WebM audio sources. YouTube audio is streamed as WebM/Opus and demuxed without FFmpeg; this package covers fallback scenarios (e.g. certain SoundCloud tracks via play-dl). On ARM Linux install system `ffmpeg` instead (`sudo apt-get install ffmpeg`). |
| `opusscript` | ^0.0.8 | Pure-JavaScript Opus audio codec required by `@discordjs/voice` to encode audio for Discord. Used instead of `@discordjs/opus` (which has an unpatched DoS vulnerability). |
| `libsodium-wrappers` | ^0.7.13 | Cryptography library used by `@discordjs/voice` for voice packet encryption. Pure-JS variant that requires no native compilation. |
| `dotenv` | ^16.4.5 | Loads configuration from a `.env` file. When running under the AMP Node.js App Runner template, place your `.env` file in the `node-server/app/` directory of your AMP instance. |

### System dependency: yt-dlp

**yt-dlp** must be installed on the host as a system package. It is the primary engine used to stream YouTube audio — `play-dl` is no longer reliable for YouTube due to frequent YouTube API changes.

Install yt-dlp:

```bash
# Debian / Ubuntu / Linux (recommended)
pip3 install yt-dlp
# or
sudo apt-get install yt-dlp   # if available in your distro's repos

# macOS
brew install yt-dlp

# Windows (place yt-dlp.exe somewhere in your PATH, e.g. C:\Windows\System32)
# Download from https://github.com/yt-dlp/yt-dlp/releases
```

Keep yt-dlp up to date so it stays compatible with YouTube's latest streaming format:

```bash
pip3 install --upgrade yt-dlp
# or
yt-dlp -U
```

> **Without yt-dlp:** The bot will fall back to `play-dl` for streaming. If play-dl also fails (e.g. "Invalid URL"), songs will be skipped with an error message in the Discord channel.

---

## Feature Overview

| Feature | Text Command | Voice Command |
|---------|-------------|--------------|
| Join voice channel | `Tiffany summon` | `summon` |
| Search YouTube | `Tiffany find {song name}` | `find {song name}` |
| Start / resume playlist | `Tiffany play` | `play` |
| Queue a YouTube URL | `Tiffany play {url}` | *(not supported – can't spell URLs)* |
| Pause current song | `Tiffany pause` | `pause` |
| Resume after pause/stop | `Tiffany resume` | `resume` |
| Stop playback (keeps position) | `Tiffany stop` | `stop` |
| Skip current song | `Tiffany skip this song` | `skip this song` |
| Remove current song | `Tiffany remove current song` | `remove current song` |
| Increase volume (+10%) | `Tiffany louder` | `louder` |
| Decrease volume (-10%) | `Tiffany softer` | `softer` |
| Set to background volume | `Tiffany whisper` | `whisper` |
| Select search result | React with 1️⃣–5️⃣ | `I choose {number}` |
| Like a song | `Tiffany like` / `love` / `favourite` | `like` / `love` / `favourite` |
| Dislike a song | `Tiffany dislike` / `hate` | `dislike` / `hate` |
| View song rating | `Tiffany rating` | `rating` |
| Set a reminder | `Tiffany remind me in {time} to {task}` | `remind me in {time} to {task}` |
| Roll dice | `Tiffany roll {dice}` | `roll {dice}` |
| Create a poll | `Tiffany poll "Q" "A" "B"` | `poll {question}` |
| Sleep timer (auto) | *(automatic — leaves after 2 min of empty channel)* | — |
| Wake word | — | `Hey Tiffany` + command |

---

## Voice Features

### Wake Word Detection

Say **"Hey Tiffany"** (or "Hi Tiffany", "Yo Tiffany") as a wake word followed by a command. Both of these work:

- _"Hey Tiffany, louder"_ — wake word + command in one utterance
- _"Hey Tiffany"_ (pause) _"louder"_ — wake word first, command within 10 seconds
- _"Hey Tiffany; Tiffany louder"_ — repeating the prefix after the wake word also works

The wake word window lasts **10 seconds** — anything you say in that window is treated as a command without needing the "Tiffany" prefix.

### Speaker Diarisation

Each speaker's audio is tracked individually. When multiple people are in a voice channel, Tiffany identifies who said what and attributes commands to the correct user. This is built into the audio receive pipeline — Discord provides per-user audio streams.

### Confidence Thresholds

Voice commands are only acted upon if Vosk's word-level confidence score averages at least **45%**. Low-confidence transcripts (background noise, music bleed-through, mumbled speech) are logged but ignored. This reduces false command triggers.

### Sleep Timer (Empty Voice Channel)

When all human users leave the bot's voice channel, a **2-minute timer** starts. If nobody returns within 2 minutes, the bot automatically:

1. Stops playback
2. Leaves the voice channel
3. Posts a message: _"💤 Left — nobody was listening for 2 minutes."_

A new `Tiffany summon` is required to bring the bot back.

---

## Song Rating / Favourites

Users can rate the currently playing song:

- `Tiffany like` / `love` / `favourite` — ❤️ thumbs up
- `Tiffany dislike` / `hate` — 👎 thumbs down
- `Tiffany rating` — view current likes/dislikes

**Majority rules:** Only votes from members currently in the voice channel count. If more present members dislike a song than like it, the song is automatically skipped. One person's dislike won't override two others' likes.

Ratings are persisted to `data/ratings.json`.

---

## Personal Assistant Features

### Reminders

Set timed reminders that ping you when the time elapses:

```
Tiffany remind me in 20 minutes to check the oven
Tiffany remind me in 1 hour to take a break
Tiffany remind me in 30 seconds to unmute
```

Supported duration formats: `20 minutes`, `1 hour`, `30 seconds`, `1h30m`. Maximum: 24 hours.

### Dice Roller

Roll dice using standard tabletop notation:

```
Tiffany roll 2d6       → 🎲 7 [3, 4]
Tiffany roll 1d20+5    → 🎲 18 (13 + 5)
Tiffany roll d12       → 🎲 9
Tiffany roll 4d8-2     → 🎲 19 [6, 3, 8, 4] - 2
```

### Poll Creation

Create reaction-based polls with up to 10 options:

```
Tiffany poll "Pizza or Burgers?" "Pizza" "Burgers" "Tacos"
Tiffany poll Best music genre | Rock | Jazz | Pop | Classical
Tiffany poll Should we play jazz?    (defaults to Yes/No)
```

---

## Deploying on CubeCoders AMP

Tiffany runs on the **Node.js App Runner** template inside AMP's **Generic Application** module. This template automatically downloads a self-contained copy of Node.js and runs `npm install` every time you click **Update**, so you never need Node.js pre-installed on the host.

> **AMP version required:** 2.6.0 or newer (the Node.js App Runner template requires at least AMP 2.6.0).

### Prerequisites

- AMP 2.6.0+ with the **Generic Application** module installed.
- A Discord bot application with the **Message Content Intent**, **Server Members Intent**, and **Voice** permissions enabled at https://discord.com/developers/applications.
- Internet access from the AMP host to reach `nodejs.org` (for the automatic Node.js download) and `github.com` (if using the Git repo download option).

### Step-by-Step Deployment

#### 1. Create the Bot on Discord

1. Go to https://discord.com/developers/applications and click **New Application**.
2. Give it a name (e.g. *Tiffany*) and click **Create**.
3. Go to the **Bot** tab → click **Add Bot**.
4. Under **Privileged Gateway Intents**, enable:
   - **Presence Intent**
   - **Server Members Intent**
   - **Message Content Intent**
5. Copy the **Token** – you'll need it later.
6. Under **OAuth2 → URL Generator**, select scopes: `bot` and `applications.commands`.
7. Under **Bot Permissions**, select: `Send Messages`, `Read Message History`, `Add Reactions`, `Connect`, `Speak`, `Use Voice Activity`.
8. Copy the generated URL and invite the bot to your server.

#### 2. Create a Log Channel

1. In your Discord server create a text channel (e.g. `#tiffany-logs`).
2. Right-click the channel and select **Copy Channel ID** (enable Developer Mode in Discord settings first).
3. Save that ID.

#### 3. Create a New AMP Instance

1. In the AMP web UI, click **Create Instance**.
2. For the **Module**, select **Generic Application**.
3. In the application template drop-down, select **Node.js App Runner**. If the template is not listed, make sure you have at least AMP 2.6.0 and that the Generic Application module's template list has been refreshed.
4. Give the instance a friendly name (e.g. `TiffanyBot`) and click **Create Instance**.
5. Open the instance and go to its **Configuration** tab. Set the following **Node.js App Runner** settings:

   | Setting | Value |
   |---------|-------|
   | **App Download Type** | `Git repo` *(recommended)* or `None` *(manual upload)* |
   | **App Download Source** | `https://github.com/Neglectorr/TiffanyTwo.git` *(only if Git repo chosen)* |
   | **App Name** | `src/index.js` |
   | **App Installation Location** | *(leave blank)* |
   | **Node.js Release Stream** | `22 - LTS` (or newer; minimum 22.12.0 required) |
   | **npm Install Type** | `npm i` |

6. Click **Save** to apply the settings.

#### 4. Download / Upload the Bot Files

**Option A – Automatic download via Git (recommended)**

With **App Download Type** set to `Git repo` and the source URL filled in, click **Update** (the update button in the instance panel). AMP will:
1. Clone the TiffanyTwo repository into the correct directory.
2. Download the matching Node.js version.
3. Run `npm install` automatically.

Skip to step 5 when the update finishes.

**Option B – Manual file upload**

If you prefer to upload the files yourself (for example, when running a private fork or a modified version), use AMP's built-in **File Manager** or an SFTP client to place all repository files in the following directory – **this is the only place AMP looks for the app**:

| OS | Path inside the AMP instance |
|----|------------------------------|
| **Windows** | `<InstanceDir>\node-server\app\` |
| **Linux** | `<InstanceDir>/node-server/app/` |

The AMP instance directory itself defaults to:

| OS | Default AMP instance directory |
|----|--------------------------------|
| **Windows** | `C:\AMPDatastore\Instances\<InstanceName>\` |
| **Linux** | `/home/amp/.ampdata/instances/<InstanceName>/` |

So the full path to the bot on a default Windows installation would be:

```
C:\AMPDatastore\Instances\TiffanyBot\node-server\app\
```

And on a default Linux installation:

```
/home/amp/.ampdata/instances/TiffanyBot/node-server/app/
```

After uploading, the following items must be present directly inside the `app\` (or `app/`) folder:

```
app/
├── package.json
├── package-lock.json
├── src/
│   └── index.js   ← entry point
├── data/
├── scripts/
└── amp/
```

With **App Download Type** set to `None`, click **Update** so that AMP downloads Node.js and runs `npm install` (you do not need to run `npm install` manually when using the Node.js App Runner template).

#### 5. Create the `.env` Configuration File

The Node.js App Runner template does **not** use `amp/tiffanytwoconfig.json` for live configuration — environment variables must be supplied via a `.env` file placed in the app directory.

1. In AMP's **File Manager**, navigate to the `node-server\app\` folder inside your instance.
2. Create a new file named `.env` (copy the contents from `.env.example`).
3. Fill in **at minimum**:

```env
# Required
DISCORD_TOKEN=your_bot_token_here
LOG_CHANNEL_ID=your_log_channel_id_here

# Optional – defaults shown
BOT_PREFIX=tiffany
DATA_DIR=./data
DEFAULT_VOLUME=0.5
VOLUME_STEP=0.1
WHISPER_VOLUME=0.1
TTS_VOICE=Microsoft Zira Desktop
FIND_RESULTS_COUNT=5
REACTION_TIMEOUT=60000
MESSAGE_DELETE_DELAY=20000
```

> **Windows note:** On Windows, the TTS voice name must exactly match a voice installed via **Control Panel → Speech**. Common choices are `Microsoft Zira Desktop` (female) and `Microsoft David Desktop` (male). If you are unsure which voices are available, leave `TTS_VOICE` blank to use the system default.

#### 6. (Optional) Download the Vosk Speech Model

If you want voice command support, download the offline Vosk model before starting the bot.

Open the AMP **Console** for this instance and run:

```
node scripts/download-model.js
```

This downloads and extracts the ~45 MB model to `data/vosk-model-small-en-us-0.15/` inside the app directory. It is a one-time operation. Voice commands are silently disabled if the model is absent; text commands always work regardless.

> **Windows AMP note:** The AMP console accepts commands that are passed to the running process. If the bot is not running yet you can use AMP's **File Manager** to open a terminal, or open a Command Prompt / PowerShell window, navigate to the app directory (`C:\AMPDatastore\Instances\<InstanceName>\node-server\app\`) and run the command there with the bundled Node.js:
>
> ```cmd
> C:\AMPDatastore\Instances\<InstanceName>\node-server\node\node.exe scripts/download-model.js
> ```

#### 7. Start the Bot

Click **Start** in the AMP instance panel. Tiffany will connect to Discord and post a startup message to the log channel.

### Linux Dependencies

On Linux, install `ffmpeg` (required for audio transcoding), `espeak` (for the `say` TTS package), and `yt-dlp` (for YouTube streaming) before starting:

```bash
# Debian / Ubuntu / the AMP Docker base image
sudo apt-get install ffmpeg espeak
pip3 install yt-dlp
```

> **Why ffmpeg?** When streaming YouTube audio via yt-dlp, the bot requests WebM/Opus — YouTube's native format — and `@discordjs/voice` demuxes it directly using `opusscript` with **no FFmpeg required**. FFmpeg is only needed for non-WebM audio sources (e.g. certain SoundCloud or Spotify tracks streamed via play-dl) or as a fallback when yt-dlp is unavailable. Installing `ffmpeg` system-wide covers those cases and is also required on ARM Linux where the bundled `ffmpeg-static` binary does not run.

### Docker (Optional)

If you prefer to run inside a Docker container, use the official `node:22-bookworm` image and install `ffmpeg`, `espeak`, and `yt-dlp`:

```dockerfile
FROM node:22-bookworm
RUN apt-get update && apt-get install -y ffmpeg espeak python3-pip && \
    pip3 install yt-dlp && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["node", "src/index.js"]
```

---

## Persistent Playlist

The playlist is stored at `data/playlist.json` relative to the bot's working directory (or the path configured via `DATA_DIR`). It is automatically created on first use.

When running under the AMP Node.js App Runner template the default playlist location is:

| OS | Full path |
|----|-----------|
| **Windows** | `C:\AMPDatastore\Instances\<InstanceName>\node-server\app\data\playlist.json` |
| **Linux** | `/home/amp/.ampdata/instances/<InstanceName>/node-server/app/data/playlist.json` |

Every entry in the playlist contains both the **song name** and the **YouTube URL** along with additional metadata:

```json
{
  "songs": [
    {
      "id": "dQw4w9WgXcQ",
      "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "title": "Rick Astley - Never Gonna Give You Up (Official Music Video)",
      "duration": "3:33",
      "addedAt": "2024-01-01T12:00:00.000Z"
    }
  ],
  "currentIndex": 0
}
```

The `currentIndex` tracks which song to play next so the bot resumes from the right position after a restart.

**Back up this file** to preserve your queue between AMP reinstalls or server migrations.

### Playback behaviour
- When the last song finishes the playlist is **automatically shuffled** and replays from the beginning.
- `Tiffany stop` halts playback and remembers the current song — `Tiffany resume` re-streams it from the start.
- `Tiffany pause` freezes the audio stream mid-track — `Tiffany resume` continues from the exact position.

---

## Adding New Commands

1. Create a new file in `src/commands/`, for example `src/commands/mycommand.js`.
2. Export an object with the following shape:

```js
module.exports = {
  name: 'mycommand',
  patterns: [/^my command pattern(.*)$/i],   // text patterns
  voicePatterns: [/\bmy command\b/i],         // voice patterns (optional)

  async execute({ message, guildId, match }) {
    await message.reply('Hello from my new command!');
  },
};
```

3. Import and add it to the `COMMANDS` array in `src/commandHandler.js`.

---

## Setting Up Voice Recognition

Tiffany uses [Vosk](https://alphacephei.com/vosk/) for fully offline speech recognition — no Google, no external API, no ongoing cost.

Before starting the bot for the first time (or after a fresh install), download the small English model (~45 MB) by running:

```bash
node scripts/download-model.js
```

When using the AMP Node.js App Runner on **Windows**, open a Command Prompt or PowerShell window, navigate to the app directory, and use the Node.js binary that AMP downloaded for you:

```cmd
cd C:\AMPDatastore\Instances\<InstanceName>\node-server\app
..\node\node.exe scripts/download-model.js
```

This downloads and extracts the model to `data/vosk-model-small-en-us-0.15/` inside your data directory.  The download is a one-time operation; after that the bot runs entirely offline for voice input.

**Prerequisites for extraction:**
- Linux / macOS: `unzip` must be installed (`sudo apt-get install unzip` or `brew install unzip`).
- Windows: PowerShell is used automatically — no extra tools needed.

If the model directory is not present when the bot starts, voice recognition is silently disabled; text commands continue to work normally.

### Vosk Improvements

The following improvements have been implemented to enhance voice recognition accuracy (all free, no external APIs):

- **Word-level confidence scoring** — Each recognised word includes a confidence score. The bot calculates an average confidence for each utterance and only acts on commands that meet a **45% threshold**. Low-confidence transcripts (background noise, music bleed-through) are logged but ignored.

- **Speaker diarisation** — Audio is received and processed per-user. Discord's voice receiver provides individual audio streams for each speaker, so commands are always attributed to the correct user even when multiple people are talking.

- **Wake word detection** — "Hey Tiffany" is recognised as a wake word. After detection, the next sentence (within 10 seconds) is treated as a command without needing the "Tiffany" prefix. This reduces false positives by only processing speech that was intentionally directed at the bot.

**Possible future improvements (not yet implemented):**

- **Larger model** — Replace `vosk-model-small-en-us-0.15` (45 MB) with `vosk-model-en-us-0.22` (1.8 GB) for significantly better accuracy at the cost of more memory.
- **Custom grammar** — Vosk supports restricting recognition to a custom word list for command-only recognition, which could reduce false positives further.
- **Whisper.cpp** — OpenAI's Whisper model via `whisper.cpp` provides higher accuracy and runs locally, but requires more CPU/memory.

---

## Known Limitations

- **Voice recognition (audio receive) degraded with DAVE E2EE:** `@discordjs/voice` 0.19.0 supports Discord's mandatory DAVE (end-to-end encryption) protocol for voice connections, but audio **receive** (listening to users) is currently broken upstream ([discordjs/discord.js#11419](https://github.com/discordjs/discord.js/issues/11419)). This means Vosk-based speech recognition may not work until the upstream bug is fixed. Audio **sending** (music playback, TTS) works correctly. Text commands are fully unaffected.
- **Node.js 22.12.0+ required:** `@discordjs/voice` 0.19.0 and `@snazzah/davey` require Node.js >= 22.12.0 for modern JavaScript features and native crypto support. If running under AMP, set the Node.js Release Stream to `22 - LTS` or newer.
- **`@snazzah/davey` is required for voice connections:** Discord now enforces DAVE E2EE on most voice channels. Without `@snazzah/davey`, the DAVE handshake fails and the bot cannot connect to voice. The `generateDependencyReport()` output at startup confirms whether davey is detected.
- **Voice recognition** requires a one-time download of the Vosk model (`node scripts/download-model.js`). After that the bot runs entirely offline with no external API dependencies.
- **yt-dlp** must be installed on the host for YouTube streaming. The bot falls back to `play-dl` if yt-dlp is absent, but play-dl may fail for YouTube URLs due to YouTube API changes. Keep yt-dlp up to date with `pip3 install --upgrade yt-dlp` or `yt-dlp -U`.
- **play-dl** is used for non-YouTube sources (SoundCloud, Spotify links, etc.) and as a fallback when yt-dlp is unavailable.
- **Volume control** only applies to the currently playing audio resource and resets when the song changes. Persistent volume is maintained in the bot's in-memory guild state and restored for each new song.
