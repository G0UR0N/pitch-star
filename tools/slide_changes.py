"""List where the picture changes in a folder of 1-fps frames (video_frames.py), so each
lyric slide is read once. Usage: slide_changes.py <frames folder> [threshold=4]
Prints: start s, end s, frame file for each distinct slide."""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

d = Path(sys.argv[1])
thr = float(sys.argv[2]) if len(sys.argv) > 2 else 4.0
files = sorted(d.glob("f_*.png"))
small = lambda f: np.asarray(Image.open(f).convert("L").resize((160, 90)), dtype=np.float32)
prev, start, slides = None, 0, []
for i, f in enumerate(files):
    a = small(f)
    if prev is not None and np.abs(a - prev).mean() > thr:
        slides.append((start, i, files[start].name))
        start = i
    prev = a
slides.append((start, len(files), files[start].name))
for s, e, n in slides:
    print(f"{s:4d}-{e:4d} s  {n}")
