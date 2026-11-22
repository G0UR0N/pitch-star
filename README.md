# Pitch Star

Karaoke pitch-training game. PC preps songs; game runs in a browser (phone or PC).

## Add a song (PC, no AI needed)
1. Double-click `prep\prep.bat`.
2. Paste a YouTube link (or drag in an audio file) and press Enter. Takes ~1–2 min.
3. The pack appears in `G:\My Drive\PitchStar\<name>.song` (Google Drive; set by `PSG_SONGS` in `prep.bat`).

Batch: `prep\prep.bat <link1> <link2> ...`

No singer (piano/instrumental)? Detected automatically: the melody is transcribed from the top line of the instrument, and a soft tone melody becomes the "guide voice". Force a mode with `--instrumental` or `--vocal`. Best sources: a version with a singer, or a piano version that plays the melody (accompaniment-only tracks may not contain it). Check with **Hear notes**.

Tools live in `%USERPROFILE%\PitchScoreGameTools` (Python env, ffmpeg, uv). Not synced to OneDrive.

## Phone
- Game URL: https://g0ur0n.github.io/pitch-star/app/
- iPhone (Safari): Share → **Add to Home Screen**. Android (Chrome): ⋮ → **Install app**.
- Songs: `G:\My Drive\PitchStar` syncs through Google Drive. On the phone tap **Add songs** → browse Google Drive → `PitchStar` → pick `.song` files. They're stored in the app and work offline.
- App updates: after code changes run `publish.ps1` (right-click → Run with PowerShell).

## Play
- Open the game, tap **Add songs**, pick `.song` files.
- Use headphones. Set **Mic delay fix** in ⚙️ if scoring feels late.
- **Guide voice** = original singer volume. **Hear notes** = plays the target melody as tones (also a quick way to check the melody extraction is right).
- After a song: **Practice weak sections** loops each section until it scores the pass target twice.

## Fix a melody by singing it (🎙️)
Best on the PC in Chrome/Edge (open the game URL), headphones on.
1. ⚙️ → pick the **Microphone**, then **Auto-set delay** (say "tick" on each beep). Delay is saved per microphone; the mic picker is also on the play screen.
2. Song list → 🎙️. ◀ ▶ picks **whole song** or one section. **Start**, sing the tune (any octave; vibrato and slides are ignored).
3. Pink bars = what was heard. **Listen** plays them as tones over the music. **Keep** / **Retry** / **Discard**.
4. **⤓ Export** saves the fixed `.song`. On PC, pick `G:\My Drive\PitchStar` (replace the old file). On the phone, remove the old copy and **Add songs** again.

## Dev
- Local test: run the `game` launch config, open `http://localhost:8765/app/`.
- `?sim=1` = fake singer (no mic). `?load=../songs/x.song` = auto-import.
- `prep\make_test_song.py` builds a synthetic test song.
- Lessons (2026-11-22): the Claude desktop sandbox redirects writes under `AppData` (so tools live in `%USERPROFILE%\PitchScoreGameTools`, and `gh` login/publish must run in the user's real terminal). In PowerShell 5.1 scripts, keep `$ErrorActionPreference='Continue'` around native commands, or their stderr aborts the script.
