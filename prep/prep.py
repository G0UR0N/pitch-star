"""Song prep: YouTube URL or audio file -> song pack (.song zip) for the game.

Usage: prep.bat <youtube-url | audio-file> [more ...]
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

ROOT = Path(__file__).resolve().parent.parent
SONGS_DIR = ROOT / "songs"
TOOLS = Path(os.environ.get("PSG_TOOLS", Path.home() / "PitchScoreGameTools"))
WORK = TOOLS / "work"
BIN = TOOLS / "bin"
FFMPEG = str(BIN / "ffmpeg.exe") if (BIN / "ffmpeg.exe").exists() else "ffmpeg"

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
HOP_S = 0.01  # pitch frame = 10 ms


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def slugify(s):
    s = re.sub(r"[^\w\s-]", "", s).strip().lower()
    return re.sub(r"[\s_-]+", "-", s)[:60] or "song"


def ffmpeg(*args):
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


# ---------- 1. get audio ----------
def fetch(src):
    if Path(src).exists():
        p = Path(src)
        title = p.stem
        out = WORK / slugify(title)
        out.mkdir(parents=True, exist_ok=True)
        ffmpeg("-i", str(p), "-ac", "2", "-ar", "44100", str(out / "mix.wav"))
        return title, out

    import yt_dlp

    with yt_dlp.YoutubeDL({"quiet": True, "noplaylist": True}) as y:
        info = y.extract_info(src, download=False)
    title = info.get("title") or info.get("id")
    out = WORK / slugify(title)
    out.mkdir(parents=True, exist_ok=True)
    if (out / "mix.wav").exists():
        log("audio already downloaded")
        return title, out
    opts = {
        "format": "bestaudio/best",
        "noplaylist": True,
        "outtmpl": str(out / "dl.%(ext)s"),
        "ffmpeg_location": str(BIN) if BIN.exists() else None,
        "quiet": True,
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "wav"}],
    }
    with yt_dlp.YoutubeDL(opts) as y:
        y.download([src])
    ffmpeg("-i", str(out / "dl.wav"), "-ac", "2", "-ar", "44100", str(out / "mix.wav"))
    (out / "dl.wav").unlink(missing_ok=True)
    return title, out


# ---------- 2. separate vocals ----------
def separate(out):
    if (out / "vocals.wav").exists() and (out / "backing.wav").exists():
        log("stems already separated")
        return
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    model = get_model("htdemucs_ft")
    model.eval()
    wav, sr = sf.read(out / "mix.wav", dtype="float32", always_2d=True)
    x = torch.from_numpy(wav.T)
    ref = x.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    x = (x - mean) / std
    with torch.no_grad():
        stems = apply_model(model, x[None], device=DEVICE, shifts=1, split=True, overlap=0.25, progress=True)[0]
    stems = stems * std + mean
    names = model.sources  # drums, bass, other, vocals
    vi = names.index("vocals")
    vocals = stems[vi].cpu().numpy().T
    backing = sum(stems[i] for i in range(len(names)) if i != vi).cpu().numpy().T
    sf.write(out / "vocals.wav", vocals, sr)
    sf.write(out / "backing.wav", backing, sr)


# ---------- 3. pitch track ----------
def track_pitch(out):
    import torchcrepe
    from scipy.ndimage import median_filter
    from scipy.signal import resample_poly

    wav, sr = sf.read(out / "vocals.wav", dtype="float32", always_2d=True)
    mono = wav.mean(1)
    audio16 = resample_poly(mono, 16000, sr).astype(np.float32)
    hop = int(16000 * HOP_S)
    f0, per = torchcrepe.predict(
        torch.from_numpy(audio16)[None], 16000, hop, 65.0, 1100.0, "full",
        decoder=torchcrepe.decode.viterbi, return_periodicity=True,
        batch_size=1024, device=DEVICE,
    )
    f0 = f0[0].cpu().numpy()
    per = per[0].cpu().numpy()
    per = median_filter(per, 3)
    # loudness gate (vocal stem has bleed / silence)
    n = len(f0)
    frame = np.lib.stride_tricks.sliding_window_view(np.pad(audio16, (0, hop * 2)), hop * 2)[::hop][:n]
    rms_db = 20 * np.log10(np.sqrt((frame ** 2).mean(1)) + 1e-9)
    loud = rms_db > (np.percentile(rms_db, 95) - 35)
    voiced = (per > 0.45) & loud
    midi = 69 + 12 * np.log2(np.maximum(f0, 1e-3) / 440.0)
    midi = median_filter(midi, 5)
    midi[~voiced] = np.nan
    return midi


# ---------- 4. notes ----------
def to_notes(midi):
    v = ~np.isnan(midi)
    # global tuning offset (recordings are rarely exactly A440)
    frac = midi[v] - np.round(midi[v])
    ang = np.angle(np.mean(np.exp(2j * np.pi * frac)))
    tune = ang / (2 * np.pi)
    m = midi - tune

    # hysteresis quantization -> runs
    runs = []  # [start_frame, end_frame_excl, pitch]
    cur = None
    for i, x in enumerate(m):
        if np.isnan(x):
            cur = None
            continue
        if cur is None or abs(x - cur) > 0.7:
            cur = int(round(x))
            runs.append([i, i + 1, cur])
        else:
            runs[-1][1] = i + 1

    min_len = int(0.08 / HOP_S)
    # absorb short runs into touching neighbors, else drop
    changed = True
    while changed:
        changed = False
        for k, r in enumerate(runs):
            if r[1] - r[0] >= min_len:
                continue
            prev = runs[k - 1] if k > 0 and runs[k - 1][1] == r[0] else None
            nxt = runs[k + 1] if k + 1 < len(runs) and runs[k + 1][0] == r[1] else None
            if prev and (not nxt or prev[1] - prev[0] >= nxt[1] - nxt[0]):
                prev[1] = r[1]
            elif nxt:
                nxt[0] = r[0]
            runs.pop(k)
            changed = True
            break
    # merge same-pitch runs with tiny gaps
    merged = []
    for r in runs:
        if merged and merged[-1][2] == r[2] and r[0] - merged[-1][1] <= int(0.03 / HOP_S):
            merged[-1][1] = r[1]
        else:
            merged.append(list(r))
    notes = [
        {"t": round(s * HOP_S, 3), "d": round((e - s) * HOP_S, 3), "p": int(p)}
        for s, e, p in merged
        if (e - s) >= min_len
    ]
    return notes, float(tune)


# ---------- 3b. instrumental: transcribe piano, keep the top line ----------
PIANO_CKPT_URL = "https://zenodo.org/record/4034264/files/CRNN_note_F1%3D0.9677_pedal_F1%3D0.9186.pth?download=1"


def vocal_ratio(out):
    rms = lambda n: float(np.sqrt((sf.read(out / n, dtype="float32")[0] ** 2).mean()) + 1e-12)
    return rms("vocals.wav") / rms("mix.wav")


def transcribe_melody(out):
    import urllib.request

    from piano_transcription_inference import PianoTranscription
    from scipy.signal import resample_poly

    ckpt = TOOLS / "models" / "piano_transcription.pth"
    if not ckpt.exists():
        log("downloading piano model (one time, ~170 MB)...")
        ckpt.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(PIANO_CKPT_URL, ckpt)
    wav, sr = sf.read(out / "mix.wav", dtype="float32", always_2d=True)
    audio = resample_poly(wav.mean(1), 16000, sr).astype(np.float32)
    tr = PianoTranscription(device=torch.device(DEVICE), checkpoint_path=str(ckpt))
    ev = tr.transcribe(audio, str(out / "piano.mid"))["est_note_events"]
    ev = sorted(ev, key=lambda e: (e["onset_time"], -e["midi_note"]))

    # cluster near-simultaneous onsets; take the top note of each cluster
    clusters = []
    for e in ev:
        if clusters and e["onset_time"] - clusters[-1][0]["onset_time"] < 0.05:
            clusters[-1].append(e)
        else:
            clusters.append([e])
    mel = []
    for c in clusters:
        top = max(c, key=lambda e: e["midi_note"])
        if mel:
            prev = mel[-1]
            sounding = top["onset_time"] < prev["offset_time"]
            # low note under a still-sounding melody note = accompaniment
            if sounding and top["midi_note"] < prev["midi_note"] - 4:
                continue
        mel.append(dict(top))
    notes = []
    for i, e in enumerate(mel):
        end = e["offset_time"]
        if i + 1 < len(mel):
            end = min(end, mel[i + 1]["onset_time"])
        d = end - e["onset_time"]
        if d >= 0.08 and 45 <= e["midi_note"] <= 100:
            notes.append({"t": round(float(e["onset_time"]), 3), "d": round(float(d), 3), "p": int(e["midi_note"])})
    # move into a singable octave (median near F4); scoring ignores octave anyway
    if notes:
        shift = 12 * round((np.median([n["p"] for n in notes]) - 65) / 12)
        for n in notes:
            n["p"] -= shift
    return notes


def synth_guide(out, notes):
    """Soft tone melody used as the 'guide voice' when there is no singer."""
    info = sf.info(out / "mix.wav")
    sr = info.samplerate
    y = np.zeros(int(info.duration * sr) + sr, np.float32)
    for n in notes:
        t = np.arange(int(n["d"] * sr)) / sr
        f = 440 * 2 ** ((n["p"] - 69) / 12)
        env = np.minimum(1, t / 0.02) * np.minimum(1, (n["d"] - t) / 0.05).clip(0)
        seg = 0.3 * env * (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t))
        i = int(n["t"] * sr)
        y[i:i + len(seg)] += seg[: len(y) - i]
    sf.write(out / "guide.wav", y, sr)


# ---------- 5. phrases ----------
def to_phrases(notes, gap=0.6, max_len=12.0, min_len=2.5):
    if not notes:
        return []
    groups = [[0]]
    for i in range(1, len(notes)):
        prev_end = notes[i - 1]["t"] + notes[i - 1]["d"]
        if notes[i]["t"] - prev_end > gap:
            groups.append([i])
        else:
            groups[-1].append(i)

    def span(g):
        return notes[g[-1]]["t"] + notes[g[-1]]["d"] - notes[g[0]]["t"]

    # split long groups at their biggest internal gap
    out = []
    stack = groups[::-1]
    while stack:
        g = stack.pop()
        if span(g) > max_len and len(g) > 1:
            gaps = [notes[g[j + 1]]["t"] - (notes[g[j]]["t"] + notes[g[j]]["d"]) for j in range(len(g) - 1)]
            j = int(np.argmax(gaps)) + 1
            stack += [g[j:], g[:j]]
        else:
            out.append(g)
    # merge tiny groups into previous
    final = []
    for g in out:
        if final and span(g) < min_len and span(final[-1] + g) <= max_len * 1.3:
            final[-1] += g
        else:
            final.append(g)
    return [
        {"a": g[0], "b": g[-1] + 1, "t0": notes[g[0]]["t"], "t1": round(notes[g[-1]]["t"] + notes[g[-1]]["d"], 3)}
        for g in final
    ]


# ---------- 6. pack ----------
def pack(title, out, notes, phrases, tune, kind="vocal"):
    SONGS_DIR.mkdir(exist_ok=True)
    back_src, guide_src = ("backing.wav", "vocals.wav") if kind == "vocal" else ("mix.wav", "guide.wav")
    ffmpeg("-i", str(out / back_src), "-c:a", "libmp3lame", "-b:a", "160k", str(out / "backing.mp3"))
    ffmpeg("-i", str(out / guide_src), "-ac", "1", "-c:a", "libmp3lame", "-b:a", "96k", str(out / "vocals.mp3"))
    info = sf.info(out / back_src)
    pitches = [n["p"] for n in notes]
    meta = {
        "version": 1,
        "kind": kind,
        "title": title,
        "duration": round(info.duration, 2),
        "tuning": round(tune, 3),
        "range": [int(np.percentile(pitches, 3)), int(np.percentile(pitches, 97))] if pitches else [60, 72],
        "notes": notes,
        "phrases": phrases,
    }
    dest = SONGS_DIR / f"{slugify(title)}.song"
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_STORED) as z:
        z.writestr("song.json", json.dumps(meta, separators=(",", ":")))
        z.write(out / "backing.mp3", "backing.mp3")
        z.write(out / "vocals.mp3", "vocals.mp3")
    return dest, meta


def prep(src, force_kind=None):
    t0 = time.time()
    log(f"source: {src}")
    title, out = fetch(src)
    log(f"title: {title}")
    log(f"separating vocals on {DEVICE} (takes a minute or two)...")
    separate(out)
    kind = force_kind or ("vocal" if vocal_ratio(out) > 0.05 else "instrumental")
    if kind == "vocal":
        log("tracking sung melody...")
        notes, tune = to_notes(track_pitch(out))
    else:
        log("no singer found -> transcribing the instrument melody (top line)...")
        notes, tune = transcribe_melody(out), 0.0
        synth_guide(out, notes)
    phrases = to_phrases(notes)
    if kind == "instrumental":  # pianists jump octaves between sections; keep each in singing range
        for ph in phrases:
            seg = notes[ph["a"]:ph["b"]]
            shift = 12 * round((np.median([n["p"] for n in seg]) - 67) / 12)
            for n in seg:
                n["p"] -= shift
        synth_guide(out, notes)
    dest, meta = pack(title, out, notes, phrases, tune, kind)
    log(f"done in {time.time() - t0:.0f}s: {len(notes)} notes, {len(phrases)} sections -> {dest}")


def main():
    args = sys.argv[1:]
    force = None
    for flag, k in (("--instrumental", "instrumental"), ("--vocal", "vocal")):
        if flag in args:
            force = k
            args.remove(flag)
    srcs = args
    if not srcs:
        s = input("Paste a YouTube link (or drag an audio file here): ").strip().strip('"')
        srcs = [s] if s else []
    failed = 0
    for s in srcs:
        try:
            prep(s, force)
        except Exception as e:  # keep going on batch
            failed += 1
            log(f"FAILED {s}: {e}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
