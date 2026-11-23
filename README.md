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

## Trim a song
- In the app: ✂️ on the song → type the new end (m:ss). Export (⤓) to keep it in Drive.
- On the PC: `tools\trim_song.py "<file.song>" 3:18` (venv python) trims the file itself, audio included.

## Lyrics (automatic, verified)
- **Every pack's lyrics are verified against the singing before they ship** (user, 2026-11-22: "make sure every lyric pack is verified before shipped"). `prep.bat` transcribes the vocal stem with Whisper (`small`, GPU, ~16 s). That gives the timing. Published lyrics (LRCLIB) only correct a heard line's words when they match it (≥ 60% of words), and only when that version matches ≥ 50% of everything heard. Heard lines a matching version can't confirm are dropped (likely mishearings). With no matching version, the heard lines are used as-is.
- Instrumental packs ship no lyrics (nothing sung to check against). Add them by hand with 📝.
- Each pack records the result in `song.json` → `lyricsCheck` (source, match %, unconfirmed lines).
- The app never adds lyrics by title on its own; 📝 → **Find** is a manual pick.
- Check or repair packs: `tools\lyrics_check.py [--fix] [file.song]` (default: every pack in Drive; backups go to `PitchScoreGameTools\backup`; report in `tools\lyrics_check.log`). `tools\show_lyrics.py <pack|folder>` prints them.
- Why: on 2026-11-22, a title-only match gave Jingle Bells another song's words ("…you filthy animal").
- Known gap: belted or unclear passages (e.g. Where Are You Christmas, 110–130 s) aren't recognised, so they show no lyrics.
- Karaoke line under the notes: words light up with the melody; next line shown dim. **Lyrics** checkbox on the play screen turns them on/off.
- If the timing is off: 📝 → **Save + tap to sync**, then tap (or Space) as each line starts. 📝 → **Find** picks a different version.

## Dev
- Local test: run the `game` launch config, open `http://localhost:8765/app/`.
- `?sim=1` = fake singer (no mic). `?load=../songs/x.song` = auto-import.
- `prep\make_test_song.py` builds a synthetic test song.
- Lessons (2026-11-22): the Claude desktop sandbox redirects writes under `AppData` (so tools live in `%USERPROFILE%\PitchScoreGameTools`, and `gh` login/publish must run in the user's real terminal). In PowerShell 5.1 scripts, keep `$ErrorActionPreference='Continue'` around native commands, or their stderr aborts the script.
