"""Merge edits saved from the app (☁️ -> <song>.edits.txt in the Drive songs folder) into the
master .song packs, so every device gets them when it re-adds the song (user, 2026-11-23:
"pull my edits into the source files so that other devices can pull them in as the master source").
Usage: merge_edits.py            (all edit files in PSG_SONGS / G:\\My Drive\\PitchStar)
Each pack is backed up to PitchScoreGameTools\\backup first; merged edit files move to <songs>\\merged.
Report: tools\\merge_edits.log"""
import json
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "prep"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import prep  # noqa: E402
from trim_song import read_pack, trim_pack, write_pack  # noqa: E402

LOG = Path(__file__).with_name("merge_edits.log")
SONGS = prep.SONGS_DIR
report = [f"merge edits {time.strftime('%Y-%m-%d %H:%M')}  ({SONGS})"]


def say(s):
    print(s, flush=True)
    report.append(s)


def load(f):
    try:
        ed = json.loads(f.read_text(encoding="utf-8-sig"))
        return ed if ed.get("type") == "pitchstar-edits" else None
    except (OSError, ValueError):
        return None


edits = [(f, ed) for f in sorted(SONGS.glob("*.edits*.*")) if f.suffix in (".txt", ".json") and (ed := load(f))]
if not edits:
    say("no edit files found")
packs = {p: read_pack(p)[0]["title"] for p in SONGS.glob("*.song")}
# newest edit file per song wins (each one holds the full set of that song's edits)
newest = {}
for f, ed in edits:
    k = ed.get("song") or ed.get("title")
    if k not in newest or (ed.get("editedAt") or 0) >= (newest[k][1].get("editedAt") or 0):
        newest[k] = (f, ed)
done = set()
for k, (f, ed) in newest.items():
    pack = SONGS / f"{ed.get('song')}.song"
    if not pack.exists():
        pack = next((p for p, t in packs.items() if t == ed.get("title")), None)
    say(f"\n== {f.name}  ->  {pack.name if pack else 'NO MATCHING PACK'}")
    if not pack:
        continue
    meta, audio = read_pack(pack)
    if (meta.get("editsMerged") or 0) >= (ed.get("editedAt") or 0):
        say("   already merged")
        done.add(k)
        continue
    backup = prep.TOOLS / "backup" / f"{pack.stem}.{time.strftime('%Y%m%d-%H%M')}.song"
    backup.parent.mkdir(exist_ok=True)
    shutil.copy2(pack, backup)
    if ed.get("notes"):
        n = ed["notes"]
        ps = sorted(x["p"] for x in n)
        meta.update(notes=n, phrases=prep.to_phrases(n), edited=True,
                    range=[ps[int(0.03 * len(ps))], ps[min(len(ps) - 1, int(0.97 * len(ps)))]] if ps else meta["range"])
        say(f"   notes: {len(n)} (edited)")
    if ed.get("lyrics"):
        same = [l["text"] for l in ed["lyrics"]] == [l["text"] for l in meta.get("lyrics", [])]
        if ed.get("lyricsManual"):
            meta.update(lyrics=ed["lyrics"], lyricsCheck={"source": "manual"}, lyricsTried=True)
            say(f"   lyrics: {len(ed['lyrics'])} lines typed/picked by you")
        elif same:
            meta["lyrics"] = ed["lyrics"]  # same words, maybe re-timed with tap-sync
            say("   lyrics: timing updated")
    for key in ("name", "group"):
        if key in ed:
            meta[key] = ed[key]
            say(f"   {key}: {ed[key]!r}")
    if ed.get("start") or ed.get("end"):
        meta, audio = trim_pack(meta, audio, ed.get("start"), ed.get("end"))
        say(f"   trimmed to {ed.get('start') or 0:.1f}-{ed.get('end') or 'end'} s (audio cut, times shifted)")
    meta["editsMerged"] = ed.get("editedAt") or int(time.time() * 1000)
    write_pack(pack, meta, audio)
    say(f"   MERGED (backup: {backup.name})")
    done.add(k)
# file the edit files away (older copies of a merged song too)
arch = SONGS / "merged"
for f, ed in edits:
    if (ed.get("song") or ed.get("title")) in done:
        arch.mkdir(exist_ok=True)
        shutil.move(str(f), str(arch / f.name))
LOG.write_text("\n".join(report) + "\n", encoding="utf-8")
