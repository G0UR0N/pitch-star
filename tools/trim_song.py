"""Trim a .song pack: skip a slow start and/or end early. Cuts the audio and drops notes and
lyrics outside the kept stretch; with a new start every time is shifted so the song begins at 0.
Usage: trim_song.py <file.song> <end>          e.g. 3:18
       trim_song.py <file.song> <start>-<end>  e.g. 0:12-3:18   (start trim: user, 2026-11-23)
Times are the song's times as you hear them now. A start set in the app (meta.start) is applied too."""
import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "prep"))
from prep import FFMPEG, to_phrases  # noqa: E402


def secs(x):
    m, s = x.strip().split(":")
    return int(m) * 60 + float(s)


path, spec = Path(sys.argv[1]), sys.argv[2]
with zipfile.ZipFile(path) as z:
    meta = json.loads(z.read("song.json"))
    audio = {n: z.read(n) for n in ("backing.mp3", "vocals.mp3")}
start, end = (secs(spec.split("-")[0]), secs(spec.split("-")[1])) if "-" in spec else (meta.get("start", 0), secs(spec))
start = max(start, meta.pop("start", 0))
if end > meta["duration"] + 0.5 or end - start < 5:
    sys.exit(f"times outside the song (it runs 0:00-{meta['duration']:.0f}s)")
end = min(end, meta["duration"])

notes = []
for n in meta["notes"]:
    if n["t"] < start or n["t"] >= end:
        continue
    d = min(n["d"], round(end - n["t"], 3))
    if d >= 0.08:
        notes.append({**n, "t": round(n["t"] - start, 3), "d": d})
ps = sorted(n["p"] for n in notes)
meta.update(
    duration=round(end - start, 2),
    notes=notes,
    phrases=to_phrases(notes),
    range=[ps[int(0.03 * len(ps))], ps[min(len(ps) - 1, int(0.97 * len(ps)))]] if ps else [60, 72],
    lyrics=[{**l, "t": round(l["t"] - start, 2) if l.get("t") is not None else None}
            for l in meta.get("lyrics", []) if l.get("t") is None or start - 1 <= l["t"] < end],
)
if start:
    meta["trimmedStart"] = round(start, 2)  # seconds cut from the original start

with tempfile.TemporaryDirectory() as td:
    out = {}
    for name, data in audio.items():
        src, dst = Path(td) / ("in_" + name), Path(td) / name
        src.write_bytes(data)
        # re-encode when the start moves (a stream copy can only cut on frame edges and drifts)
        cut = ["-ss", str(start), "-t", str(end - start), "-c:a", "libmp3lame", "-q:a", "2"] if start else ["-t", str(end), "-c", "copy"]
        subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), *cut, str(dst)], check=True)
        out[name] = dst.read_bytes()
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED) as z:
        z.writestr("song.json", json.dumps(meta, separators=(",", ":")))
        for name, data in out.items():
            z.writestr(name, data)
    tmp.replace(path)
print(f"trimmed to {spec}: {meta['duration']}s, {len(notes)} notes, {len(meta['phrases'])} sections, {len(meta['lyrics'])} lyric lines")
