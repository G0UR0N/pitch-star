"""Record a human answer for a rough lyric part (see prep.use_answers), so prep and
lyrics_check use it on every run and never ask again.
Usage: lyrics_answer.py <file.song> <seconds> "<sung line>"   (seconds = where the line starts)
Answers live in <songs folder>/lyrics_answers.json (Drive, not the public repo)."""
import json
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "prep"))
import prep  # noqa: E402

pack, t, text = Path(sys.argv[1]), float(sys.argv[2]), sys.argv[3].strip()
with zipfile.ZipFile(pack) as z:
    title = json.loads(z.read("song.json"))["title"]
try:
    ans = json.loads(prep.ANSWERS.read_text(encoding="utf-8"))
except (OSError, ValueError):
    ans = {}
lst = [x for x in ans.get(title, []) if abs(x["t"] - t) > 0.5]  # replace an answer at the same time
ans[title] = sorted(lst + [{"t": round(t, 2), "text": text}], key=lambda x: x["t"])
prep.ANSWERS.write_text(json.dumps(ans, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"saved: {title} @ {t:.1f} s -> {text!r}  ({prep.ANSWERS})")
