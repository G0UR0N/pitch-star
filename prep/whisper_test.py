import sys, whisper, time
t = time.time()
m = whisper.load_model(sys.argv[2] if len(sys.argv) > 2 else "small", device="cuda", download_root=r"C:\Users\mrcha\PitchScoreGameTools\models\whisper")
r = m.transcribe(sys.argv[1], language="en", word_timestamps=True, condition_on_previous_text=False)
for s in r["segments"]:
    print(f"{s['start']:6.1f} lp{s['avg_logprob']:+.2f} ns{s['no_speech_prob']:.2f} cr{s['compression_ratio']:.1f} {s['text']}")
print(f"{time.time()-t:.0f}s")
