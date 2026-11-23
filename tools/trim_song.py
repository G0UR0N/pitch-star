"""Cut a .song pack to end at a given time (drops notes/lyrics after it, trims the audio).
Usage: trim_song.py <file.song> <m:ss>"""
import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "prep"))
from prep import FFMPEG, to_phrases  # noqa: E402

path, stamp = Path(sys.argv[1]), sys.argv[2]
m, s = stamp.split(":")
end = int(m) * 60 + float(s)

with zipfile.ZipFile(path) as z:
    meta = json.loads(z.read("song.json"))
    audio = {n: z.read(n) for n in ("backing.mp3", "vocals.mp3")}
if end >= meta["duration"]:
    sys.exit(f"song is only {meta['duration']}s long")

notes = []
for n in meta["notes"]:
    if n["t"] >= end:
        continue
    d = min(n["d"], round(end - n["t"], 3))
    if d >= 0.08:
        notes.append({**n, "d": d})
ps = sorted(n["p"] for n in notes)
meta.update(
    duration=round(end, 2),
    notes=notes,
    phrases=to_phrases(notes),
    range=[ps[int(0.03 * len(ps))], ps[min(len(ps) - 1, int(0.97 * len(ps)))]] if ps else [60, 72],
    lyrics=[l for l in meta.get("lyrics", []) if l.get("t") is None or l["t"] < end],
)

with tempfile.TemporaryDirectory() as td:
    out = {}
    for name, data in audio.items():
        src, dst = Path(td) / ("in_" + name), Path(td) / name
        src.write_bytes(data)
        subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), "-t", str(end), "-c", "copy", str(dst)], check=True)
        out[name] = dst.read_bytes()
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED) as z:
        z.writestr("song.json", json.dumps(meta, separators=(",", ":")))
        for name, data in out.items():
            z.writestr(name, data)
    tmp.replace(path)
print(f"trimmed to {stamp}: {len(notes)} notes, {len(meta['phrases'])} sections, {len(meta['lyrics'])} lyric lines")
