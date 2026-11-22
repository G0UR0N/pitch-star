"""Build a synthetic test song (Twinkle Twinkle, public domain) and run it through prep.
Skips vocal separation by writing the stems directly."""
from pathlib import Path

import numpy as np
import soundfile as sf

import prep

SR = 44100
BPM = 100
beat = 60 / BPM
# (midi, beats)
mel = [(60,1),(60,1),(67,1),(67,1),(69,1),(69,1),(67,2),(65,1),(65,1),(64,1),(64,1),(62,1),(62,1),(60,2),
       (67,1),(67,1),(65,1),(65,1),(64,1),(64,1),(62,2),(67,1),(67,1),(65,1),(65,1),(64,1),(64,1),(62,2)] * 2

def voice(midi, dur):
    t = np.arange(int(dur * SR)) / SR
    f = 440 * 2 ** ((midi - 69) / 12) * (1 + 0.004 * np.sin(2 * np.pi * 5.5 * t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = sum(np.sin(k * ph) / k ** 1.3 for k in range(1, 8))
    env = np.minimum(1, t / 0.03) * np.minimum(1, (dur - t) / 0.08).clip(0)
    return 0.25 * x * env

lead = 2.0
total = lead + sum(b for _, b in mel) * beat + 2
vox = np.zeros(int(total * SR))
pos = lead
for m, b in mel:
    d = b * beat
    seg = voice(m, d * 0.92)
    i = int(pos * SR); vox[i:i + len(seg)] += seg
    pos += d
# rest between phrases is implicit via note gaps; add a simple chord pad backing
t = np.arange(len(vox)) / SR
back = 0.05 * sum(np.sin(2 * np.pi * 440 * 2 ** ((m - 69) / 12) * t) for m in (48, 55, 64))

title = "Twinkle Test"
out = prep.WORK / prep.slugify(title)
out.mkdir(parents=True, exist_ok=True)
sf.write(out / "vocals.wav", np.stack([vox, vox], 1), SR)
sf.write(out / "backing.wav", np.stack([back, back], 1), SR)
src = out / f"{title}.wav"
sf.write(src, np.stack([vox + back] * 2, 1), SR)
prep.prep(str(src))
