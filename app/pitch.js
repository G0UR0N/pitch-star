// YIN pitch detection. Returns {midi, rms} or null when no clear pitch.
let d = null;
export function detectPitch(buf, sr, { fmin = 70, fmax = 1200, thresh = 0.15, minRms = 0.006 } = {}) {
  const N = buf.length;
  let rms = 0;
  for (let i = 0; i < N; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / N);
  if (rms < minRms) return null;
  const W = N >> 1;
  const tMin = Math.max(2, Math.floor(sr / fmax));
  const tMax = Math.min(W - 1, Math.ceil(sr / fmin));
  if (!d || d.length < tMax + 2) d = new Float32Array(tMax + 2);
  d[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= tMax + 1; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const x = buf[i] - buf[i + tau]; s += x * x; }
    run += s;
    d[tau] = run > 0 ? (s * tau) / run : 1;
  }
  let tau = -1;
  for (let t = tMin; t <= tMax; t++) {
    if (d[t] < thresh) {
      while (t + 1 <= tMax && d[t + 1] < d[t]) t++;
      tau = t; break;
    }
  }
  if (tau < 0) return null;
  const a = d[tau - 1], b = d[tau], c = d[tau + 1];
  const den = a - 2 * b + c;
  const t = den !== 0 ? tau + (a - c) / (2 * den) : tau;
  const f = sr / t;
  return { midi: 69 + 12 * Math.log2(f / 440), rms };
}
