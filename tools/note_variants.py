"""Ways of making pitch targets from a prep work folder, scored by eval_notes.py.
Slow steps (CREPE, Whisper, pYIN) are cached in <work>\\eval_cache."""
import copy
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "prep"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import prep  # noqa: E402
import check_notes  # noqa: E402

_mem = {}


def cached(work, key, make):
    k = (str(work), key)
    if k in _mem:
        return copy.deepcopy(_mem[k])
    d = work / "eval_cache"
    d.mkdir(exist_ok=True)
    f = d / f"{key}.json"
    if f.exists():
        v = json.loads(f.read_text())
    else:
        v = make()
        f.write_text(json.dumps(v))
    _mem[k] = v
    return copy.deepcopy(v)


def midi(work, stem):
    f = work / "eval_cache" / f"crepe_{stem}.npy"
    if not f.exists():
        f.parent.mkdir(exist_ok=True)
        np.save(f, prep.track_pitch(work, work / f"{stem}.wav"))
    return np.load(f)


def raw_notes(work, stem):
    return cached(work, f"notes_{stem}", lambda: prep.to_notes(midi(work, stem))[0])


def segs(work):
    return cached(work, "whisper", lambda: prep.transcribe(work / "vocals.wav", raw_notes(work, "lead")))


def melisma(work, notes):
    return prep.simplify_melisma(notes, segs(work))[0]


def onsets(work):
    def make():
        import librosa
        y, sr = librosa.load(work / "vocals.wav", sr=16000, mono=True)
        return librosa.onset.onset_detect(y=y, sr=sr, hop_length=160, backtrack=True, units="time", delta=0.07).tolist()
    return cached(work, "onsets", make)


def ov(a, b):
    return max(0.0, min(a["t"] + a["d"], b["t"] + b["d"]) - max(a["t"], b["t"]))


def fill(base, extra):
    """base + the notes of extra that sing where base has nothing (other singers' lines)."""
    return prep.fill_from(base, extra)[0]


def snap(work, notes, back=0.35):
    """Start each note at the vocal onset just before it (prep's smoothing starts notes late)."""
    on = np.array(onsets(work))
    prev_end = -1.0
    for n in notes:
        c = on[(on >= max(n["t"] - back, prev_end)) & (on <= n["t"] + 0.02)]
        if len(c):
            o = float(c[-1])
            n["d"] = round(n["d"] + n["t"] - o, 3)
            n["t"] = round(o, 3)
        prev_end = n["t"] + n["d"]
    return notes


def pyin_check(work):
    def make():
        import soundfile as sf
        import librosa
        w, sr = sf.read(work / "vocals.wav", dtype="float32", always_2d=True)
        return check_notes.sing(librosa.resample(w.mean(1), orig_sr=sr, target_sr=check_notes.SR))[0]
    return cached(work, "pyin_vocals", make)


def tune(work, stem):
    return cached(work, f"tune_{stem}", lambda: prep.to_notes(midi(work, stem))[1])


def lyrics(work):
    pack = prep.SONGS_DIR / f"{work.name}.song"
    import zipfile
    with zipfile.ZipFile(pack) as z:
        return json.loads(z.read("song.json")).get("lyrics", [])


def nospoken(work, notes):
    return prep.drop_spoken(notes, lyrics(work))[0]


def split(work, stem, notes):
    return prep.split_at_words(notes, segs(work), midi(work, stem), tune(work, stem))


def light(work, stem, smooth):
    return cached(work, f"notes_{stem}_s{smooth}", lambda: prep.to_notes(midi(work, stem), smooth_s=smooth)[0])


VARIANTS = [
    ("prep now (lead only)", lambda w: melisma(w, raw_notes(w, "lead"))),
    ("all vocals", lambda w: melisma(w, raw_notes(w, "vocals"))),
    ("lead + fill from all vocals", lambda w: melisma(w, fill(raw_notes(w, "lead"), raw_notes(w, "vocals")))),
    ("check singer (pYIN, all vocals)", pyin_check),
    ("prep now + onset snap", lambda w: snap(w, melisma(w, raw_notes(w, "lead")))),
    ("all vocals + onset snap", lambda w: snap(w, melisma(w, raw_notes(w, "vocals")))),
    ("lead + fill + onset snap", lambda w: snap(w, melisma(w, fill(raw_notes(w, "lead"), raw_notes(w, "vocals"))))),
    # 2nd round: no spoken lines; keep syllables apart
    ("all vocals - spoken", lambda w: nospoken(w, melisma(w, raw_notes(w, "vocals")))),
    ("all vocals - spoken, no melisma fold", lambda w: nospoken(w, raw_notes(w, "vocals"))),
    ("all vocals - spoken, smooth 0.08", lambda w: nospoken(w, melisma(w, light(w, "vocals", 0.08)))),
    ("all vocals - spoken, split at words", lambda w: nospoken(w, split(w, "vocals", melisma(w, raw_notes(w, "vocals"))))),
    ("lead+fill - spoken, split at words", lambda w: nospoken(w, split(w, "vocals", melisma(w, fill(raw_notes(w, "lead"), raw_notes(w, "vocals")))))),
    ("check singer - spoken", lambda w: nospoken(w, pyin_check(w))),
    # 3rd round: keep the lead singer, fill other singers' lines, no speech
    ("lead+fill - spoken", lambda w: nospoken(w, melisma(w, fill(raw_notes(w, "lead"), raw_notes(w, "vocals"))))),
    ("lead+fill - spoken, smooth 0.08", lambda w: nospoken(w, melisma(w, fill(light(w, "lead", 0.08), light(w, "vocals", 0.08))))),
    ("lead+fill - spoken, smooth 0.05", lambda w: nospoken(w, melisma(w, fill(light(w, "lead", 0.05), light(w, "vocals", 0.05))))),
    ("lead+fill(check) - spoken, s0.08", lambda w: nospoken(w, melisma(w, fill(light(w, "lead", 0.08), pyin_check(w))))),
]
