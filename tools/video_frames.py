"""Download a video (low res) and save one frame per second, for reading on-screen lyrics.
Usage: video_frames.py <youtube url> <out folder> [fps=1]
Frames: <out>/f_00001.png = second 0 (frame n is at (n-1)/fps s)."""
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "prep"))
import prep  # noqa: E402
import yt_dlp  # noqa: E402

url, out = sys.argv[1], Path(sys.argv[2])
fps = sys.argv[3] if len(sys.argv) > 3 else "1"
out.mkdir(parents=True, exist_ok=True)
vid = out / "video.mp4"
if not vid.exists():
    with yt_dlp.YoutubeDL({"format": "bv*[height<=720][ext=mp4]/bv*[height<=720]/best", "outtmpl": str(vid),
                           "quiet": True, "noplaylist": True, "ffmpeg_location": str(prep.BIN)}) as y:
        y.download([url])
subprocess.run([prep.FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", str(vid),
                "-vf", f"fps={fps}", str(out / "f_%05d.png")], check=True)
print(len(list(out.glob("f_*.png"))), "frames in", out)
