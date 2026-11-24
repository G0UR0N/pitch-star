"""Re-time a song's targets so each starts where its sung syllable starts (user, 2026-11-24: "save
off a copy of mine and you take a stab at timing corrections so that the melody cadence is a better
match").

For each target: find the stretch of singing on its pitch (octaves ignored) that overlaps it most
(prep's CREPE track of all vocals). The syllable starts at the vocal attack just before the singer
reaches the pitch (a scoop up into a note doesn't count as late), or where the pitch is reached if
there is no attack within 0.15 s before it. The start moves there; the end stays where it was (your
rhythm feel). Only clear cases move: 0.04-0.30 s, never into the previous note, length >= 0.1 s,
and never where the note isn't sung on its own pitch (harmony spots: that is your ear's call).

Usage: retime_notes.py <name part> [--write]   (dry run without --write)
Writes the Drive pack (backup first) and stamps editedAt/editsMerged so devices re-adding it take it.
Report: tools\\retime_notes.log"""
import shutil
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "prep"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import prep  # noqa: E402
import note_variants as V  # noqa: E402
from check_notes import compare, mmss, nn  # noqa: E402
from trim_song import read_pack, write_pack  # noqa: E402

LOG = Path(__file__).with_name("retime_notes.log")
MIN_MOVE, MAX_MOVE, ATTACK_BEFORE = 0.04, 0.30, 0.15
report = [f"retime notes {time.strftime('%Y-%m-%d %H:%M')}"]


def say(s=""):
    print(s, flush=True)
    report.append(s)


def on_pitch(mv, k, p):
    return 0 <= k < len(mv) and not np.isnan(mv[k]) and abs(((mv[k] - p) + 6) % 12 - 6) < 0.6


def sung_run(mv, n):
    """(start, end) s of the singing on n's pitch that overlaps n most, or None."""
    k0, k1 = int(n["t"] * 100), int((n["t"] + n["d"]) * 100)
    hits = [k for k in range(k0 - 35, k1 + 35) if on_pitch(mv, k, n["p"])]
    runs, cur = [], []
    for k in hits:
        if cur and k - cur[-1] > 3:
            runs.append(cur)
            cur = []
        cur.append(k)
    if cur:
        runs.append(cur)
    best = max(runs, key=lambda r: len(set(r) & set(range(k0, k1))), default=None)
    if not best or len(set(best) & set(range(k0, k1))) < 3:
        return None
    return best[0] / 100, (best[-1] + 1) / 100


def agreement(mv, notes):
    ok = tot = 0
    for n in notes:
        seg = mv[int(n["t"] * 100):int((n["t"] + n["d"]) * 100)]
        seg = seg[~np.isnan(seg)]
        tot += len(seg)
        ok += int((abs(((seg - n["p"]) + 6) % 12 - 6) < 0.6).sum())
    return ok / max(1, tot)


def retime(notes, mv, onsets):
    out, moves = [dict(n) for n in notes], []
    for i, n in enumerate(out):
        run = sung_run(mv, n)
        if not run:
            continue
        reach = run[0]
        att = onsets[(onsets >= reach - ATTACK_BEFORE) & (onsets <= reach + 0.03)]
        start = float(att[-1]) if len(att) else reach
        end = n["t"] + n["d"]
        if i:
            prev = out[i - 1]
            start = max(start, min(n["t"], prev["t"] + prev["d"]))  # never into the previous note
        mv_by = start - n["t"]
        if not MIN_MOVE <= abs(mv_by) <= MAX_MOVE or end - start < 0.1:
            continue
        # later only if nobody is singing at the old start: a scoop up into the note starts the
        # syllable on time, only the pitch arrives late (the rhythm is the syllable, not the pitch)
        if mv_by > 0:
            gap = mv[int(n["t"] * 100):int(start * 100)]
            if len(gap) and np.isnan(gap).mean() < 0.7:
                continue
        moves.append((n["t"], nn(n["p"]), mv_by))
        n["t"], n["d"] = round(start, 3), round(end - start, 3)
    return out, moves


def main():
    part = sys.argv[1]
    pack = next(p for p in prep.SONGS_DIR.glob("*.song") if part.lower() in p.stem.lower())
    meta, audio = read_pack(pack)
    work = prep.WORK / pack.stem
    mv = V.midi(work, "vocals") - V.tune(work, "vocals")
    onsets = np.array(V.onsets(work))
    new, moves = retime(meta["notes"], mv, onsets)
    say(f"== {pack.stem}: {len(moves)} of {len(new)} notes re-timed")
    for t, name, d in moves:
        say(f"   {mmss(t)} {name:4} start {'earlier' if d < 0 else 'later':7} by {abs(d):.2f}s")
    a0, a1 = agreement(mv, meta["notes"]), agreement(mv, new)
    say(f"time on the sung pitch: before {a0:.1%}, after {a1:.1%}")
    for a in range(15, int(meta["duration"]) + 1, 10):
        p0 = [n for n in meta["notes"] if a <= n["t"] < a + 10]
        p1 = [n for n in new if a <= n["t"] < a + 10]
        if p0:
            say(f"   {a:3d}-{a + 10:3d}s  {agreement(mv, p0):.0%} -> {agreement(mv, p1):.0%}")
    if meta.get("check"):
        f0 = len(compare(meta["notes"], meta["check"]["notes"], meta.get("lyrics", [])))
        f1 = len(compare(new, meta["check"]["notes"], meta.get("lyrics", [])))
        say(f"check singer flags: before {f0}, after {f1}")
    if "--write" in sys.argv:
        backup = prep.TOOLS / "backup" / f"{pack.stem}.{time.strftime('%Y%m%d-%H%M')}.song"
        shutil.copy2(pack, backup)
        now = int(time.time() * 1000)
        meta.update(notes=new, phrases=prep.to_phrases(new), edited=True, editedAt=now, editsMerged=now)
        write_pack(pack, meta, audio)
        say(f"written (backup: {backup.name})")
    LOG.write_text("\n".join(report) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
