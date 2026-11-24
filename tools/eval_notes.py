"""Score ways of making pitch targets against notes the user repaired by ear (user, 2026-11-24:
"It may take some development effort for you to get a good bead on the melodies core notes and
spacing" -> "Yes, improve prep").

Ground truth: PitchScoreGameTools\\truth\\<song>.json = {"song", "until", "notes"}, the user's
repaired targets from 0 s to `until` (made once with --snapshot; kept outside the public repo).
A made note is right when its pitch matches (octaves ignored, like scoring) and it starts within
0.15 s of a truth note. Reports recall (truth notes found), precision (made notes that are real),
F1, and the median start / end error of the matches.

Usage: eval_notes.py --snapshot <name part> <until s>   (store the Drive pack's current notes as truth)
       eval_notes.py                                     (score every variant on every truth song)
Report: tools\\eval_notes.log"""
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "prep"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import prep  # noqa: E402
from trim_song import read_pack  # noqa: E402

TRUTH = prep.TOOLS / "truth"
LOG = Path(__file__).with_name("eval_notes.log")
ONSET_TOL = 0.15
report = [f"eval notes {time.strftime('%Y-%m-%d %H:%M')}"]


def say(s=""):
    print(s, flush=True)
    report.append(s)


def fold(d):
    return (d + 6) % 12 - 6


def score(truth, made, until):
    made = [n for n in made if n["t"] < until]
    used, hits = set(), []
    for u in truth:
        best = None
        for j, c in enumerate(made):
            if j in used or abs(c["t"] - u["t"]) > ONSET_TOL or fold(c["p"] - u["p"]):
                continue
            if best is None or abs(c["t"] - u["t"]) < abs(made[best]["t"] - u["t"]):
                best = j
        if best is not None:
            used.add(best)
            hits.append((u, made[best]))
    r = len(hits) / max(1, len(truth))
    p = len(hits) / max(1, len(made))
    f1 = 2 * r * p / max(1e-9, r + p)
    ds = np.array([c["t"] - u["t"] for u, c in hits]) if hits else np.zeros(1)
    de = np.array([(c["t"] + c["d"]) - (u["t"] + u["d"]) for u, c in hits]) if hits else np.zeros(1)
    return dict(f1=f1, recall=r, precision=p, n=len(made), start=float(np.median(ds)), start_abs=float(np.median(abs(ds))),
                end=float(np.median(de)), end_abs=float(np.median(abs(de))))


def snapshot(part, until):
    pack = next(p for p in prep.SONGS_DIR.glob("*.song") if part.lower() in p.stem.lower())
    meta = read_pack(pack)[0]
    TRUTH.mkdir(exist_ok=True)
    notes = [n for n in meta["notes"] if n["t"] < until]
    (TRUTH / f"{pack.stem}.json").write_text(json.dumps({"song": pack.stem, "until": until, "notes": notes,
                                                         "at": time.strftime("%Y-%m-%d %H:%M")}), encoding="utf-8")
    say(f"truth stored: {pack.stem}, {len(notes)} notes before {until} s")


def main(variants):
    for f in sorted(TRUTH.glob("*.json")):
        tr = json.loads(f.read_text(encoding="utf-8"))
        work = prep.WORK / tr["song"]
        say(f"\n== {tr['song']}  ({len(tr['notes'])} truth notes, 0-{tr['until']} s)")
        say(f"   {'variant':34} {'F1':>5} {'found':>6} {'real':>6} {'notes':>6} {'start':>7} {'|start|':>8} {'end':>7} {'|end|':>7}")
        for name, fn in variants:
            try:
                s = score(tr["notes"], fn(work), tr["until"])
            except Exception as e:  # report and go on
                say(f"   {name:34} FAILED: {e}")
                continue
            say(f"   {name:34} {s['f1']:5.2f} {s['recall']:6.0%} {s['precision']:6.0%} {s['n']:6d} {s['start']:+7.2f} {s['start_abs']:8.2f} {s['end']:+7.2f} {s['end_abs']:7.2f}")
    LOG.write_text("\n".join(report) + "\n", encoding="utf-8")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--snapshot":
        snapshot(sys.argv[2], float(sys.argv[3]))
        LOG.write_text("\n".join(report) + "\n", encoding="utf-8")
    else:
        from note_variants import VARIANTS
        main(VARIANTS)
