"""Summarize a .song pack: notes, range, sections, lyrics count, note-length stats.
Usage: inspect_song.py <file.song> [work_dir_with_stems]"""
import json
import sys
import zipfile

N = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
name = lambda p: f"{N[p % 12]}{p // 12 - 1}"
m = json.loads(zipfile.ZipFile(sys.argv[1]).read('song.json'))
n = m['notes']
ds = sorted(x['d'] for x in n)
print(f"{m.get('kind')} | {len(n)} notes | range {name(m['range'][0])}-{name(m['range'][1])} | {m['duration']}s | "
      f"{len(m['phrases'])} sections | {len(m.get('lyrics', []))} lyric lines")
print(f"note length: median {ds[len(ds)//2]:.2f}s, shortest 10% < {ds[len(ds)//10]:.2f}s")
print("first notes:", ' '.join(f"{x['t']:.1f}:{name(x['p'])}" for x in n[:24]))
if len(sys.argv) > 2:
    import numpy as np
    import soundfile as sf
    rms = lambda f: float(np.sqrt((sf.read(f, dtype='float32')[0] ** 2).mean()))
    v, l = rms(sys.argv[2] + '/vocals.wav'), rms(sys.argv[2] + '/lead.wav')
    print(f"lead/all-vocals energy: {l / v:.2f}  (backup share ~{max(0, 1 - (l / v) ** 2):.0%})")
