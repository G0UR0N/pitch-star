"""Verify the lyrics in .song packs against the singing in each pack (Whisper), and with
--fix replace them with verified lyrics. Writes a report to tools/lyrics_check.log.
Usage: lyrics_check.py [--fix] [file.song ...]   (default: every pack in PSG_SONGS)"""
import json
import shutil
import sys
import tempfile
import time
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "prep"))
import prep  # noqa: E402

LOG = Path(__file__).with_name("lyrics_check.log")
fix = "--fix" in sys.argv
files = [Path(a) for a in sys.argv[1:] if a != "--fix"] or sorted(prep.SONGS_DIR.glob("*.song"))
report = [f"lyrics check {time.strftime('%Y-%m-%d %H:%M')}  ({'fix' if fix else 'check only'})"]


def say(s):
    print(s, flush=True)
    report.append(s)


for path in files:
    with zipfile.ZipFile(path) as z:
        meta = json.loads(z.read("song.json"))
        parts = {n: z.read(n) for n in z.namelist() if n != "song.json"}
    say(f"\n== {path.name}  [{meta.get('kind')}]")
    old = meta.get("lyrics") or []
    if meta.get("kind") == "vocal":
        with tempfile.TemporaryDirectory() as td:
            mp3 = Path(td) / "vocals.mp3"
            mp3.write_bytes(parts["vocals.mp3"])
            new, info = prep.make_lyrics(meta["title"], mp3, meta.get("notes"))
    else:
        new, info = [], {"source": "none", "reason": "instrumental: nothing sung to verify against"}
    same = [l["text"] for l in old] == [l["text"] for l in new]
    say(f"   shipped: {len(old)} lines ({'checked' if meta.get('lyricsCheck') else 'NOT verified'})"
        f"  ->  verified: {len(new)} lines, {info}")
    say(f"   shipped lyrics {'match' if same else 'DIFFER from'} the verified ones")
    for l in new[:6]:
        say(f"      {l['t'] if l['t'] is not None else '-':>7}  {l['text']}")
    if fix and (not same or meta.get("lyricsCheck") != info):
        backup = prep.TOOLS / "backup" / f"{path.stem}.{time.strftime('%Y%m%d-%H%M')}.song"
        backup.parent.mkdir(exist_ok=True)
        shutil.copy2(path, backup)
        meta.update(lyrics=new, lyricsCheck=info, lyricsTried=True)
        tmp = path.with_suffix(".tmp")
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED) as z:
            z.writestr("song.json", json.dumps(meta, separators=(",", ":")))
            for n, data in parts.items():
                z.writestr(n, data)
        tmp.replace(path)
        say(f"   FIXED (backup: {backup.name})")

LOG.write_text("\n".join(report) + "\n", encoding="utf-8")
