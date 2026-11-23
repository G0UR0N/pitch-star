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
SONGS_DIR = Path(os.environ.get("PSG_SONGS") or ROOT / "songs")
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

    with yt_dlp.YoutubeDL({"quiet": True, "noplaylist": True, "socket_timeout": 20, "retries": 5}) as y:
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
        "socket_timeout": 20,
        "retries": 5,
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


# ---------- 2b. lead vocal only (drop backup singers / harmonies) ----------
LEAD_MODELS = ["mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.ckpt", "UVR_MDXNET_KARA_2.onnx"]


def isolate_lead(out):
    """Karaoke model on the vocal stem: '(Vocals)' = lead singer, '(Instrumental)' = backing vocals."""
    if (out / "lead.wav").exists():
        log("lead vocal already isolated")
        return True
    try:
        from audio_separator.separator import Separator
    except ImportError:
        log("audio-separator not installed; using all vocals")
        return False
    tmp = out / "lead_tmp"
    tmp.mkdir(exist_ok=True)
    sep = Separator(output_dir=str(tmp), model_file_dir=str(TOOLS / "models"), output_format="WAV")
    for model in LEAD_MODELS:
        try:
            sep.load_model(model_filename=model)
            files = sep.separate(str(out / "vocals.wav"))
            lead = next(Path(tmp, Path(f).name) for f in files if "(vocals)" in Path(f).name.lower())
            shutil.move(str(lead), out / "lead.wav")
            log(f"lead vocal isolated with {model}")
            return True
        except Exception as e:  # try the next model
            log(f"lead model {model} failed: {e}")
    return False


# ---------- 3. pitch track ----------
def track_pitch(out):
    import torchcrepe
    from scipy.ndimage import median_filter
    from scipy.signal import resample_poly

    src = out / "vocals.wav"
    if (out / "lead.wav").exists():
        rms = lambda f: float(np.sqrt((sf.read(f, dtype="float32")[0] ** 2).mean()) + 1e-12)
        ratio = rms(out / "lead.wav") / rms(out / "vocals.wav")
        if ratio > 0.3:
            src = out / "lead.wav"
        else:  # karaoke model swallowed the lead (e.g. unusual voice): keep all vocals
            log(f"lead track nearly silent ({ratio:.2f}); using all vocals")
    wav, sr = sf.read(src, dtype="float32", always_2d=True)
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
    midi[~voiced] = np.nan  # smoothing happens per voiced stretch in to_notes
    return midi


# ---------- 4. notes ----------
def to_notes(midi, smooth_s=0.15, hyst=0.8, min_note_s=0.12):
    """Base notes only: vibrato, scoops and slides are smoothed away; each note's pitch is the
    median of its steady part, not its first frame."""
    from scipy.ndimage import median_filter

    v = ~np.isnan(midi)
    # global tuning offset (recordings are rarely exactly A440)
    frac = midi[v] - np.round(midi[v])
    ang = np.angle(np.mean(np.exp(2j * np.pi * frac)))
    tune = ang / (2 * np.pi)
    raw = midi - tune

    # heavy median smoothing inside each voiced stretch (kills ~5-6 Hz vibrato wobble)
    m = raw.copy()
    k = max(3, int(smooth_s / HOP_S) | 1)
    edges = np.flatnonzero(np.diff(np.r_[0, v.astype(int), 0]))
    for a, b in zip(edges[::2], edges[1::2]):
        m[a:b] = median_filter(raw[a:b], size=min(k, (b - a) | 1), mode="nearest")

    # hysteresis quantization -> runs
    runs = []  # [start_frame, end_frame_excl, pitch]
    cur = None
    for i, x in enumerate(m):
        if np.isnan(x):
            cur = None
            continue
        if cur is None or abs(x - cur) > hyst:
            cur = int(round(x))
            runs.append([i, i + 1, cur])
        else:
            runs[-1][1] = i + 1

    min_len = int(min_note_s / HOP_S)
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
    # pitch of each note = median of its middle 60% (skips the scoop in and the fall off)
    for r in runs:
        s, e = r[0], r[1]
        cut = int((e - s) * 0.2)
        seg = raw[s + cut:e - cut] if e - s - 2 * cut >= 3 else raw[s:e]
        seg = seg[~np.isnan(seg)]
        if len(seg):
            r[2] = int(round(float(np.median(seg))))
    # merge same-pitch runs that touch or have tiny gaps
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


# ---------- 5b. lyrics (LRCLIB, free; timings kept only for the same recording) ----------
def parse_lrc(s):
    out = []
    for ln in (s or "").splitlines():
        m = re.match(r"^\[(\d+):(\d+(?:\.\d+)?)\](.*)", ln)
        if m and m.group(3).strip():
            out.append({"t": int(m.group(1)) * 60 + float(m.group(2)), "text": m.group(3).strip()})
    return out


# Lyrics are VERIFIED against the actual singing before they ship: Whisper transcribes the
# vocal stem (what is really sung, with timings); published lyrics (LRCLIB) are only used to
# correct Whisper's spelling where a line clearly matches what was heard. A title match alone
# never ships lyrics (2026-11-22: "Jingle Bells" matched a different song's words).
LYRIC_MATCH = 0.6    # a heard line must match a published line this well to take its text
LYRIC_AGREE = 0.5    # share of heard words a published version must match to be used at all
# Ship gate (user, 2026-11-22: "your lyric validation needs >90% certainty before shipping";
# raised 2026-11-23: "lets bump the lyrics accuracy check to >95%"):
# lyrics ship only if a published version matches > 95% of the heard words AND the lyric
# lines cover > 95% of the sung time (strictly greater, as worded). Otherwise the pack ships with no lyrics.
LYRIC_SHIP = 0.95


_NUM = dict(enumerate("zero one two three four five six seven eight nine ten eleven twelve".split()))


def _words(s):
    ws = re.sub(r"[^a-z0-9' ]+", " ", s.lower().replace("-", " ")).replace("'", "").split()
    return [_NUM.get(int(w), w) if w.isdigit() else w for w in ws]


def _segs(r, off=0.0):
    out = []
    for s in r["segments"]:
        if s["compression_ratio"] > 2.4:  # stuck repeating ("this, this, this…"): discard, gap pass re-listens
            continue
        ws = [{"t": round(w["start"] + off, 2), "e": round(w["end"] + off, 2), "w": w["word"].strip()}
              for w in s.get("words", []) if w["word"].strip()]
        if ws:
            out.append({"t": ws[0]["t"], "text": s["text"].strip(), "words": ws,
                        "ok": s["avg_logprob"] > -0.8 and s["no_speech_prob"] < 0.6 and s["compression_ratio"] < 2.4})
    return out


def _uncovered(notes, segs):
    """Sung stretches (>= 2 s) with no heard word near them."""
    heard = sorted(w["t"] for s in segs for w in s["words"])
    gaps = []
    for n in notes:
        if any(abs(n["t"] - t) <= 2.0 for t in heard):
            continue
        end = n["t"] + n["d"]
        if gaps and n["t"] - gaps[-1][1] < 2:
            gaps[-1][1] = end
        else:
            gaps.append([n["t"], end])
    return [g for g in gaps if g[1] - g[0] >= 2]


def transcribe(wav, notes=None):
    """[{t, text, words:[{t, w}], ok}] from Whisper; ok=False marks low-confidence segments.
    Whisper can skip a whole sung stretch (2026-11-22: Jingle Bells' first verse, 10-28 s,
    behind the intro). Sung sections with no heard words are listened to again on their own."""
    import whisper
    m = whisper.load_model("small", device=DEVICE, download_root=str(TOOLS / "models" / "whisper"))
    # Whisper retries unsure parts with randomness: a fixed seed gives the same result every run
    # (2026-11-23: one pack gave 47 words, then 0). Temperature 0 alone got stuck in loops.
    kw = dict(language="en", word_timestamps=True, condition_on_previous_text=False, verbose=None)
    torch.manual_seed(0)
    segs = _segs(m.transcribe(str(wav), **kw))
    if notes:
        audio = whisper.load_audio(str(wav))
        for a, b in _uncovered(notes, segs):
            a, b = max(0.0, a - 1.0), b + 1.0
            while a < b - 1:  # long gaps in pieces of <= 20 s
                e = min(b, a + 20.0)
                torch.manual_seed(0)
                extra = _segs(m.transcribe(audio[int(a * 16000):int(e * 16000)], **kw), a)
                log(f"lyrics: re-listened {a:.0f}-{e:.0f} s, heard {sum(len(s['words']) for s in extra)} words")
                segs += extra
                a = e
        segs.sort(key=lambda s: s["t"])
    del m
    if DEVICE == "cuda":
        torch.cuda.empty_cache()
    return segs


def lrclib_search(title):
    import urllib.parse
    import urllib.request
    # search each part of the title ("Artist - Title | Channel"): the song name can be any part
    # (2026-11-23: "Dpee - All I Want For Christmas Is My Two Front Teeth.wmv" searched only "Dpee")
    t = re.sub(r"\.(wmv|mp4|avi|mov|mkv|flv|webm|mp3|m4a|wav)\b", "", title, flags=re.I)
    t = re.sub(r"\(.*?\)|\[.*?\]", "", t)
    t = re.sub(r"\b(piano|karaoke|instrumental|accompaniment|lyrics?|official|video|audio)\b", "", t, flags=re.I)
    # a dash with a space on at least one side separates parts ("DPEE- All I Want..."); "one-horse" doesn't
    parts = [re.sub(r"\s+", " ", p).strip() for p in re.split(r"\||\s[-–—]|[-–—]\s", t)]
    queries = list(dict.fromkeys(p for p in parts if len(p) > 3))
    plain = lambda x: [s.strip() for s in (x.get("plainLyrics") or re.sub(r"\[[\d:.]+\]", "", x.get("syncedLyrics") or "")).splitlines() if s.strip()]
    out, seen = [], set()
    for q in queries[:4]:
        req = urllib.request.Request("https://lrclib.net/api/search?" + urllib.parse.urlencode({"q": q}),
                                     headers={"User-Agent": "pitch-star-prep"})
        for x in json.load(urllib.request.urlopen(req, timeout=15))[:10]:
            if x["id"] not in seen and plain(x):
                seen.add(x["id"])
                out.append({"name": f"{x['trackName']} – {x['artistName']}", "lines": plain(x)})
    return out


def _split_long(text_words, times, max_words=9):
    """Break a long heard segment into display lines at its biggest pauses."""
    if len(text_words) <= max_words:
        return [(times[0], " ".join(text_words))]
    gaps = [times[i + 1] - times[i] for i in range(len(times) - 1)]
    mid = len(text_words) // 2
    j = max(range(max(1, mid - 3), min(len(text_words) - 1, mid + 4)), key=lambda i: gaps[i - 1]) if len(text_words) > 2 else 1
    return _split_long(text_words[:j], times[:j], max_words) + _split_long(text_words[j:], times[j:], max_words)


def align_lyrics(segs, cand=None):
    """Heard segments -> timed display lines. With a published version, each segment takes the
    1-3 consecutive published lines that best match it (if >= LYRIC_MATCH). Returns
    (lines, share of heard words that matched)."""
    from difflib import SequenceMatcher
    lines, matched, total, dropped, spans = [], 0, 0, [], []
    align_lyrics.dropped = dropped
    align_lyrics.spans = spans  # heard time of the confirmed lines (for the coverage check)
    pub = [(l, _words(l)) for l in (cand or [])]

    def flat_of(s):
        flat, owner = [], []
        for k, w in enumerate(s["words"]):
            ws = _words(w["w"]); flat += ws; owner += [k] * len(ws)
        return flat, owner

    def best_win(flat):
        best = (0.0, None)
        for i in range(len(pub)):
            for n in range(1, 9):  # a re-listened stretch can hold a whole verse
                win = pub[i:i + n]
                if len(win) < n:
                    break
                r = SequenceMatcher(None, flat, [w for _, x in win for w in x], autojunk=False).ratio()
                if r > best[0]:
                    best = (r, win)
        return best

    # Whisper sometimes splits one sung line in two: join neighbours when together they match better
    segs = [dict(s) for s in segs]
    if pub:
        k = 0
        while k + 1 < len(segs):
            a, b = segs[k], segs[k + 1]
            if b["t"] - a["words"][-1]["t"] < 1.5:
                ab = {"t": a["t"], "text": f"{a['text']} {b['text']}", "words": a["words"] + b["words"], "ok": a["ok"] and b["ok"]}
                if best_win(flat_of(ab)[0])[0] > max(best_win(flat_of(a)[0])[0], best_win(flat_of(b)[0])[0]):
                    segs[k:k + 2] = [ab]; continue
            k += 1

    for s in segs:
        flat, owner = flat_of(s)
        if not flat:
            continue
        total += len(flat)
        best = best_win(flat)
        if best[1] and best[0] >= LYRIC_MATCH:
            matched += len(flat)
            spans.append((s["words"][0]["t"], max(w.get("e", w["t"]) for w in s["words"])))
            win = best[1]
            sm = SequenceMatcher(None, flat, [w for _, x in win for w in x], autojunk=False)
            pos = 0
            for text, ws in win:
                # time of this published line = heard word aligned to its first word
                t = None
                for a, b, n in sm.get_matching_blocks():
                    if n and b <= pos < b + n:
                        t = s["words"][owner[a + pos - b]]["t"]; break
                    if n and b > pos and t is None:
                        t = s["words"][owner[a]]["t"]; break
                lines.append({"t": t if t is not None else s["t"], "text": text})
                pos += len(ws)
        elif cand:  # published version in use: a heard line it can't confirm is likely misheard
            dropped.append(f"{s['t']:.1f} {s['text']}")
        elif s["ok"]:
            for t, text in _split_long([w["w"] for w in s["words"]], [w["t"] for w in s["words"]]):
                lines.append({"t": t, "text": text})
    for i in range(1, len(lines)):  # keep times increasing
        lines[i]["t"] = round(max(lines[i]["t"], lines[i - 1]["t"] + 0.05), 2)
    return lines, (matched / total if total else 0.0)


def lyric_coverage(spans, notes):
    """Share of sung time (notes, by length) inside the heard time of confirmed lyric lines
    (first word start - 1 s .. last word end + 1 s, so held notes count)."""
    if not notes:
        return 1.0
    tot = sum(n["d"] for n in notes)
    cov = sum(n["d"] for n in notes if any(a - 1.0 <= n["t"] <= b + 1.0 for a, b in spans))
    return cov / tot if tot else 1.0


def make_lyrics(title, vocals_wav, notes=None):
    """Verified lyrics for a sung recording: (lines, check-info). Never raises.
    Ships only at > LYRIC_SHIP certainty, else no lyrics (see LYRIC_SHIP)."""
    lines, info = _make_lyrics(title, vocals_wav, notes)
    if not lines:
        return lines, info
    cov = lyric_coverage(info.pop("spans", []), notes)
    info["coverage"] = round(cov, 3)  # 3 places so the app's "> 95%" check sees e.g. 0.953, not 0.95
    sure = info["source"] == "heard+published" and info["agree"] > LYRIC_SHIP and cov > LYRIC_SHIP
    if not sure:
        log(f"lyrics: NOT shipped - certainty below {LYRIC_SHIP:.0%} (match {info['agree']:.0%}, coverage {cov:.0%})")
        return [], {**info, "source": "none", "lines": 0,
                    "reason": f"below {LYRIC_SHIP:.0%} certainty (match {info['agree']:.0%}, sung time covered {cov:.0%}); add by hand with 📝"}
    log(f"lyrics: shipped, match {info['agree']:.0%}, sung time covered {cov:.0%}")
    return lines, info


def _make_lyrics(title, vocals_wav, notes=None):
    try:
        segs = transcribe(vocals_wav, notes)
    except Exception as e:
        log(f"lyrics: transcription failed ({e}); no lyrics shipped")
        return [], {"source": "none", "reason": f"transcription failed: {e}"}
    heard = sum(len(_words(s["text"])) for s in segs)  # the 90% ship gate judges quality
    if heard < 15:
        log("lyrics: too few clear words heard; no lyrics shipped")
        return [], {"source": "none", "reason": "too few words heard", "heard": heard}
    try:
        cands = lrclib_search(title)
    except Exception as e:
        log(f"lyrics: published-lyrics lookup failed ({e}); using what was heard")
        cands = []
    best = (None, *align_lyrics(segs))  # Whisper only
    for c in cands[:40]:
        lines, agree = align_lyrics(segs, c["lines"])
        if agree > best[2]:
            best = (c, lines, agree)
    c, lines, agree = best
    if c and agree >= LYRIC_AGREE:
        lines, agree = align_lyrics(segs, c["lines"])  # re-run to keep its dropped list
        info = {"source": "heard+published", "published": c["name"], "agree": round(agree, 2),
                "unconfirmed": align_lyrics.dropped, "spans": align_lyrics.spans}
        log(f"lyrics: verified, {agree:.0%} of heard words match '{c['name']}'")
    else:
        lines, _ = align_lyrics(segs)
        info = {"source": "heard", "agree": round(agree, 2)}
        log(f"lyrics: no published version matches the singing (best {agree:.0%}); using what was heard")
    info["lines"], info["heard"] = len(lines), heard
    return lines, info


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
    if kind == "vocal":
        meta["lyrics"], meta["lyricsCheck"] = make_lyrics(title, out / "vocals.wav", notes)
    else:  # no singing to check against -> no lyrics (add them by hand in the app's 📝 dialog)
        meta["lyrics"], meta["lyricsCheck"] = [], {"source": "none", "reason": "instrumental: nothing sung to verify against"}
    meta["lyricsTried"] = True
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
        log("isolating lead singer (removing backup vocals)...")
        isolate_lead(out)
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
