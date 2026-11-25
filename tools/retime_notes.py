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


def pick_track(tracks, n):
    """The pitch track that carries this note best (most frames on its pitch): the separated lead
    voice where it sings the note, all vocals for other singers (2026-11-24: Where Are You Christmas
    has a choir behind Faith Hill; These Palace Walls has several singers)."""
    k0, k1 = int(n["t"] * 100), int((n["t"] + n["d"]) * 100)
    return max(tracks, key=lambda mv: sum(on_pitch(mv, k, n["p"]) for k in range(k0 - 10, k1 + 10)))


def voiced(mv, k):
    return 0 <= k < len(mv) and not np.isnan(mv[k])


def retime(notes, tracks, onsets, ends=False):
    """Starts to the syllable's attack; with ends=True also each end to where the voice stops
    (user, 2026-11-24: "fix timing and durations as you see fit")."""
    if not isinstance(tracks, list):
        tracks = [tracks]
    out, moves = [dict(n) for n in notes], []
    for i, n in enumerate(out):
        mv = pick_track(tracks, n)
        run = sung_run(mv, n)
        if not run:
            continue
        start, end = n["t"], n["t"] + n["d"]
        # --- start: the attack just before the pitch is reached (scoops keep the old start) ---
        reach = run[0]
        att = onsets[(onsets >= reach - ATTACK_BEFORE) & (onsets <= reach + 0.03)]
        s = float(att[-1]) if len(att) else reach
        if i:
            prev = out[i - 1]
            s = max(s, min(n["t"], prev["t"] + prev["d"]))  # never into the previous note
        by = s - n["t"]
        ok = MIN_MOVE <= abs(by) <= MAX_MOVE and end - s >= 0.1
        if ok and by > 0:
            # later only if, at the old start, nobody is singing yet OR the singer is still holding the
            # previous note (she hasn't moved on). Any other voice there is a scoop up into this note:
            # the syllable starts on time, only the pitch arrives late (the rhythm is the syllable).
            # (2026-11-24: "still on the previous note" added for Where Are You Christmas, whose
            # targets ran 0.1-0.25 s early in places while the scoop rule held them.)
            gap = mv[int(n["t"] * 100):int(s * 100)]
            sung = gap[~np.isnan(gap)] if len(gap) else gap
            prev_p = out[i - 1]["p"] if i else None
            held = prev_p is not None and len(sung) and np.mean(abs(((sung - prev_p) + 6) % 12 - 6) < 0.6) >= 0.7
            ok = not (len(gap) and np.isnan(gap).mean() < 0.7) or bool(held)
        if ok:
            moves.append((n["t"], nn(n["p"]), "start", by))
            start = s
        # --- end: where the voice stops (any pitch: ornaments belong to the note), never into the next note ---
        if ends:
            nxt = out[i + 1]["t"] if i + 1 < len(out) else 1e9
            k = int(round(end * 100))
            if voiced(mv, k - 1) and voiced(mv, k):  # still singing at the end: follow the voice
                j = k
                while j < k + int(MAX_MOVE * 100) and (voiced(mv, j) or voiced(mv, j + 1) or voiced(mv, j + 2)):
                    j += 1
                e = min(j / 100, nxt - 0.02)
            elif not voiced(mv, k - 1):  # the note runs on into silence: end where the voice stopped
                j = k - 1
                while j > int(start * 100) and not voiced(mv, j):
                    j -= 1
                e = (j + 1) / 100
            else:
                e = end
            by = e - end
            if MIN_MOVE <= abs(by) <= MAX_MOVE and e - start >= 0.1:
                moves.append((n["t"], nn(n["p"]), "end", by))
                end = e
        n["t"], n["d"] = round(start, 3), round(end - start, 3)
    return out, moves


def voiced_share(tracks, notes):
    """Share of target time where the chosen voice is actually singing."""
    on = tot = 0
    for n in notes:
        mv = pick_track(tracks, n)
        ks = range(int(n["t"] * 100), int((n["t"] + n["d"]) * 100))
        tot += len(ks)
        on += sum(voiced(mv, k) for k in ks)
    return on / max(1, tot)


def main():
    part = sys.argv[1]
    pack = next(p for p in prep.SONGS_DIR.glob("*.song") if part.lower() in p.stem.lower())
    meta, audio = read_pack(pack)
    work = prep.WORK / pack.stem
    tune = V.tune(work, "vocals")
    mv = V.midi(work, "vocals") - tune
    tracks = [mv] + ([V.midi(work, "lead") - tune] if (work / "lead.wav").exists() else [])
    onsets = np.array(V.onsets(work))
    ends = "--ends" in sys.argv
    new, moves = retime(meta["notes"], tracks, onsets, ends)
    say(f"== {pack.stem}: {len({m[0] for m in moves})} of {len(new)} notes changed "
        f"({sum(m[2] == 'start' for m in moves)} starts, {sum(m[2] == 'end' for m in moves)} ends)")
    for t, name, what, d in moves:
        word = ("earlier" if d < 0 else "later") if what == "start" else ("shorter" if d < 0 else "longer")
        say(f"   {mmss(t)} {name:4} {what:5} {word:7} by {abs(d):.2f}s")
    a0, a1 = agreement(mv, meta["notes"]), agreement(mv, new)
    say(f"time on the sung pitch: before {a0:.1%}, after {a1:.1%}")
    say(f"target time with the voice singing: before {voiced_share(tracks, meta['notes']):.1%}, after {voiced_share(tracks, new):.1%}")
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
