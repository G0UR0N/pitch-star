import { readZip } from './zip.js';
import * as db from './db.js';
import { detectPitch } from './pitch.js';

const $ = s => document.querySelector(s);
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = m => { const r = Math.round(m); return NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1); };
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const TOL = { easy: 100, normal: 60, hard: 40 };
const params = new URLSearchParams(location.search);
const SIM = params.has('sim'); // dev: fake singer that follows the melody

// ---------- settings ----------
const settings = (() => {
  const d = { latency: 100, difficulty: 'normal', passTarget: 70, guide: 0.3 };
  try { return { ...d, ...JSON.parse(localStorage.getItem('psg-settings') || '{}') }; } catch { return d; }
})();
const saveSettings = () => { try { localStorage.setItem('psg-settings', JSON.stringify(settings)); } catch {} };

function toast(msg, ms = 2500) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), ms);
}
function show(id) { for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id; }

// ---------- library ----------
async function renderLibrary() {
  const [songs, scores] = await Promise.all([db.allSongs(), db.allScores()]);
  const best = Object.fromEntries(scores.map(s => [s.id, s.best]));
  const list = $('#songList'); list.innerHTML = '';
  if (!songs.length) list.innerHTML = '<div class="empty">No songs yet. Tap <b>Add songs</b>.</div>';
  songs.sort((a, b) => a.title.localeCompare(b.title));
  for (const s of songs) {
    const el = document.createElement('div'); el.className = 'card';
    el.innerHTML = `<div class="meta"><b></b><small>${fmtTime(s.meta.duration)} · ${s.meta.phrases.length} sections${best[s.id] != null ? ` · best ${best[s.id]}` : ''}</small></div>
      <button class="btn primary small" data-a="sing">Sing</button><button class="icon" data-a="del" aria-label="Delete">🗑️</button>`;
    el.querySelector('b').textContent = s.title;
    el.querySelector('[data-a=sing]').onclick = () => openSong(s.id);
    el.querySelector('[data-a=del]').onclick = async () => {
      if (confirm(`Remove "${s.title}"?`)) { await db.deleteSong(s.id); renderLibrary(); }
    };
    list.append(el);
  }
}

async function importPack(buf, fname) {
  const z = await readZip(buf);
  const meta = JSON.parse(new TextDecoder().decode(z['song.json']));
  const id = (fname || meta.title).replace(/\.song$/i, '');
  await db.putSong({
    id, title: meta.title, meta,
    backing: new Blob([z['backing.mp3']], { type: 'audio/mpeg' }),
    vocals: new Blob([z['vocals.mp3']], { type: 'audio/mpeg' }),
  });
  return meta.title;
}
$('#importInput').onchange = async e => {
  let ok = 0;
  for (const f of e.target.files) {
    try { await importPack(await f.arrayBuffer(), f.name); ok++; } catch (err) { toast(`Couldn't add ${f.name}: ${err.message}`, 4000); }
  }
  e.target.value = '';
  if (ok) toast(`Added ${ok} song${ok > 1 ? 's' : ''}`);
  renderLibrary();
};

// ---------- audio ----------
let ctx, analyser, micBuf, osc, melGain;
async function ensureAudio() {
  ctx ??= new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  if (ctx.state !== 'running') await ctx.resume();
  if (!osc) {
    osc = ctx.createOscillator(); osc.type = 'triangle';
    melGain = ctx.createGain(); melGain.gain.value = 0;
    osc.connect(melGain).connect(ctx.destination); osc.start();
  }
  if (!analyser && !SIM) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analyser);
    micBuf = new Float32Array(analyser.fftSize);
  }
}
function readMic() {
  if (!analyser) return null;
  analyser.getFloatTimeDomainData(micBuf);
  return detectPitch(micBuf, ctx.sampleRate);
}

// ---------- session ----------
let S = null;
const cv = $('#cv'), g = cv.getContext('2d');

async function openSong(id, opts = {}) {
  const song = await db.getSong(id);
  if (!song) return;
  try { await ensureAudio(); } catch (e) { toast('Microphone is needed to play. Allow mic access and try again.', 5000); return; }
  closeSession();
  const mk = blob => { const a = new Audio(); a.src = URL.createObjectURL(blob); a.preload = 'auto'; a.preservesPitch = true; a.webkitPreservesPitch = true; return a; };
  const backing = mk(song.backing), vocals = mk(song.vocals);
  const gB = ctx.createGain(), gV = ctx.createGain();
  const nB = ctx.createMediaElementSource(backing), nV = ctx.createMediaElementSource(vocals);
  nB.connect(gB).connect(ctx.destination); nV.connect(gV).connect(ctx.destination);
  gV.gain.value = settings.guide;
  const m = song.meta;
  S = {
    song, meta: m, notes: m.notes, phrases: m.phrases, backing, vocals, gB, gV, nodes: [nB, nV, gB, gV],
    lo: m.range[0] - 3, hi: m.range[1] + 3, rate: 1, trail: [], pops: [], running: false,
    mode: 'song', queue: [], qi: 0, attempts: [], passes: 0,
  };
  resetStats();
  backing.onended = () => { if (S && S.mode === 'song') finishSong(); };
  $('#playTitle').textContent = song.title;
  $('#guideVol').value = settings.guide;
  $('#speedSel').value = '1';
  $('#btnPlay').textContent = '▶ Start';
  $('#liveScore').textContent = '0';
  if (opts.practice) startPractice(opts.practice);
  else { S.mode = 'song'; $('#practicePanel').hidden = true; $('#playSub').textContent = 'Full song'; seek(0); }
  show('play'); resize();
  requestAnimationFrame(tick);
}

function closeSession() {
  if (!S) return;
  S.backing.pause(); S.vocals.pause();
  URL.revokeObjectURL(S.backing.src); URL.revokeObjectURL(S.vocals.src);
  S.nodes.forEach(n => n.disconnect());
  melGain?.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
  releaseWake();
  S = null;
}

function resetStats(a = 0, b = S.notes.length) {
  S.stats ??= S.notes.map(() => ({}));
  for (let i = a; i < b; i++) S.stats[i] = { tot: 0, hit: 0, err: 0, v: 0, judged: false };
}
const noteScore = st => (st.tot ? st.hit / st.tot : 0);
function rangeScore(a, b, judgedOnly = false) {
  let sum = 0, dur = 0;
  for (let i = a; i < b; i++) {
    if (judgedOnly && !S.stats[i].judged) continue;
    sum += noteScore(S.stats[i]) * S.notes[i].d; dur += S.notes[i].d;
  }
  return dur ? Math.round((sum / dur) * 100) : 0;
}
const lowerBound = t => { let lo = 0, hi = S.notes.length; while (lo < hi) { const m = (lo + hi) >> 1; if (S.notes[m].t + S.notes[m].d < t) lo = m + 1; else hi = m; } return lo; };

function seek(t) {
  t = Math.max(0, t);
  S.backing.currentTime = t; S.vocals.currentTime = t;
  S.lastCT = t; S.lastPerf = performance.now(); S.lastT = t;
  S.ni = S.ji = lowerBound(t); S.trail = []; S.pops = [];
}
function songTime() {
  const a = S.backing, ct = a.currentTime, now = performance.now();
  if (a.paused) return ct;
  if (ct !== S.lastCT) { S.lastCT = ct; S.lastPerf = now; }
  const t = Math.max(S.lastT, S.lastCT + ((now - S.lastPerf) / 1000) * a.playbackRate);
  S.lastT = t; return t;
}

async function play() {
  await ensureAudio();
  await Promise.all([S.backing.play(), S.vocals.play()]).catch(() => {});
  S.running = true; $('#btnPlay').textContent = '❚❚ Pause';
  grabWake();
}
function pause() {
  S.backing.pause(); S.vocals.pause(); S.running = false;
  $('#btnPlay').textContent = '▶ Resume';
  melGain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
}
$('#btnPlay').onclick = () => (S.running ? pause() : play());
$('#btnQuit').onclick = () => {
  if (S?.mode === 'practice' && S.fromResults) { const id = S.song.id; closeSession(); showResults(id, lastResult); }
  else { closeSession(); show('library'); renderLibrary(); }
};
$('#guideVol').oninput = e => { settings.guide = +e.target.value; saveSettings(); if (S) S.gV.gain.value = settings.guide; };
$('#speedSel').onchange = e => { if (!S) return; S.rate = +e.target.value; S.backing.playbackRate = S.vocals.playbackRate = S.rate; };

// ---------- main loop ----------
function tick() {
  if (!S) return;
  const t = songTime();
  const L = (settings.latency / 1000) * S.rate;
  const ts = t - L; // song time of the voice we're hearing now
  let r = null;
  if (S.running) {
    r = SIM ? simVoice(ts) : readMic();
    scoreFrame(ts, r?.midi ?? null);
    S.trail.push({ t: ts, m: r?.midi ?? null });
    while (S.trail.length && S.trail[0].t < ts - 4) S.trail.shift();
  }
  judge(ts);
  melody(t);
  if (S.running && Math.abs(S.vocals.currentTime - S.backing.currentTime) > 0.06) S.vocals.currentTime = S.backing.currentTime;
  if (S.mode === 'practice') practiceTick(t, ts);
  draw(t, ts, r);
  requestAnimationFrame(tick);
}

function simVoice(ts) {
  const i = noteIndexAt(ts, false);
  if (i < 0) return null;
  const wobble = Math.sin(ts * 9) * 0.3 + (Math.random() - 0.5) * 0.4 + (i % 7 === 3 ? 1.2 : 0);
  return { midi: S.notes[i].p + wobble - 12, rms: 0.1 };
}

function noteIndexAt(ts, advance = true) {
  let i = S.ni;
  while (i < S.notes.length && S.notes[i].t + S.notes[i].d < ts) i++;
  if (advance) S.ni = i;
  return i < S.notes.length && S.notes[i].t <= ts ? i : -1;
}
const foldCents = (m, p) => ((((m - p) % 12) + 18) % 12 - 6) * 100;

function inLoop(i) { return S.mode !== 'practice' || (i >= S.loop.a && i < S.loop.b); }

function scoreFrame(ts, midi) {
  const i = noteIndexAt(ts);
  if (i < 0 || !inLoop(i)) return;
  const n = S.notes[i];
  if (ts - n.t < Math.min(0.06, n.d * 0.3)) return; // onset grace
  const st = S.stats[i], tol = TOL[settings.difficulty];
  st.tot++;
  if (midi != null) {
    const e = foldCents(midi, n.p);
    st.v++; st.err += e;
    const a = Math.abs(e);
    if (a <= tol) st.hit += 1; else if (a <= tol * 2) st.hit += 0.5;
  }
}

function judge(ts) {
  while (S.ji < S.notes.length && S.notes[S.ji].t + S.notes[S.ji].d < ts) {
    const i = S.ji++, st = S.stats[i];
    if (!inLoop(i) || st.judged) continue;
    st.judged = true;
    const sc = noteScore(st), n = S.notes[i];
    const [text, color] = sc >= 0.8 ? ['Perfect!', '--gold'] : sc >= 0.5 ? ['Good', '--good'] : ['Miss', '--miss'];
    S.pops.push({ t: n.t + n.d, p: n.p, text, color: css(color), born: performance.now() });
    if (S.mode === 'song') $('#liveScore').textContent = rangeScore(0, S.notes.length, true);
  }
}

function melody(t) {
  if (!melGain) return;
  const on = $('#melodyTog').checked && S.running;
  let i = S.ni;
  while (i < S.notes.length && S.notes[i].t + S.notes[i].d < t) i++;
  const n = S.notes[i];
  const active = on && n && n.t <= t;
  if (active) osc.frequency.setTargetAtTime(440 * 2 ** ((n.p - 69) / 12), ctx.currentTime, 0.005);
  melGain.gain.setTargetAtTime(active ? 0.18 : 0, ctx.currentTime, 0.015);
}

// ---------- drawing ----------
const cssCache = {};
const css = v => (cssCache[v] ??= getComputedStyle(document.documentElement).getPropertyValue(v).trim());
function resize() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr;
}
addEventListener('resize', () => S && resize());

function draw(t, ts) {
  const W = cv.width, H = cv.height, dpr = W / cv.clientWidth;
  const pps = W / 7, nowX = W * 0.28;
  const span = S.hi - S.lo, top = H * 0.06, h = H * 0.88;
  const y = m => top + h - ((m - S.lo) / span) * h;
  const x = tt => nowX + (tt - t) * pps;
  const rowH = h / span;
  g.clearRect(0, 0, W, H);

  // grid
  g.font = `${11 * dpr}px system-ui`; g.textBaseline = 'middle';
  for (let m = Math.ceil(S.lo); m <= S.hi; m++) {
    const isC = ((m % 12) + 12) % 12 === 0;
    g.fillStyle = isC ? '#ffffff22' : '#ffffff0b';
    g.fillRect(0, y(m), W, Math.max(1, dpr));
    if (isC) { g.fillStyle = '#ffffff55'; g.fillText(noteName(m), 4 * dpr, y(m) - 7 * dpr); }
  }
  // practice loop shading
  if (S.mode === 'practice') {
    g.fillStyle = '#00000066';
    g.fillRect(0, 0, Math.max(0, x(S.loop.t0)), H);
    g.fillRect(x(S.loop.t1), 0, W, H);
  }
  // notes
  const t0 = t - nowX / pps, t1 = t + (W - nowX) / pps;
  for (let i = Math.max(0, S.ni - 40); i < S.notes.length; i++) {
    const n = S.notes[i];
    if (n.t > t1) break;
    if (n.t + n.d < t0) continue;
    const st = S.stats[i];
    let col = css('--bar');
    if (!inLoop(i)) col = '#5a4f8a';
    else if (st.judged) { const sc = noteScore(st); col = sc >= 0.8 ? css('--gold') : sc >= 0.5 ? css('--good') : css('--miss'); }
    else if (n.t <= ts && st.tot) {
      const sc = noteScore(st); col = sc >= 0.8 ? css('--gold') : sc >= 0.5 ? css('--good') : css('--bar');
    }
    const bh = Math.max(6 * dpr, rowH * 0.75);
    roundRect(x(n.t), y(n.p) - bh / 2, Math.max(2, n.d * pps - 2 * dpr), bh, bh / 2, col);
  }
  // now line
  g.fillStyle = '#ffffff88'; g.fillRect(nowX - dpr, 0, 2 * dpr, H);

  // voice trail (folded to the nearest octave of the target)
  const ref = tt => { const i = S.notes.findIndex((n, k) => k >= S.ni - 2 && n.t + n.d >= tt); const n = S.notes[i >= 0 ? i : S.notes.length - 1]; return n ? n.p : (S.lo + S.hi) / 2; };
  const fold = (m, r) => m - 12 * Math.round((m - r) / 12);
  g.lineWidth = 3 * dpr; g.strokeStyle = css('--accent'); g.lineCap = 'round';
  g.beginPath(); let pen = false, last = null;
  for (const p of S.trail) {
    if (p.m == null) { pen = false; continue; }
    const fm = fold(p.m, ref(p.t));
    const px = x(p.t), py = y(fm);
    if (pen && Math.abs(fm - last) < 3) g.lineTo(px, py); else g.moveTo(px, py);
    pen = true; last = fm;
  }
  g.stroke();
  const cur = S.trail[S.trail.length - 1];
  if (S.running && cur?.m != null) {
    const r = ref(cur.t), fm = fold(cur.m, r), px = x(cur.t), py = y(fm);
    g.fillStyle = css('--accent'); g.beginPath(); g.arc(px, py, 7 * dpr, 0, 7); g.fill();
    const i = noteIndexAt(ts, false);
    if (i >= 0 && inLoop(i)) {
      const e = foldCents(cur.m, S.notes[i].p);
      if (Math.abs(e) > TOL[settings.difficulty]) {
        g.fillStyle = '#fff'; g.font = `bold ${18 * dpr}px system-ui`; g.textAlign = 'center';
        g.fillText(e < 0 ? '▲' : '▼', px, py + (e < 0 ? -20 : 20) * dpr);
        g.textAlign = 'start';
      }
    }
  }
  // judgement pops
  const now = performance.now();
  S.pops = S.pops.filter(p => now - p.born < 900);
  g.textAlign = 'center';
  for (const p of S.pops) {
    const k = (now - p.born) / 900;
    g.globalAlpha = 1 - k; g.fillStyle = p.color; g.font = `bold ${16 * dpr}px system-ui`;
    g.fillText(p.text, Math.min(W - 40 * dpr, Math.max(40 * dpr, x(p.t))), y(p.p) - (18 + 30 * k) * dpr);
  }
  g.globalAlpha = 1; g.textAlign = 'start';

  // next note label + time
  const nxt = S.notes[S.ni];
  g.fillStyle = '#ffffff99'; g.font = `${12 * dpr}px system-ui`;
  g.fillText(`${fmtTime(t)} / ${fmtTime(S.meta.duration)}${nxt ? '   next: ' + noteName(nxt.p) : ''}`, 8 * dpr, H - 10 * dpr);
}
function roundRect(x0, y0, w, h, r, col) {
  r = Math.min(r, w / 2, h / 2);
  g.fillStyle = col; g.beginPath();
  g.moveTo(x0 + r, y0); g.arcTo(x0 + w, y0, x0 + w, y0 + h, r); g.arcTo(x0 + w, y0 + h, x0, y0 + h, r);
  g.arcTo(x0, y0 + h, x0, y0, r); g.arcTo(x0, y0, x0 + w, y0, r); g.fill();
}

// ---------- results ----------
let lastResult = null;
function sectionTip(a, b) {
  let tot = 0, v = 0, err = 0;
  for (let i = a; i < b; i++) { const s = S.stats[i]; tot += s.tot; v += s.v; err += s.err; }
  if (!tot) return '';
  if (v / tot < 0.5) return 'Sing out and hold the notes longer';
  const e = err / v;
  if (e > 30) return 'A little sharp (too high)';
  if (e < -30) return 'A little flat (too low)';
  return 'Close! Watch the note changes';
}
async function finishSong() {
  pause();
  const total = rangeScore(0, S.notes.length);
  const secs = S.phrases.map((p, k) => ({ k, t0: p.t0, score: rangeScore(p.a, p.b), tip: sectionTip(p.a, p.b) }));
  const id = S.song.id;
  const prev = (await db.getScore(id)) || { id, best: 0, phrases: {} };
  const isBest = total > prev.best;
  prev.best = Math.max(prev.best, total);
  secs.forEach(s => (prev.phrases[s.k] = Math.max(prev.phrases[s.k] || 0, s.score)));
  await db.putScore(prev);
  lastResult = { total, secs, isBest, best: prev.best };
  closeSession();
  showResults(id, lastResult);
}
async function showResults(id, res) {
  const song = await db.getSong(id);
  $('#resTitle').textContent = song.title;
  const stars = res.total >= 90 ? 5 : res.total >= 80 ? 4 : res.total >= 65 ? 3 : res.total >= 50 ? 2 : 1;
  $('#resStars').textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars);
  $('#resScore').textContent = res.total;
  $('#resBest').textContent = res.isBest ? '🎉 New personal best!' : `Best: ${res.best}`;
  const target = settings.passTarget;
  const weak = res.secs.filter(s => s.score < target).sort((a, b) => a.score - b.score).map(s => s.k);
  $('#btnPracticeWeak').hidden = !weak.length;
  $('#btnPracticeWeak').onclick = () => openSong(id, { practice: { queue: weak, fromResults: true } });
  $('#btnAgain').onclick = () => openSong(id);
  $('#btnLib').onclick = () => { show('library'); renderLibrary(); };
  const list = $('#secList'); list.innerHTML = '';
  for (const s of res.secs) {
    const el = document.createElement('div');
    el.className = 'card sec' + (s.score < target ? ' weak' : '');
    const col = s.score >= 80 ? css('--gold') : s.score >= target ? css('--good') : css('--miss');
    el.innerHTML = `<div class="meta"><b>Section ${s.k + 1} <small>${fmtTime(s.t0)}</small> · ${s.score}%</b><small>${s.tip}</small>
      <div class="barwrap"><div class="barfill" style="width:${s.score}%;background:${col}"></div></div></div>
      <button class="btn small">Practice</button>`;
    el.querySelector('button').onclick = () => openSong(id, { practice: { queue: [s.k], fromResults: true } });
    list.append(el);
  }
  show('results');
}

// ---------- practice ----------
function startPractice({ queue, fromResults }) {
  S.mode = 'practice'; S.queue = queue.length ? queue : [0]; S.qi = 0; S.fromResults = fromResults;
  $('#practicePanel').hidden = false;
  loadLoop();
}
function loadLoop() {
  const k = S.queue[S.qi], p = S.phrases[k];
  S.loop = { k, a: p.a, b: p.b, t0: p.t0, t1: p.t1, start: Math.max(0, p.t0 - 2.5), end: Math.min(S.meta.duration, p.t1 + 0.7) };
  S.attempts = []; S.passes = 0; S.advancing = false;
  resetStats(p.a, p.b);
  $('#playSub').textContent = `Practice · section ${k + 1} of ${S.phrases.length}`;
  updatePracticeUI();
  seek(S.loop.start);
}
function updatePracticeUI() {
  const L = S.loop, need = 2;
  $('#pSec').textContent = `Section ${L.k + 1}${S.queue.length > 1 ? `  (${S.qi + 1}/${S.queue.length})` : ''}`;
  $('#pAttempts').textContent = S.attempts.length
    ? `Tries: ${S.attempts.slice(-5).join(' · ')}   ${'✅'.repeat(Math.min(S.passes, need))}${'⬜'.repeat(Math.max(0, need - S.passes))}`
    : `Score ${settings.passTarget}%+ twice to pass`;
  $('#liveScore').textContent = S.attempts.length ? S.attempts[S.attempts.length - 1] : '–';
}
function practiceTick(t) {
  const L = S.loop, ov = $('#overlay');
  if (S.running && t < L.t0 && t >= L.start) { ov.hidden = false; ov.textContent = Math.ceil(L.t0 - t); }
  else if (!S.advancing) ov.hidden = true;
  if (!S.running || t < L.end) return;
  const score = rangeScore(L.a, L.b);
  S.attempts.push(score);
  if (score >= settings.passTarget) S.passes++;
  updatePracticeUI();
  resetStats(L.a, L.b);
  if (S.passes >= 2 && !S.advancing) {
    S.advancing = true; pause();
    ov.hidden = false;
    const done = S.qi >= S.queue.length - 1;
    ov.innerHTML = done ? '🌟 All sections passed! 🌟' : '✅ Passed! Next section…';
    setTimeout(() => {
      if (!S) return;
      ov.hidden = true;
      if (done) { $('#btnQuit').click(); return; }
      S.qi++; loadLoop(); play();
    }, 1800);
    return;
  }
  ov.hidden = false; ov.textContent = score >= settings.passTarget ? `${score}! 👍` : `${score} – again!`;
  seek(L.start);
}
$('#btnPrevSec').onclick = () => S && shiftSection(-1);
$('#btnNextSec').onclick = () => S && shiftSection(1);
function shiftSection(dir) {
  if (S.queue.length > 1) S.qi = (S.qi + dir + S.queue.length) % S.queue.length;
  else S.queue = [Math.min(S.phrases.length - 1, Math.max(0, S.queue[0] + dir))];
  loadLoop();
}

// ---------- settings ----------
const dlg = $('#settingsDlg');
let micTestOn = false;
$('#btnSettings').onclick = () => {
  $('#setDifficulty').value = settings.difficulty;
  $('#setPass').value = settings.passTarget; $('#passOut').textContent = settings.passTarget;
  $('#setLatency').value = settings.latency; $('#latOut').textContent = settings.latency;
  dlg.showModal();
};
$('#setDifficulty').onchange = e => { settings.difficulty = e.target.value; saveSettings(); };
$('#setPass').oninput = e => { settings.passTarget = +e.target.value; $('#passOut').textContent = e.target.value; saveSettings(); };
$('#setLatency').oninput = e => { settings.latency = +e.target.value; $('#latOut').textContent = e.target.value; saveSettings(); };
$('#btnMicTest').onclick = async () => {
  try { await ensureAudio(); } catch { $('#micNote').textContent = 'mic blocked'; return; }
  micTestOn = true;
  const loop = () => {
    if (!micTestOn || !dlg.open) { micTestOn = false; return; }
    const r = readMic(); $('#micNote').textContent = r ? noteName(r.midi) : '—';
    requestAnimationFrame(loop);
  };
  loop();
};

// ---------- wake lock ----------
let wake = null;
async function grabWake() { try { wake ??= await navigator.wakeLock?.request('screen'); } catch {} }
function releaseWake() { wake?.release().catch(() => {}); wake = null; }

// ---------- boot ----------
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
(async () => {
  const load = params.get('load'); // dev: ?load=../songs/x.song
  if (load) {
    try { const r = await fetch(load); await importPack(await r.arrayBuffer(), load.split('/').pop()); } catch (e) { toast('load failed: ' + e.message); }
  }
  renderLibrary();
})();
