# Voice Review

Voice-powered staging review sessions that combine [VoiceMode](https://github.com/nicobailon/voicemode) with the [Chrome extension](https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn) for hands-free app exploration.

Talk through the app naturally while Claude navigates, takes screenshots, and creates Linear issues from your spoken observations.

## Prerequisites

| Requirement                | Purpose                | Install                                                                                              |
| -------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------- |
| Claude Code CLI (v2.0.73+) | Base tool              | `npm install -g @anthropic-ai/claude-code`                                                           |
| Claude in Chrome extension | Browser interaction    | [Chrome Web Store](https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn) |
| VoiceMode MCP server       | Voice communication    | See [VoiceMode setup](#voicemode-setup) below                                                        |
| Whisper.cpp                | Speech-to-text (local) | Installed by VoiceMode                                                                               |
| Kokoro TTS                 | Text-to-speech (local) | Installed by VoiceMode                                                                               |
| Working microphone         | Voice input            | Built-in or external mic                                                                             |

## VoiceMode Setup

VoiceMode provides local speech-to-text (Whisper) and text-to-speech (Kokoro) services. No cloud API keys are required — everything runs on your machine.

### 1. Install VoiceMode

Follow the official installation guide: [github.com/nicobailon/voicemode](https://github.com/nicobailon/voicemode)

This installs:

- **Whisper.cpp** — local speech-to-text using Apple Metal GPU acceleration
- **Kokoro** — local text-to-speech engine
- **VoiceMode MCP server** — bridges Claude Code to the audio services

### 2. Configure MCP server

Add VoiceMode to your Claude Code MCP configuration. This is typically done during VoiceMode installation, but verify it's present:

```bash
claude mcp list
```

You should see `voicemode` in the list of configured servers.

### 3. Verify services

Start a Claude Code session and check service status:

```
Check VoiceMode service status for whisper and kokoro
```

Both Whisper and Kokoro should show as running. The `/voice-review` skill will attempt to start them automatically if they're not running, but manual verification helps catch setup issues early.

## Usage

### Start a session

```bash
claude --chrome
```

Then run:

```
/voice-review
```

Optionally specify a focus area:

```
/voice-review shopping flow
/voice-review onboarding
/voice-review recent changes
```

### What happens

1. **Pre-flight** — Claude verifies Chrome and VoiceMode are available, starts services if needed, and loads the project backlog from Linear
2. **Navigation** — Claude opens `https://honkadori.xyz/` in Chrome and handles authentication
3. **Voice conversation** — Claude greets you and asks what to focus on. You talk back and forth naturally while Claude navigates pages, takes screenshots, and checks the console
4. **Issue creation** — When you spot something worth tracking, discuss it verbally. Claude drafts a Linear issue, reads you the title, and creates it after your confirmation
5. **Summary** — When you're done, Claude speaks a summary and also outputs it as text for reference

### During the session

- **Speak naturally** — Claude listens after each message. Just talk about what you see.
- **Guide navigation** — "Go to the shopping page", "Click that button", "Scroll down"
- **Flag issues** — "That looks broken", "File that as a bug", "The loading is slow here"
- **Skip things** — "That's fine, move on", "Not worth filing"

## Troubleshooting

### "This skill requires Chrome mode"

Start Claude Code with Chrome enabled:

```bash
claude --chrome
```

Or enable mid-session with `/chrome`.

### Whisper/Kokoro won't start

Check service logs:

```
Check VoiceMode whisper logs
Check VoiceMode kokoro logs
```

Common fixes:

- Ensure Whisper and Kokoro are installed (re-run VoiceMode installer)
- Check that ports 2022 (Whisper) and 8880 (Kokoro) aren't in use by another process
- On macOS, ensure microphone permissions are granted to your terminal app

### No audio output

- Check your system audio output device is set correctly
- Verify Kokoro is running: service status should show a PID and port
- Try restarting Kokoro: ask Claude to restart the kokoro service

### Not hearing my voice / responses are wrong

- Check your microphone input device in System Settings
- Ensure your terminal app has microphone permission (System Settings → Privacy & Security → Microphone)
- Reduce background noise — Whisper works best in quiet environments
- If specific words are misrecognized, configure `VOICEMODE_STT_PROMPT` in `~/.voicemode/voicemode.env` for vocabulary biasing

### VoiceMode MCP server not found

Re-add it to Claude Code:

```bash
claude mcp list  # Check if voicemode is listed
```

If missing, follow the VoiceMode installation guide to re-configure the MCP server.
