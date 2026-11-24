"""Check singer: works out the tune a second, independent way and compares it with the pack's
pitch targets (user, 2026-11-24: "make a singer tool that sings without melisma along with the
song as it understands it without looking at the pitch markers ... as a means of validating the
pitch markers as well placed or not").

How it differs from prep (CREPE frames -> pitch-change notes -> melisma folding):
  - pitch: librosa pYIN (a different tracker) on the pack's own vocals.mp3
  - notes: one per sung syllable. A syllable starts at a vocal onset (a consonant / new attack) or
    after a breath; its pitch is the one held longest in it. Pitch wiggles inside a syllable
    (melisma, scoops, vibrato) are ignored, unless a second pitch is held >= 0.35 s (a real note).
  - it never reads meta.notes while building its tune; only the comparison afterwards does.
The check tune is stored in the pack as meta.check (the app shows it in edit mode and can sing it).

Usage: check_notes.py [<file.song> | <name part>]   (no argument: every pack in Drive\\PitchStar\\Songs)
Report: tools\\check_notes.log"""
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "prep"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import prep  # noqa: E402
from trim_song import read_pack, write_pack  # noqa: E402

LOG = Path(__file__).with_name("check_notes.log")
SR, HOP = 16000, 160  # 10 ms frames
HELD = 0.35           # a pitch held this long inside a syllable is a real note (same rule as prep)
MIN_NOTE = 0.12
report = [f"check notes {time.strftime('%Y-%m-%d %H:%M')}"]


def say(s=""):
    print(s, flush=True)
    report.append(s)


def load_vocals(mp3):
    with tempfile.TemporaryDirectory() as td:
        src, wav = Path(td) / "v.mp3", Path(td) / "v.wav"
        src.write_bytes(mp3)
        subprocess.run([prep.FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
                        "-ac", "1", "-ar", str(SR), str(wav)], check=True)
        return prep.sf.read(wav, dtype="float32")[0]


def sing(y):
    """The check singer's tune from the vocal audio alone: [{t, d, p}]."""
    import librosa

    f0, vflag, vprob = librosa.pyin(y, fmin=65.0, fmax=1050.0, sr=SR, frame_length=1024,
                                    hop_length=HOP, max_transition_rate=35.0)
    n = len(f0)
    rms = librosa.feature.rms(y=y, frame_length=1024, hop_length=HOP)[0][:n]
    db = 20 * np.log10(rms + 1e-9)
    # pYIN's own voiced/unvoiced call (its probability runs low on stage-mic vocals: a 0.4 bar
    # dropped half the sung frames on These Palace Walls, 2026-11-24) + a loudness gate
    voiced = vflag & (db > np.percentile(db, 95) - 35)
    midi = np.where(voiced, 69 + 12 * np.log2(np.maximum(np.nan_to_num(f0, nan=1.0), 1e-3) / 440), np.nan)
    v = ~np.isnan(midi)
    frac = midi[v] - np.round(midi[v])
    tune = float(np.angle(np.mean(np.exp(2j * np.pi * frac))) / (2 * np.pi))
    midi = midi - tune
    # syllable starts: vocal onsets (attacks), backtracked to the energy dip before them
    on = set(librosa.onset.onset_detect(y=y, sr=SR, hop_length=HOP, backtrack=True, delta=0.07).tolist())
    notes = []
    edges = np.flatnonzero(np.diff(np.r_[0, v.astype(int), 0]))
    for a, b in zip(edges[::2], edges[1::2]):  # each breath-to-breath stretch
        cuts = [a] + sorted(k for k in on if a + MIN_NOTE / 0.01 <= k <= b - MIN_NOTE / 0.01) + [b]
        cuts = [c for i, c in enumerate(cuts) if i == 0 or c - cuts[i - 1] >= MIN_NOTE / 0.01 or c == b]
        for s, e in zip(cuts, cuts[1:]):
            notes += syllable(midi, s, e)
    # same pitch across an onset with no gap = one held note re-attacked; keep separate (a new
    # syllable is a new target), but drop slivers
    return [x for x in notes if x["d"] >= MIN_NOTE], tune


def syllable(midi, s, e):
    """One syllable -> its note(s): the pitch held longest; a 2nd pitch only if held >= HELD."""
    seg = midi[s:e]
    seg = seg[~np.isnan(seg)]
    if len(seg) * 0.01 < MIN_NOTE:
        return []
    q = np.round(seg).astype(int)
    vals, cnt = np.unique(q, return_counts=True)
    main = int(vals[np.argmax(cnt)])
    # runs of steady pitch (frames rounded to the same semitone, allowing 1-frame blips)
    runs, cur, start = [], None, 0
    for i, x in enumerate(np.round(midi[s:e])):
        x = None if np.isnan(x) else int(x)
        if x != cur:
            if cur is not None:
                runs.append((s + start, s + i, cur))
            cur, start = x, i
    if cur is not None:
        runs.append((s + start, e, cur))
    held = [r for r in runs if (r[1] - r[0]) * 0.01 >= HELD]
    if len({r[2] for r in held}) <= 1:
        return [note(midi, s, e, main)]
    # two or more real notes in one syllable: split at the start of each held run of a new pitch
    out, t0, p0 = [], s, held[0][2]
    for r in held[1:]:
        if r[2] != p0:
            out.append(note(midi, t0, r[0], p0))
            t0, p0 = r[0], r[2]
    out.append(note(midi, t0, e, p0))
    return [x for x in out if x["d"] >= MIN_NOTE]


def note(midi, s, e, p):
    """p = the held semitone; c = the exact median pitch of the frames near it (how sure we are)."""
    seg = midi[s:e]
    seg = seg[np.abs(seg - p) < 1.0]
    c = float(np.median(seg)) if len(seg) else float(p)
    return {"t": round(s * 0.01, 3), "d": round((e - s) * 0.01, 3), "p": p, "c": round(c, 2)}


fold = lambda d: (d + 6) % 12 - 6  # pitch difference ignoring octaves (scoring ignores them too)
SURE = 0.7  # semitones: the check's exact pitch must be at least this far from the target to flag it


def ov(a, b):
    return max(0.0, min(a["t"] + a["d"], b["t"] + b["d"]) - max(a["t"], b["t"]))


def compare(notes, check, lyrics=()):
    """Spots where the pitch targets and the check singer disagree. Same rules as the app's ⚠ marks.
    Speech under spoken lyric lines is not a missing note (2026-11-24: 8 of the 31 flags left on the
    user's finished These Palace Walls were its spoken intro)."""
    check = prep.drop_spoken([dict(x) for x in check], list(lyrics))[0]
    flags = []
    for i, n in enumerate(notes):
        hits = [c for c in check if ov(n, c) > 0]
        sung = sum(ov(n, c) for c in hits)
        if sung < 0.3 * n["d"]:
            flags.append((n["t"], f"target {nn(n['p'])} {n['d']:.2f}s: the check singer hears no singing here"))
            continue
        by = {}
        for c in hits:
            k = fold(c["p"] - n["p"])
            by[k] = by.get(k, 0) + ov(n, c)
        k, share = max(by.items(), key=lambda kv: kv[1])
        main = max((c for c in hits if fold(c["p"] - n["p"]) == k), key=lambda c: ov(n, c))
        if k and share >= 0.5 * n["d"] and abs(fold(main["c"] - n["p"])) >= SURE:
            flags.append((n["t"], f"target {nn(n['p'])}: check singer sings {NAMES[(n['p'] + k) % 12]} ({k:+d} semitones)"))
        last = max(c["t"] + c["d"] for c in hits)
        if n["t"] + n["d"] - last > 0.3 and n["d"] > 0.5:
            flags.append((n["t"], f"target {nn(n['p'])} {n['d']:.2f}s: singing stops {n['t'] + n['d'] - last:.1f}s before the target ends (too long?)"))
    for c in check:
        cov = sum(ov(c, n) for n in notes)
        if c["d"] >= 0.3 and cov < 0.3 * c["d"]:
            flags.append((c["t"], f"no target for a sung {nn(c['p'])} ({c['d']:.2f}s) (missing note?)"))
    return sorted(flags)


NAMES = "C C# D D# E F F# G G# A A# B".split()
nn = lambda p: f"{NAMES[p % 12]}{p // 12 - 1}"
mmss = lambda t: f"{int(t // 60)}:{t % 60:04.1f}"


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    if arg and Path(arg).is_file():
        packs = [Path(arg)]
    else:
        packs = [p for p in sorted(prep.SONGS_DIR.glob("*.song")) if arg.lower() in p.stem.lower()]
    if not packs:
        say(f"no pack matches {arg!r} in {prep.SONGS_DIR}")
    for path in packs:
        meta, audio = read_pack(path)
        say(f"\n== {meta.get('name') or meta['title']}  ({path.name})")
        if meta.get("kind") == "instrumental":
            say("   instrumental pack: no sung vocals to check against, skipped")
            continue
        check, tune = sing(load_vocals(audio["vocals.mp3"]))
        flags = compare(meta["notes"], check, meta.get("lyrics", []))
        say(f"   check singer: {len(check)} notes · targets: {len(meta['notes'])} · disagreements: {len(flags)}")
        for t, msg in flags:
            say(f"   {mmss(t)}  {msg}")
        backup = prep.TOOLS / "backup" / f"{path.stem}.{time.strftime('%Y%m%d-%H%M')}.song"
        backup.parent.mkdir(exist_ok=True)
        shutil.copy2(path, backup)
        meta["check"] = {"notes": check, "at": int(time.time() * 1000), "method": "pyin + onsets, one note per syllable",
                         "flags": len(flags)}
        write_pack(path, meta, audio)
        say(f"   saved the check tune into the pack (backup: {backup.name})")
    LOG.write_text("\n".join(report) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
