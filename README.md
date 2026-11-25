# Pitch Star

Karaoke pitch-training game. PC preps songs; game runs in a browser (phone or PC).

## Add a song (PC, no AI needed)
1. Double-click `prep\prep.bat`.
2. Paste a YouTube link (or drag in an audio file) and press Enter. Takes ~1–2 min.
3. The pack appears in `G:\My Drive\PitchStar\Songs\<name>.song` (Google Drive; `PSG_SONGS` in `prep.bat` names the PitchStar folder).

Drive layout (user, 2026-11-24: "organize our google folder a bit. Make folder "Songs" and another "PrepFiles""):
- `PitchStar\Songs\`: the `.song` packs (the master copies every device adds from).
- `PitchStar\PrepFiles\`: prep inputs the app never reads: `lyrics_answers.json`, `lyrics_onscreen.json`, edits saved with ☁️, and `merged\` (edits already merged).

Batch: `prep\prep.bat <link1> <link2> ...`

Melisma is smoothed out (user, 2026-11-23: "smooth out the expected notes as she sings with a bit of melisma which I don't want to impose on my daughter"): using the heard word times, each sung word keeps at most one note per syllable (its first note plus the longest others); runs and turns fold into the note before them. A note after a rest of more than 0.3 s is never folded. Prep logs how many notes were folded.

Check a pack's key: `tools\song_key.py <file.song>` estimates it from the notes and from the backing music; the two should agree, so the notes match the recording.

No singer (piano/instrumental)? Detected automatically: the melody is transcribed from the top line of the instrument, and a soft tone melody becomes the "guide voice". Force a mode with `--instrumental` or `--vocal`. Best sources: a version with a singer, or a piano version that plays the melody (accompaniment-only tracks may not contain it). Check with **Hear notes**.

Tools live in `%USERPROFILE%\PitchScoreGameTools` (Python env, ffmpeg, uv). Not synced to OneDrive.

## Phone
- Game URL: https://g0ur0n.github.io/pitch-star/app/
- iPhone (Safari): Share → **Add to Home Screen**. Android (Chrome): ⋮ → **Install app**.
- Songs: `G:\My Drive\PitchStar\Songs` syncs through Google Drive. On the phone tap **Add songs** → browse Google Drive → `PitchStar` → `Songs` → pick `.song` files. They're stored in the app and work offline.
- Keeping songs (2026-11-24, after a device lost its song library): the app asks the browser to keep its storage permanently, at start and after each Add songs. ⚙️ Settings shows the result. Installed apps (Home Screen / Install app) are usually allowed; a plain browser tab may be refused. Drive stays the master copy: re-add from `PitchStar\Songs`, and save edits with ☁️. On an iPhone, Safari and the Home Screen app keep separate song libraries.
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
- **Your sung trace stays for editing** (user, 2026-11-23: "If I made a live pitch trace while singing in play mode, I would like that trace to remain when in edit mode"). While a song plays, everything you sing is recorded (in 20 ms steps). In ✎ Edit notes the whole trace is drawn in pink behind the targets, at its true pitch. Singing a stretch again replaces the old trace there (user: "if I re-record myself singing over an existing pitch trace, go ahead and replace it"). It lasts while the app is open, including Sing again and reopening the song, but not after the app is closed.
- **✎ Edit notes** (full song): the slider on top of the edit panel drags the white line (where the live pitch dot sits) through the song, to 0.1 s (user, 2026-11-23: "slider control of where my live pitch line sits in the timeline"). Tap a note to pick it (it plays its tone), or step with ‹ ›. Then:
  - **Drag it** (user, 2026-11-24: "let me grab either edge of the marker to shrink/expand from that end as I need ... grab near the middle of the marker and move it around with my mouse"):
    - Drag the middle to move it in time and pitch. A picked group moves together.
    - Drag either end (about 10 px) to stretch or shrink from that end; the other end stays.
    - On the PC the cursor shows what you'll grab (↔ at the ends, ✋ in the middle).
    - A tap without moving only picks the note. Each drag is one undo step.
    - **Slide through the song by dragging** (user, 2026-11-24: "if I grab on a blank spot in the view, make it so that I can then shift the view left and right so that I dont have to use the slider at the bottom (slider can stay as backup option too)", then "Right Click is pan" / "Left clicking open spot on view should not engage panning, only right clicking ANYWHERE in the view (right click should do nothing to markers)").
      - PC: **right-button drag anywhere** pans, even over a marker, which it never changes. The left button only picks and drags notes; on an empty spot it does nothing.
      - Phone (no right button): a finger on an empty spot pans.
      - Going back makes those notes count again. The slider stays.
    - Picking is exact: the note under the pointer always wins over a touching neighbour's edge (fixed 2026-11-24; a click inside the second of two touching same-pitch notes used to pick the first).
    - The ▲ ▼ ◀ ▶ and shorter/longer buttons are gone. On the PC the arrow keys still nudge the picked notes: ↑ ↓ a semitone, ← → 0.05 s.
  - ⇑ oct / ⇓ oct move it a whole octave (user, 2026-11-24: "I need better octave control... The "Hear Notes" option throws notes in the wrong octave lots ... Maybe give up/down arrows for octave shifting"). Scoring ignores octaves, so this changes only what Hear notes plays and where the note is drawn. The view always fits every note.
  - Your pitch is always drawn where it really is, never moved by octaves (user, 2026-11-24: "I don't want to go lower and see my pitch marker jump to the top of the screen" / "there should be no out of range voices, thus no shifted octave views. Make the highest and lowest notes of the song determine the view").
    - The view runs from the song's lowest note to its highest, with 2 semitones of margin.
    - A voice outside that range sits at the top or bottom edge with ⇡ / ⇣.
    - 🎤 my pitch and ＋ add use your true pitch.
    - Scoring still ignores octaves.
    - **OPEN** (user, same day): "if certain song ranges make the window too zoomed out, we will address folding octave options then".
  - 🎤 my pitch sets it to the note you're singing.
  - ＋ add, then click (or tap) twice on the notes view (user, 2026-11-24: "when I click add, let me pick where it lands", then "the first click places the left edge and the right edge follows my mouse cursor until I click again to place the right edge" / "if I double click quickly then drop the default size where I clicked"):
    - The first click sets the left end and the pitch (its row).
    - The right end follows the mouse, with a preview showing the note name and length.
    - The second click sets the right end. Clicking left of the first click also works.
    - A quick double-click (within 0.45 s, same spot) drops a 0.5 s note there.
    - Tap ＋ add again, or press Esc, to cancel. ↶ undo removes a note.
  - 🗑 deletes it.
  - **Several notes at once** (user, 2026-11-24: "let me select multiple pitch markers for mass shifting options"):
    - **☐ select many**: each tap adds or removes a note. In that mode › adds the next note and ‹ drops the last one.
    - **▭ all in view** picks every note on screen.
    - On the PC: Ctrl-click adds or removes a note, and Shift-click picks everything between.
    - Every edit then works on all picked notes: dragging the middle of one of them, the arrow keys, ⇑⇓ oct, 🗑 and use 🔔 pitch (each note takes the check singer's note under it). Dragging an end changes only that note.
    - 🎤 my pitch puts the first note on your pitch and moves the rest by the same step, so the tune keeps its shape.
  - **↶ undo** takes back the last change (up to 50, while the song is open). **↷ redo** puts it back; a new change clears the redo list.
  - Keyboard (user, 2026-11-24: "edit needs ctrl+z and ctrl+y support"): **Ctrl+Z** undoes, and **Ctrl+Y** or **Ctrl+Shift+Z** redoes (Cmd on a Mac). They work in edit mode only, not while typing in a text box.
  - Every change is saved on the phone at once (the card shows "✎ own melody"). ⤓ exports the pack to keep it in Drive.

## Check singer: a second opinion on the targets (user, 2026-11-24: "make a singer tool that sings without melisma along with the song as it understands it without looking at the pitch markers ... as a means of validating the pitch markers as well placed or not")
- On the PC, run `tools\check_notes.py` (all packs in `PitchStar\Songs`, or give a name part such as `palace`). It works out the tune again **without reading the targets**, in a different way from prep:
  - It uses a different pitch tracker (pYIN instead of CREPE) on the pack's vocals.
  - It sings one note per syllable. A syllable starts at a vocal attack or after a breath, and its pitch is the one held longest. Melisma, scoops and vibrato are ignored. A second pitch is kept only if it is held at least 0.35 s.
- It lists where it disagrees with the targets, in `tools\check_notes.log`. It saves its tune in the pack as `check` and backs the pack up to `PitchScoreGameTools\backup` first. It changes no targets.
- It flags four kinds of spot:
  - a different note, by at least 0.7 semitone and ignoring octaves (scoring ignores them too);
  - no singing under a target;
  - a target running more than 0.3 s past the end of the singing;
  - singing of 0.3 s or longer with no target (a missing note).
- In the app, re-add the song from Drive. If this device has edits the Drive file doesn't have, answer "Cancel" to keep them; the check tune is still added. Then in **✎ Edit notes**:
  - Dashed green outlines show the check singer's tune.
  - ⚠ marks the targets it disagrees with.
  - **⚠ next** steps through the flagged spots.
  - **🔔 check singer** plays its tune instead of the targets while the song plays, so you can hear which one fits.
  - **use 🔔 pitch** sets the picked note to the check singer's note.
- What your repairs taught us (These Palace Walls 0:00–1:15, compared with the original prep, 2026-11-24):
  - Prep missed whole lines sung by the other singers: you added about 45 notes, at 0:18–0:20, 0:33–0:37 and 0:57–1:07. Prep tracked only the separated lead voice. **Fixed in prep** (below).
  - The spoken intro had become notes, which you deleted. **Fixed in prep** (below).
  - Some quick lines were run together into one long note. **OPEN**: splitting notes at Whisper's word starts scored worse, because its word times aren't precise enough.
  - Not every pitch flag is a real error. At 0:31.0 you chose D# where both detectors hear E.

## Prep improvements, scored against your repairs (user, 2026-11-24: "It may take some development effort for you to get a good bead on the melodies core notes and spacing" → "Yes, improve prep")
- `tools\eval_notes.py` scores a way of making notes against notes you repaired by ear. The ground truth is stored once with `--snapshot <name> <until s>` in `PitchScoreGameTools\truth` (outside the public repo). The ways it tries are in `tools\note_variants.py`, and the report goes to `tools\eval_notes.log`.
  - A made note counts as right when it has the right pitch (octaves ignored) and starts within 0.15 s of yours.
  - The report gives three figures: found (share of your notes it made), real (share of its notes that are yours) and F1, which combines the two.
- Now in prep, applied to new songs only (your edited packs are never rebuilt). On These Palace Walls 0:00–1:15, F1 went from **0.57 to 0.72**, notes found from 50% to 67%, and real notes from 67% to 78%.
  - **Other singers:** where the lead singer is silent, prep takes the notes heard in all vocals. This added 3 notes on Jingle Bells and none on Where Are You Christmas.
  - **No notes under spoken lines** (lines marked spoken in on-screen lyrics).
- Tried and rejected (eval log, 2026-11-24):
  - Snapping note starts to vocal attacks: slightly worse.
  - Splitting notes at word starts: worse.
  - Using the check singer's notes as targets: it finds more notes but makes too many extras.
  - Lighter smoothing (0.08 s): +0.02, too small to change it for every song, because smoothing is what removes vibrato.
  - Telling speech from singing by pitch steadiness: Faith Hill's ornamented singing looks as unsteady as speech.
- Whole song repaired (2026-11-24; ground truth updated to all 156 notes):
  - Today's prep scores 0.71 against it, the old prep 0.58.
  - Of Claude's 6 pitch fixes after 1:15, you kept 3 (1:24.4, 1:29.9, 1:31.8) and reverted 3 (1:20.0, 1:22.6, 1:31.1). "Both detectors agree" was wrong where both heard a harmony or a passing note.
  - The final "Something waits…" line (1:43.9–1:50) is melody. Claude had dismissed it as backing singers.
- What the separated tracks hold (These Palace Walls): the karaoke separator splits by voice type, not by role.
  - Jasmine is "lead". Isir, Manal, Rajah and the ensemble went to the "backing" track.
  - Of your 156 notes, 96 are in the lead track, 40 only in the backing track (prep now fills these) and 17 in neither.
  - Those 17 are harmony spots where you picked the melody out, nearly always the upper voice. The pitch tracker follows the lower, louder one.
- **OPEN: melody inside harmonies.** Two quick "top voice" pickers were tried, scoring which pitches sound at once, with and without removing the tracked voice's overtones. At best they fixed 5 notes but broke 6. A real multi-voice transcription model would be needed.
- Check singer graded against your edits:
  - On raw prep notes, 43 of its 52 flags were at spots you fixed (83%).
  - On your finished song 31 flags were left. 8 were the spoken intro, now skipped in the PC tool and the app. The other 23 are harmony spots.
- Second full repair (2026-11-24 14:40; the previous answer key is kept in `PitchScoreGameTools\truth_history`):
  - 155 notes: 58 re-timed (median 0.1 s later), 5 moved down an octave, 2 re-pitched.
  - Today's prep scores 0.68 against it, the old prep 0.53. The ranking of methods is unchanged.
  - Timing measured against the singing: 0:25–0:35 now sits 0.1 s late. As placed, the notes match the singing 68% of the time; 0.1 s earlier they'd match 80%. The previous version there was spot on. Every other stretch is within ±0.05 s.
  - The check singer's flags went from 23 to 31, almost all at 0:28–0:33. Each flagged target hears the next note's pitch, a sign that targets there sit late.
- Third repair (15:00): 0:25–0:35 fixed from 68% to 73% of the time on the sung pitch. Check-singer flags went from 31 to 26. Prep scores 0.68 against it, the old prep 0.54. Your saved copy was deleted on your word once the re-timed and tweaked version proved better (user, 2026-11-24: "go ahead and delete my backup, this version is our best so far"). Its notes remain in `truth_history` as `v3`.
- **Re-timing by Claude** (user, 2026-11-24: "save off a copy of mine and you take a stab at timing corrections so that the melody cadence is a better match"): `tools\retime_notes.py <name> [--write]`.
  - Each note starts at the vocal attack of its syllable: the attack just before the singer reaches the note's pitch, or the moment the pitch is reached if there's no attack.
  - Ends stay as you placed them.
  - Only moves of 0.04–0.3 s, never into the previous note.
  - A start moves later only where nobody is singing at the old start. A scoop up into a note starts the syllable on time, only the pitch arrives late.
  - On These Palace Walls 26 notes moved, almost all earlier. Time on pitch is unchanged (76.5% → 76.4%), because the syllable's attack comes before its pitch, so pitch measures can't confirm a rhythm gain. Your ear judges.
  - Your verdict (user, 2026-11-24: "its good, I did make a few tweaks"). Of the 26 moves you kept about 20, nudged 4 a further 0.05 s earlier and 2 back 0.05 s later. You also turned 0:30.9 into a second C#4 and trimmed a few lengths. Starts may sit slightly earlier still by ear; too little evidence to change the tool yet. The answer key is now this 15:10 version.
  - Rejected: moving starts later to where the pitch arrives.
  - **Where Are You Christmas** (user, 2026-11-24: "I like the pitch choices ... if you want to take a pass at timing clean ups go ahead and save off mine and take a stab" / "fix timing and durations as you see fit").
    - Your 16:13 version is saved in `PitchStar\PrepFiles\saved` and `PitchScoreGameTools\backup`, and is now the second answer-key song. Prep scores 0.60 against it.
    - Turning melisma folding off scores 0.46 here, against 0.70 on Aladdin, so the folding stays.
    - The tool now picks, per note, the clearer pitch track: the separated lead voice or all vocals. This song has a choir behind Faith Hill.
    - With `--ends` it also moves note ends to where the voice stops: trimmed back from silence, or extended while she's still singing, never into the next note.
    - A start may now also move later when the singer is still holding the previous note at the old start. Only a voice heading into this note counts as a scoop.
    - Result: 36 of 201 notes changed (21 starts, 17 ends; pitches untouched). Time on pitch went from 68.9% to 69.3%. Check-singer flags stayed at 56; it is weak on her ornaments.
    - Your verdict (user, 2026-11-24: "Keep yours", then "wait keep mine I meanb"): your 16:13 version is back in `PitchStar\Songs` (plus the check tune) and is the answer key again. Claude's pass is kept only as `PitchScoreGameTools\backup\...claude-timing-pass-2026-11-24.song`.
    - Correction (user, same day: "sorry I got confused, I need to review yours still... I'll call it up from backup"). The earlier reading that "the ear prefers your timing" was withdrawn; it came from the mix-up.
    - Verdict (user, 16:33: "yours is good and I tweaked it some more and saved it to google"):
      - You kept 26 of Claude's 36 changes exactly and fine-tuned the rest.
      - You re-timed about 16 other notes, often starting the next note earlier and shortening the one before it (e.g. 0:49.8 D4 0.28 s sooner), and deleted 2 notes (2:52.6, 3:07.9).
      - That 16:33 version is now the answer key. The Drive review copies went to the Recycle Bin; the PC backups (your 16:13 version, Claude's pass) stay in `PitchScoreGameTools\backup`.
    - Pattern across both songs: the timing pass is a good first draft, and you then move a few starts slightly earlier still.
    - **OPEN, for your ear:** at 3:44.2 / 3:44.6 the targets are F#4 then D4, but both voice tracks hear D4 then F#4. That gained +2.8% on pitch, but at scoops it would put the marker after the syllable has begun.
- Lesson (2026-11-24): a run of flags where each target "hears the next note" means those targets sit late. Measure the best time shift per stretch (scratch script `offset2.py`; worth turning into a tool if it recurs).
- More songs you repair become more ground truth. Snapshot them, and every change can be scored against all of them before it ships.
- First repair by Claude (These Palace Walls after 1:15, 2026-11-24, for you to check):
  - The backing is in C#/D♭ major from about 1:12.
  - Claude changed a note only where both detectors agree and the key supports the change. That gave 6 pitch fixes and 5 merges of split held notes.
  - Doubtful spots were left as they were. The backup is in `PitchScoreGameTools\backup`.
- It is a second opinion, not the truth. Your ear decides.
  - Backing singers or a harmony line can pull it to another note, as at 1:34–1:37 of These Palace Walls.
  - Spoken intros show up as "missing notes".

## Edits → Drive master (user, 2026-11-23: "pull my edits into the source files so that other devices can pull them in as the master source")
1. Edit on any device (notes, 🎙️ melody, ✂️ trim, 📝 lyrics, tap-sync). The card then shows **☁️ Save edits to Drive**.
2. Tap it. On the phone the share sheet opens: pick **Drive → PitchStar → PrepFiles**. On the PC a save box opens: pick `G:\My Drive\PitchStar\PrepFiles`. It writes `<song>.edits.txt` (small; it holds the notes, trim, name, folder and lyrics).
3. On the PC run `tools\merge_edits.py` (venv python), or ask Claude. It folds the newest edits file for each song into the master `.song`: notes replaced, trim applied (audio cut, times shifted), name and folder set, lyrics you typed kept. The pack is backed up to `PitchScoreGameTools\backup` first, the edits file moves to `PitchStar\PrepFiles\merged`, and the report goes to `tools\merge_edits.log`.
- Or, on the PC, ⤓ export the whole song straight into `G:\My Drive\PitchStar\Songs` (user, 2026-11-24: "I've been using the export arrow instead"). Other devices that re-add the exported song take it without asking.
- When the ☁️ flag shows (user, 2026-11-24: "or better yet make it go away if my loaded version matches the google drive folder version"):
  - **PC:** tap **🔗 Link Drive folder** above the song list once and pick `G:\My Drive\PitchStar\Songs`. From then on the app compares each edited song with its copy there (notes, trim, lyrics). The flag shows only while they differ.
    - The check runs when the app opens, when you come back to its window, and after each ⤓ save, which now opens in that folder.
    - If Chrome asks again later, the button reads **🔄 Check Drive**: one tap.
  - **Phone:** a phone can't link a Drive folder, so any use of ⤓ clears the flag instead (user, same day: "make the save edits flag automatically go away once I interact with the download arrow button").
4. Other devices: **Add songs** → pick the song again. Re-adding keeps nothing from before except name and folder; the master now holds the edits.
- Safety: if this device has edits the Drive file doesn't have yet, re-adding asks before replacing them.
- The master is protected. `prep.py` won't rebuild a pack holding your edits unless you pass `--force`, and `lyrics_check --fix` leaves lyrics you typed alone.

## Fix a melody by singing it (🎙️)
Best on the PC in Chrome/Edge (open the game URL), headphones on.
1. ⚙️ → pick the **Microphone**, then **Auto-set delay** (say "tick" on each beep). Delay is saved per microphone; the mic picker is also on the play screen.
   - Mic delay slider goes 0–1000 ms (2026-11-24, user: "widen the mic delay allowed to be up to 1000ms"; the user sets it by trial and error). Auto-set still only detects lags under 0.6 s (beeps are 0.8 s apart).
   - Auto-set adds 200 ms to the measured tick lag (`TICK_EXTRA`; 2026-11-24, user: "add an extra offset of 200ms to whatever the tick delay says and it seems to track much better"). Chat's reading: a sung note's pitch locks on later than a spoken "tick".
   - **+200 ms for singing** checkbox next to Auto-set (on by default, `settings.tickExtra`; 2026-11-25, user: "make it so that the 200ms offset addition can be turned on or off (check box near the Auto-set delay button)"). Toggling moves the current delay by 200 ms right away; turning it off takes only what is there above 0 (`settings.extraTaken`) and turning it on puts back exactly that, so toggling never drifts.
   - **I sing** (play screen, default "as the song"; 2026-11-24, user: "Add a scale offset option so that I can sing an octave lower and still see the live pitch relative to the target pitch. Default is no offset", then "Octave offset*... not scale offset"): 1 or 2 octaves lower, or 1 higher. It moves the live pitch, the trail and recorded notes by that many octaves (`settings.voiceOct`, in semitones, `voiceAt()` in app.js). Scoring ignores octaves, so scores don't change.
   - A sung C-scale delay test was built and removed the same day (user, 2026-11-24: "Scratch that scale test... im just going to figure it out with some trial and error").
2. Song list → 🎙️. ◀ ▶ picks **whole song** or one section. **Start**, sing the tune (any octave; vibrato and slides are ignored).
3. Pink bars = what was heard. **Listen** plays them as tones over the music. **Keep** / **Retry** / **Discard**.
4. **⤓ Export** saves the fixed `.song`. On PC, pick `G:\My Drive\PitchStar\Songs` (replace the old file). On the phone, remove the old copy and **Add songs** again.

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
- **Human help for rough parts** (user, 2026-11-23: "if you need help deciphering rough parts, you can que it up for me to help" / "don't lean on me more than absolutely necessary tho"). When a pack misses the gate, prep logs `ASK a human` only for the fewest rough parts (sung time with no confirmed line, or a heard line no published line confirms) that would lift it over 95%, and only if that's reachable. The answer ("the line at 1:13 is …") is saved with `tools\lyrics_answer.py <file.song> <seconds> "<line>"` into `G:\My Drive\PitchStar\PrepFiles\lyrics_answers.json` (lyric text, so it stays out of the repo). Every later prep or check uses it, so a part is never asked twice. Jingle Bells passes this way (2026-11-23: the slow repeat "In a one horse open sleigh" at 2:23.5, heard as "And I want her so pen slay").
- **Lyrics from the video's own slides, with singer parts** (user, 2026-11-23: "Can you use screen snips from the video to derive the lyrics? There are several parts/singers for this and it would be nice of the lyrics tracked that"). `tools\video_frames.py <url> <folder>` saves one frame per second; `tools\slide_changes.py <folder>` lists each distinct slide. The slides are read by eye (per-line confidence > 90%) into `G:\My Drive\PitchStar\PrepFiles\lyrics_onscreen.json`, keyed by video title: `{text, who, spoken}` per line. Prep and `lyrics_check` try them first and verify them against the singing like any published version (same 95% gate). Lines keep `who` and `spoken`; the play screen shows the singer as a coloured tag (one colour per name, grey for All) and spoken lines in italics. First use: These Palace Walls (Aladdin Jr.), 23 lines, match 100%, coverage 100%. The slide's last line "Something waits behind these palace walls" is not in the lead vocal, so it is left out.
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
- Lesson (2026-11-24): the note canvas must be re-measured whenever its box changes size, not only on window resize. A ResizeObserver does this. Opening the edit panel squashed it to 83% height, so taps landed on each note's "ghost" above or below it. Taps are mapped with the canvas's own x and y scales.
- Lesson (2026-11-24, check singer): pYIN's voiced probability runs low on these vocal stems. Gating at 0.4 lost half of the sung frames, so the check reported "no singing" under most targets. It now uses pYIN's own voiced flag plus a loudness gate.
  - Sanity results: the check matches the targets to within 0.1 semitone on average on every pack (so there is no tuning mismatch), and Twinkle Test gives 0 flags.
- Lessons (2026-11-22): the Claude desktop sandbox redirects writes under `AppData` (so tools live in `%USERPROFILE%\PitchScoreGameTools`, and `gh` login/publish must run in the user's real terminal). In PowerShell 5.1 scripts, keep `$ErrorActionPreference='Continue'` around native commands, or their stderr aborts the script.
