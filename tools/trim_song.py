"""Trim a .song pack: skip a slow start and/or end early. Cuts the audio and drops notes and
lyrics outside the kept stretch; with a new start every time is shifted so the song begins at 0.
Usage: trim_song.py <file.song> <end>          e.g. 3:18
       trim_song.py <file.song> <start>-<end>  e.g. 0:12-3:18   (start trim: user, 2026-11-23)
Times are the song's times as you hear them now. A start set in the app (meta.start) is applied too.
trim_pack() is also used by merge_edits.py."""
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


def trim_pack(meta, audio, start, end):
    """Keep start..end (song seconds) of a pack. meta: song.json dict, audio: {name: mp3 bytes}.
    Returns (meta, audio), both new."""
    meta = dict(meta)
    start = max(start or 0, meta.pop("start", 0) or 0)
    end = min(end or meta["duration"], meta["duration"])
    if end - start < 5:
        raise ValueError(f"less than 5 s left ({start:.1f}-{end:.1f})")
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
    if meta.get("check"):  # the check singer's tune (check_notes.py) moves with the audio too
        meta["check"] = {**meta["check"], "notes": [
            {**c, "t": round(c["t"] - start, 3)} for c in meta["check"]["notes"] if start <= c["t"] < end]}
    meta.pop("fullDuration", None)
    if start:
        meta["trimmedStart"] = round(meta.get("trimmedStart", 0) + start, 2)  # seconds cut from the original
    out = {}
    with tempfile.TemporaryDirectory() as td:
        for name, data in audio.items():
            src, dst = Path(td) / ("in_" + name), Path(td) / name
            src.write_bytes(data)
            # re-encode when the start moves (a stream copy can only cut on frame edges and drifts)
            cut = ["-ss", str(start), "-t", str(end - start), "-c:a", "libmp3lame", "-q:a", "2"] if start else ["-t", str(end), "-c", "copy"]
            subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), *cut, str(dst)], check=True)
            out[name] = dst.read_bytes()
    return meta, out


def read_pack(path):
    with zipfile.ZipFile(path) as z:
        return json.loads(z.read("song.json")), {n: z.read(n) for n in ("backing.mp3", "vocals.mp3")}


def write_pack(path, meta, audio):
    tmp = Path(path).with_suffix(".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED) as z:
        z.writestr("song.json", json.dumps(meta, separators=(",", ":")))
        for name, data in audio.items():
            z.writestr(name, data)
    tmp.replace(path)


if __name__ == "__main__":
    path, spec = Path(sys.argv[1]), sys.argv[2]
    meta, audio = read_pack(path)
    start, end = (secs(spec.split("-")[0]), secs(spec.split("-")[1])) if "-" in spec else (None, secs(spec))
    if end > meta["duration"] + 0.5:
        sys.exit(f"the song is only {meta['duration']:.0f}s long")
    meta, audio = trim_pack(meta, audio, start, end)
    write_pack(path, meta, audio)
    print(f"trimmed to {spec}: {meta['duration']}s, {len(meta['notes'])} notes, {len(meta['phrases'])} sections, {len(meta['lyrics'])} lyric lines")
