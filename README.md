# Pitch Star

Karaoke pitch-training game. PC preps songs; game runs in a browser (phone or PC).

## Add a song (PC, no AI needed)
1. Double-click `prep\prep.bat`.
2. Paste a YouTube link (or drag in an audio file) and press Enter. Takes ~1–2 min.
3. The pack appears in `G:\My Drive\PitchStar\<name>.song` (Google Drive; set by `PSG_SONGS` in `prep.bat`).

Batch: `prep\prep.bat <link1> <link2> ...`

Melisma is smoothed out (user, 2026-11-23: "smooth out the expected notes as she sings with a bit of melisma which I don't want to impose on my daughter"): using the heard word times, each sung word keeps at most one note per syllable (its first note plus the longest others); runs and turns fold into the note before them. A note after a rest of more than 0.3 s is never folded. Prep logs how many notes were folded.

Check a pack's key: `tools\song_key.py <file.song>` estimates it from the notes and from the backing music; the two should agree, so the notes match the recording.

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
- Scoring: a note scores the share of the time you're within tolerance (Easy 100, Normal 60, Hard 40 cents; half credit up to twice that), weighted by note length. **Quick notes (< 0.4 s) are more generous** (user, 2026-11-23: "if the pitch level passes through the marker it at least counts toward a minimal score, but no points if it misses the mark entirely"):
  - touching the target at any moment earns at least 60% ("Good");
  - sliding through it (the pitch crosses the line) earns at least 40% ("Close", light blue);
  - missing it entirely earns 0.
- **▶ Start** plays at once; the 3-2-1 count-in was removed (user, 2026-11-23: "you can kill the 3 second countdown, no longer has value").
- **Guide voice** = original singer volume. **Hear notes** = plays the target melody as tones (also a quick way to check the melody extraction is right).
- After a song: **Practice weak sections** loops each section until it scores the pass target twice.

## Skip and fix notes on the play screen (user, 2026-11-23)
- **⏪ 10s / ⏩ 10s** jump back or forward (within the trimmed song, or the section in practice). Going back makes those notes count again. Notes skipped past are grey and don't count against the score.
- **While paused, the pink pitch dot still shows** what you sing, with its note name, on the white line. Nothing is scored unless the music is playing (user: "only allow scoring to work if music is playing").
- **Your sung trace stays for editing** (user, 2026-11-23: "If I made a live pitch trace while singing in play mode, I would like that trace to remain when in edit mode"). While a song plays, everything you sing is recorded (in 20 ms steps). In ✎ Edit notes the whole trace is drawn in pink behind the targets, folded to the octave of the nearest note. Singing a stretch again replaces the old trace there (user: "if I re-record myself singing over an existing pitch trace, go ahead and replace it"). It lasts while the app is open, including Sing again and reopening the song, but not after the app is closed.
- **✎ Edit notes** (full song): the slider on top of the edit panel drags the white line (where the live pitch dot sits) through the song, to 0.1 s (user, 2026-11-23: "slider control of where my live pitch line sits in the timeline"). Tap a note to pick it (it plays its tone), or step with ‹ ›. Then:
  - ▲ ▼ change it by a semitone; ◀ ▶ move it by 0.05 s.
  - ⇤ shorter / longer ⇥ change its length by 0.05 s.
  - 🎤 my pitch sets it to the note you're singing.
  - ＋ add puts a new 0.5 s note at the white line (at your sung pitch if you're singing, otherwise the nearby note's pitch).
  - 🗑 deletes it.
  - Every change is saved on the phone at once (the card shows "✎ own melody"). ⤓ exports the pack to keep it in Drive.

## Edits → Drive master (user, 2026-11-23: "pull my edits into the source files so that other devices can pull them in as the master source")
1. Edit on any device (notes, 🎙️ melody, ✂️ trim, 📝 lyrics, tap-sync). The card then shows **☁️ Save edits to Drive**.
2. Tap it. On the phone the share sheet opens: pick **Drive → PitchStar**. On the PC a save box opens: pick `G:\My Drive\PitchStar`. It writes `<song>.edits.txt` (small; it holds the notes, trim, name, folder and lyrics).
3. On the PC run `tools\merge_edits.py` (venv python), or ask Claude. It folds the newest edits file for each song into the master `.song`: notes replaced, trim applied (audio cut, times shifted), name and folder set, lyrics you typed kept. The pack is backed up to `PitchScoreGameTools\backup` first, the edits file moves to `PitchStar\merged`, and the report goes to `tools\merge_edits.log`.
4. Other devices: **Add songs** → pick the song again. Re-adding keeps nothing from before except name and folder; the master now holds the edits.
- Safety: if this device has edits the Drive file doesn't have yet, re-adding asks before replacing them.
- The master is protected. `prep.py` won't rebuild a pack holding your edits unless you pass `--force`, and `lyrics_check --fix` leaves lyrics you typed alone.

## Fix a melody by singing it (🎙️)
Best on the PC in Chrome/Edge (open the game URL), headphones on.
1. ⚙️ → pick the **Microphone**, then **Auto-set delay** (say "tick" on each beep). Delay is saved per microphone; the mic picker is also on the play screen.
2. Song list → 🎙️. ◀ ▶ picks **whole song** or one section. **Start**, sing the tune (any octave; vibrato and slides are ignored).
3. Pink bars = what was heard. **Listen** plays them as tones over the music. **Keep** / **Retry** / **Discard**.
4. **⤓ Export** saves the fixed `.song`. On PC, pick `G:\My Drive\PitchStar` (replace the old file). On the phone, remove the old copy and **Add songs** again.

## Trim a song (slow start and/or end)
Start trim: user, 2026-11-23: "I would like the option to trim off slow starts from songs as well".
- In the app: ✂️ on the song → type `start - end`, e.g. `0:27 - 3:18` (an end alone still works). The box says when the singing starts and suggests a start 3 s before it. The song then plays from the start; the card shows "0:27–3:18". The audio isn't cut, so a start can only move later. To undo, re-add the song from Drive. Export (⤓) to keep it in Drive.
- On the PC: `tools\trim_song.py "<file.song>" 0:27-3:18` (or just `3:18`) trims the file itself. It cuts both audio tracks, shifts every note and lyric time so the song begins at 0, and records the cut in `trimmedStart`.

## Song list: names and folders
- Cards show a short name (e.g. "Jingle Bells"). It comes from the video title when that contains the published title of the verified lyrics, otherwise from the published title, and with no published title from the video title alone: the part before the first "|", and in "Artist - Title" the part after the dash, unless that part is only a description such as "Piano accompaniment". The song name is always the bold line (user, 2026-11-22). The rest of the title (artist, source) is shown as subtext.
- Folders (genre or anything else; user request 2026-11-23):
  - A **Christmas** folder is built in. Songs whose title or lyrics mention Christmas words (Christmas, Jingle, Santa, sleigh…) go into it automatically until you choose a folder yourself.
  - **📁 New folder** at the top of the song list makes a folder. An empty folder shows how to fill it and has **Remove folder**.
  - The **📁 chip** on each song card ("📁 Christmas", or "📁 Add to folder") moves the song: pick a folder, **No folder**, or create a new one right there.
  - Folders collapse with a tap, and that state is remembered.
- ✏️ on a card renames the song.
- Name and folder are stored on the phone and kept when an updated pack is re-added (user request, 2026-11-22).

## Lyrics (automatic, verified)
- **Every pack's lyrics are verified against the singing before they ship** (user, 2026-11-22: "make sure every lyric pack is verified before shipped"). `prep.bat` transcribes the vocal stem with Whisper (`small`, GPU, ~16 s). That gives the timing. Published lyrics (LRCLIB) only correct a heard line's words when they match it (≥ 60% of words), and only when that version matches ≥ 50% of everything heard. Heard lines a matching version can't confirm are dropped (likely mishearings). With no matching version, the heard lines are used as-is.
- **Ship gate: > 95% certainty** (user, 2026-11-22: "your lyric validation needs >90% certainty before shipping"; raised 2026-11-23: "lets bump the lyrics accuracy check to >95%"). Lyrics ship only if a published version matches > 95% of the heard words **and** the confirmed lines cover > 95% of the sung time (strictly greater). The app applies the same check to copies already on the phone and removes lyrics that passed only the old 90% gate (notes inside the heard span of a confirmed line, ±1 s). Otherwise the pack ships with no lyrics, and `lyricsCheck.reason` says why. Heard-only lyrics (no published match) never ship.
- Whisper can skip a whole sung stretch (Jingle Bells' first verse, 0:09–0:28, was missed behind the intro). Any sung stretch of 2 s or more with no heard word is transcribed again on its own. One heard stretch may match up to 8 published lines.
- Whisper runs with a fixed seed, so every run gives the same result. Before this, one pack heard 47 words on one run and 0 on the next (2026-11-23). Segments stuck repeating a word ("this, this, this…") are discarded and that stretch is re-listened to in pieces of up to 20 s.
- The published-lyrics search tries each part of the title. A dash with a space on either side splits the title ("DPEE- All I Want…"), and file extensions like ".wmv" are dropped.
- Instrumental packs ship no lyrics (nothing sung to check against). Add them by hand with 📝.
- Each pack records the result in `song.json` → `lyricsCheck` (source, match %, unconfirmed lines).
- The app never adds lyrics by title on its own; 📝 → **Find** is a manual pick. Lyrics saved in 📝 count as checked by the user (`lyricsCheck.source = manual`).
- Old copies: the app keeps its own copy of each song, so fixing a pack in Drive doesn't change what is already added. When the app starts (and when a pack is imported), it removes lyrics that have no check record (2026-11-22, after the old Jingle Bells copy still showed another song's words). Such songs then show no lyrics until re-added, so a yellow banner at the top of the song list names them and opens the file picker when tapped (the card shows the same button, since folders can hide it). Re-adding keeps the name and folder.
- Check or repair packs: `tools\lyrics_check.py [--fix] [file.song]` (default: every pack in Drive; backups go to `PitchScoreGameTools\backup`; report in `tools\lyrics_check.log`). `tools\show_lyrics.py <pack|folder>` prints them.
- Why: on 2026-11-22, a title-only match gave Jingle Bells another song's words ("…you filthy animal").
- **Human help for rough parts** (user, 2026-11-23: "if you need help deciphering rough parts, you can que it up for me to help" / "don't lean on me more than absolutely necessary tho"). When a pack misses the gate, prep logs `ASK a human` only for the fewest rough parts (sung time with no confirmed line, or a heard line no published line confirms) that would lift it over 95%, and only if that's reachable. The answer ("the line at 1:13 is …") is saved with `tools\lyrics_answer.py <file.song> <seconds> "<line>"` into `G:\My Drive\PitchStar\lyrics_answers.json` (lyric text, so it stays out of the repo). Every later prep or check uses it, so a part is never asked twice. Jingle Bells passes this way (2026-11-23: the slow repeat "In a one horse open sleigh" at 2:23.5, heard as "And I want her so pen slay").
- **Lyrics from the video's own slides, with singer parts** (user, 2026-11-23: "Can you use screen snips from the video to derive the lyrics? There are several parts/singers for this and it would be nice of the lyrics tracked that"). `tools\video_frames.py <url> <folder>` saves one frame per second; `tools\slide_changes.py <folder>` lists each distinct slide. The slides are read by eye (per-line confidence > 90%) into `G:\My Drive\PitchStar\lyrics_onscreen.json`, keyed by video title: `{text, who, spoken}` per line. Prep and `lyrics_check` try them first and verify them against the singing like any published version (same 95% gate). Lines keep `who` and `spoken`; the play screen shows the singer as a coloured tag (one colour per name, grey for All) and spoken lines in italics. First use: These Palace Walls (Aladdin Jr.), 23 lines, match 100%, coverage 100%. The slide's last line "Something waits behind these palace walls" is not in the lead vocal, so it is left out.
- JSON files in the songs folder are read with `utf-8-sig`: a file saved by a Windows tool starts with a BOM, and plain `utf-8` silently skipped the on-screen lyrics (2026-11-23).
- Tried and dropped (2026-11-23): re-listening to unconfirmed lines on their own. It fixed nothing and pushed It's Beginning to Look… below the gate.
- **The published line order settles parts with no human** (2026-11-23, Faith Hill's Where Are You Christmas):
  - A heard line no published line confirms, sitting between two confirmed lines where 1–3 published lines are missing, is that text when ≥ 50% of its words match ("Build a future in every heart with love" = "Fills each and every heart / With love").
  - Sung time where the published order has no missing line (before the first line, between two consecutive lines, after the last) is wordless (ad-libs, held "oh"s) and is not counted.
  - Wordless sounds Whisper hears ("Hmm", "Ooooh", "Oh") are not lyrics either. Their segments are left out of the match, and their notes out of the sung time.
  - Repeated lines (a chorus) are counted in order, so a repeat isn't mistaken for the first copy.
- Known gap: belted or unclear singing isn't recognised. Waiting on a human answer (2026-11-23): Two Front Teeth (match 92%, coverage 94%; 1 part, 1:13.6–1:17.1).
- Where Are You Christmas: only Faith Hill's original version is kept (user, 2026-11-23: "remove the other attempts at this song so that our library only holds this copy"). The piano and Taylor Momsen packs went to the Recycle Bin. Faith Hill: F major (matches the backing music; same key as the old piano version), match 100%, coverage 100% (19.8 s wordless), 127 melisma notes folded, 216 left.
- Copies checked before the 90% gate (no `coverage` in `lyricsCheck`) are also treated as old by the app and need re-adding.
- Karaoke lines under the notes: words light up with the melody; the next two lines are shown dim, in the same style (user, 2026-11-23: "have lyrics que up at least 3 lines, making the 3rd line the same format as the 2nd"). **Lyrics** checkbox on the play screen turns them on/off.
- If the timing is off: 📝 → **Save + tap to sync**, then tap (or Space) as each line starts. 📝 → **Find** picks a different version.

## Dev
- Local test: run the `game` launch config, open `http://localhost:8765/app/`.
- `?sim=1` = fake singer (no mic). `?load=../songs/x.song` = auto-import.
- `prep\make_test_song.py` builds a synthetic test song.
- Lessons (2026-11-22): the Claude desktop sandbox redirects writes under `AppData` (so tools live in `%USERPROFILE%\PitchScoreGameTools`, and `gh` login/publish must run in the user's real terminal). In PowerShell 5.1 scripts, keep `$ErrorActionPreference='Continue'` around native commands, or their stderr aborts the script.
