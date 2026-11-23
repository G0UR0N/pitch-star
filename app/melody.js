// Turn a sung pitch recording into clean target notes, and group notes into sections.
// frames: [{t: seconds, m: midi float | null}] sorted by t.

export function framesToNotes(frames, { minNote = 0.12, hyst = 0.8, gapBreak = 0.08 } = {}) {
  const v = frames.map(f => f.m);
  // median filter (~150-200 ms at 60 fps) removes vibrato wobble and pitch-tracker spikes
  const sm = v.map((m, i) => {
    if (m == null) return null;
    const w = [];
    for (let j = i - 5; j <= i + 5; j++) if (j >= 0 && j < v.length && v[j] != null) w.push(v[j]);
    w.sort((a, b) => a - b);
    return w[w.length >> 1];
  });
  // singer's overall tuning offset (being a bit flat/sharp everywhere is not a melody change)
  let cx = 0, cy = 0;
  for (const m of sm) if (m != null) { const a = 2 * Math.PI * (m - Math.round(m)); cx += Math.cos(a); cy += Math.sin(a); }
  const tune = Math.atan2(cy, cx) / (2 * Math.PI);
  const dt = frames.length > 1 ? (frames[frames.length - 1].t - frames[0].t) / (frames.length - 1) : 1 / 60;

  // hysteresis quantization -> runs
  let runs = [], cur = null;
  for (let i = 0; i < frames.length; i++) {
    const m = sm[i], t = frames[i].t;
    if (m == null) { cur = null; continue; }
    const x = m - tune, last = runs[runs.length - 1];
    if (cur == null || Math.abs(x - cur) > hyst || (last && t - last.e > gapBreak)) {
      cur = Math.round(x); runs.push({ s: t, e: t + dt, p: cur, i0: i, i1: i + 1 });
    } else { last.e = t + dt; last.i1 = i + 1; }
  }
  // each note's pitch = median of its middle 60% (ignores the scoop in / fall off)
  for (const r of runs) {
    const n = r.i1 - r.i0, cut = Math.floor(n * 0.2);
    const seg = v.slice(n - 2 * cut >= 3 ? r.i0 + cut : r.i0, n - 2 * cut >= 3 ? r.i1 - cut : r.i1).filter(m => m != null).map(m => m - tune).sort((a, b) => a - b);
    if (seg.length) r.p = Math.round(seg[seg.length >> 1]);
  }
  // short runs (scoops, slides, consonants) join a touching neighbour, else drop
  for (let changed = true; changed;) {
    changed = false;
    for (let k = 0; k < runs.length; k++) {
      const r = runs[k];
      if (r.e - r.s >= minNote) continue;
      const prev = k > 0 && r.s - runs[k - 1].e < 0.05 ? runs[k - 1] : null;
      const next = k + 1 < runs.length && runs[k + 1].s - r.e < 0.05 ? runs[k + 1] : null;
      if (prev && (!next || prev.e - prev.s >= next.e - next.s)) prev.e = r.e;
      else if (next) next.s = r.s;
      runs.splice(k, 1); changed = true; break;
    }
  }
  // merge repeated same-pitch runs split by a tiny gap
  const out = [];
  for (const r of runs) {
    const l = out[out.length - 1];
    if (l && l.p === r.p && r.s - l.e < 0.03) l.e = r.e; else out.push({ ...r });
  }
  return out.filter(r => r.e - r.s >= minNote).map(r => ({ t: +r.s.toFixed(3), d: +(r.e - r.s).toFixed(3), p: r.p }));
}

// shift whole octaves so the median sits near `target`
export function placeOctave(notes, target) {
  if (!notes.length) return notes;
  const ps = notes.map(n => n.p).sort((a, b) => a - b);
  const shift = 12 * Math.round((ps[ps.length >> 1] - target) / 12);
  return notes.map(n => ({ ...n, p: n.p - shift }));
}

export function toPhrases(notes, gap = 0.6, maxLen = 12, minLen = 2.5) {
  if (!notes.length) return [];
  const end = i => notes[i].t + notes[i].d;
  const span = g => end(g[g.length - 1]) - notes[g[0]].t;
  let groups = [[0]];
  for (let i = 1; i < notes.length; i++) {
    if (notes[i].t - end(i - 1) > gap) groups.push([i]); else groups[groups.length - 1].push(i);
  }
  const out = [], stack = groups.reverse();
  while (stack.length) {
    const g = stack.pop();
    if (span(g) > maxLen && g.length > 1) {
      let best = 0, j = 1;
      for (let q = 0; q < g.length - 1; q++) { const gp = notes[g[q + 1]].t - end(g[q]); if (gp > best) { best = gp; j = q + 1; } }
      stack.push(g.slice(j), g.slice(0, j));
    } else out.push(g);
  }
  const fin = [];
  for (const g of out) {
    const l = fin[fin.length - 1];
    if (l && span(g) < minLen && span(l.concat(g)) <= maxLen * 1.3) l.push(...g); else fin.push(g);
  }
  return fin.map(g => ({ a: g[0], b: g[g.length - 1] + 1, t0: notes[g[0]].t, t1: +end(g[g.length - 1]).toFixed(3) }));
}

export function noteRange(notes) {
  if (!notes.length) return [60, 72];
  const ps = notes.map(n => n.p).sort((a, b) => a - b);
  const q = f => ps[Math.min(ps.length - 1, Math.floor(f * ps.length))];
  return [q(0.03), q(0.97)];
}
