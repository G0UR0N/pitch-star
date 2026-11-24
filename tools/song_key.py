"""Estimate the key of .song packs: from the target notes, and from the backing music itself
(chroma), so you can see the notes match the recording and compare versions of a song.
Usage: song_key.py <file.song> [...]"""
import io
import json
import sys
import zipfile

import numpy as np

NAMES = "C C# D D# E F F# G G# A A# B".split()
MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def key_of(prof):
    best = max(((np.corrcoef(np.roll(p, k), prof)[0, 1], k, m) for p, m in ((MAJ, "major"), (MIN, "minor"))
                for k in range(12)), key=lambda x: x[0])
    return f"{NAMES[best[1]]} {best[2]}", best[0]


for f in sys.argv[1:]:
    z = zipfile.ZipFile(f)
    meta = json.loads(z.read("song.json"))
    prof = np.zeros(12)
    for n in meta["notes"]:
        prof[n["p"] % 12] += n["d"]
    nk, nc = key_of(prof)
    import librosa
    y, sr = librosa.load(io.BytesIO(z.read("backing.mp3")), sr=22050, mono=True)
    ak, ac = key_of(librosa.feature.chroma_cqt(y=y, sr=sr).sum(1))
    ps = [n["p"] for n in meta["notes"]]
    lo, hi = (librosa.midi_to_note(int(np.percentile(ps, q))) for q in (3, 97))
    # relative major/minor share a key signature (F major = D minor): count that as a match
    tonic = lambda k: (NAMES.index(k.split()[0]) + (3 if k.endswith("minor") else 0)) % 12
    ok = "MATCH" if tonic(nk) == tonic(ak) else "DIFFERENT"
    print(f"{meta['title'][:60]:60s}  notes: {nk} ({nc:.2f})  music: {ak} ({ac:.2f})  -> {ok}  range {lo}-{hi}  {len(ps)} notes")
