"""Print the lyrics (with times) of .song packs. Usage: show_lyrics.py <file.song|folder> ..."""
import json
import sys
import zipfile
from pathlib import Path

for a in sys.argv[1:]:
    p = Path(a)
    for f in sorted(p.glob("*.song")) if p.is_dir() else [p]:
        m = json.loads(zipfile.ZipFile(f).read("song.json"))
        print(f"## {m['title']}  ({m['duration']}s)  check={m.get('lyricsCheck', 'NOT verified')}")
        for l in m.get("lyrics") or []:
            print(f"   {l['t'] if l['t'] is not None else '-':>7}  {l['text']}")
