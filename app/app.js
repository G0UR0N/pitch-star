// ?v= stamps are rewritten by publish.ps1 so every publish loads fresh files past GitHub's CDN cache
import { readZip, writeZip } from './zip.js?v=202611222342';
import * as db from './db.js?v=202611222342';
import { detectPitch } from './pitch.js?v=202611222342';
import { framesToNotes, placeOctave, toPhrases, noteRange } from './melody.js?v=202611222342';

const $ = s => document.querySelector(s);
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = m => { const r = Math.round(m); return NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1); };
const fmtTime = s => (s = Math.max(0, s), `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
const TOL = { easy: 100, normal: 60, hard: 40 };
const params = new URLSearchParams(location.search);
const SIM = params.has('sim'); // dev: fake singer that follows the melody
if (SIM) window.__S = () => S; // dev inspection

// ---------- settings ----------
const settings = (() => {
  const d = { latency: 100, difficulty: 'normal', passTarget: 70, guide: 0.3, lyrics: true };
  try { return { ...d, ...JSON.parse(localStorage.getItem('psg-settings') || '{}') }; } catch { return d; }
})();
const saveSettings = () => { try { localStorage.setItem('psg-settings', JSON.stringify(settings)); } catch {} };

function toast(msg, ms = 2500) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), ms);
}
function show(id) { for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id; }

// ---------- library ----------
// Short song name ("Jingle Bells"): the user's own name, else the published title the lyrics were
// verified against, else the first part of the video title. The rest of the title becomes subtext.
const normW = s => s.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
const JUNK = /^(official( music| lyric)? video|lyrics?( video)?|official audio|audio|hd|4k|remastered)$/i;
const splitTitle = t => t.replace(/\(.*?\)|\[.*?\]/g, '').split(/\s*\|\s*|\s+[-–—]\s+/).map(x => x.trim()).filter(Boolean);
// words that mark a title part as a description ("Piano accompaniment"), never the song name
const DESCR = /\b(piano|accompaniment|karaoke|instrumental|cover|lyrics?|version|tutorial|backing track|official|video|audio|remaster(ed)?|live)\b/i;
function autoName(s) {
  const pub = s.meta.lyricsCheck?.published?.split(' – ')[0]?.trim();
  if (pub) return pub;
  // "Title | Channel": the song is before the first "|". Within it, YouTube's usual
  // "Artist - Title" puts the song second, unless that part is only a description.
  const first = s.title.replace(/\(.*?\)|\[.*?\]/g, '').split('|')[0];
  const parts = first.split(/\s+[-–—]\s+/).map(x => x.trim()).filter(Boolean);
  return (parts.length > 1 && !DESCR.test(parts[1]) ? parts[1] : parts[0]) || s.title;
}
const songName = s => s.meta.name || autoName(s);
function songDesc(s) {
  const t = s.title, n = normW(songName(s)), parts = [];
  for (const m of t.matchAll(/\((.*?)\)|\[(.*?)\]/g)) parts.push(m[1] ?? m[2]);
  parts.push(...splitTitle(t));
  return [...new Set(parts.map(x => x.trim()).filter(x => x && !JUNK.test(x) && normW(x) !== n))].join(' · ');
}

async function renderLibrary() {
  const [songs, scores] = await Promise.all([db.allSongs(), db.allScores()]);
  const best = Object.fromEntries(scores.map(s => [s.id, s.best]));
  const list = $('#songList'); list.innerHTML = '';
  if (!songs.length) list.innerHTML = '<div class="empty">No songs yet. Tap <b>Add songs</b>.</div>';
  songs.sort((a, b) => songName(a).localeCompare(songName(b)));
  const stale = songs.filter(s => s.meta.lyricsCheck?.stale);
  if (stale.length) {
    const b = document.createElement('button'); b.className = 'btn warn wide';
    b.textContent = `⚠ Lyrics need an update for: ${stale.map(songName).join(', ')}. Tap here and pick ${stale.length > 1 ? 'them' : 'it'} from Drive → PitchStar.`;
    b.onclick = () => $('#importInput').click();
    list.append(b);
  }
  // folders: songs without one sit on top, then one collapsible group per folder
  const folders = [...new Set(songs.map(s => s.meta.group).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const boxes = { '': list };
  settings.folderOpen ||= {};
  for (const f of folders) {
    const d = document.createElement('details'); d.className = 'folder';
    d.open = settings.folderOpen[f] !== false;
    d.innerHTML = '<summary><span></span><small></small></summary><div class="list"></div>';
    d.querySelector('span').textContent = '📁 ' + f;
    d.querySelector('small').textContent = songs.filter(s => s.meta.group === f).length;
    d.ontoggle = () => { settings.folderOpen[f] = d.open; saveSettings(); };
    list.append(d); boxes[f] = d.querySelector('.list');
  }
  for (const s of songs) {
    const el = document.createElement('div'); el.className = 'card song';
    el.innerHTML = `<div class="meta"><b></b><small class="desc"></small><small>${fmtTime(s.meta.duration)} · ${s.meta.phrases.length} sections${best[s.id] != null ? ` · best ${best[s.id]}` : ''}${s.meta.edited ? ' · ✎ own melody' : ''}</small>${s.meta.lyricsCheck?.stale ? '<button class="btn small warn" data-a="readd">⚠ Lyrics need an update: tap, then pick this song from Drive</button>' : ''}</div>
      <div class="actions">
        <button class="btn primary small" data-a="sing">▶ Sing</button>
        <button class="icon" data-a="edit" title="Name & folder" aria-label="Name and folder">✏️</button>
        <button class="icon" data-a="ly" title="Lyrics" aria-label="Lyrics">📝</button>
        <button class="icon" data-a="rec" title="Record melody" aria-label="Record melody">🎙️</button>
        <button class="icon" data-a="trim" title="Trim song end" aria-label="Trim">✂️</button>
        <button class="icon" data-a="exp" title="Export song file" aria-label="Export">⤓</button>
        <button class="icon" data-a="del" title="Remove" aria-label="Delete">🗑️</button>
      </div>`;
    el.querySelector('b').textContent = songName(s);
    const desc = songDesc(s), dEl = el.querySelector('.desc');
    if (desc) dEl.textContent = desc; else dEl.remove();
    el.querySelector('[data-a=readd]')?.addEventListener('click', () => $('#importInput').click());
    el.querySelector('[data-a=sing]').onclick = () => openSong(s.id);
    el.querySelector('[data-a=edit]').onclick = () => editSong(s);
    el.querySelector('[data-a=rec]').onclick = () => openSong(s.id, { record: true });
    el.querySelector('[data-a=ly]').onclick = () => openLyrics(s.id);
    el.querySelector('[data-a=exp]').onclick = () => exportSong(s.id);
    el.querySelector('[data-a=trim]').onclick = () => trimSong(s.id);
    el.querySelector('[data-a=del]').onclick = async () => {
      if (confirm(`Remove "${songName(s)}"?`)) { await db.deleteSong(s.id); renderLibrary(); }
    };
    boxes[s.meta.group || ''].append(el);
  }
  // keep folders after the loose songs
  for (const f of folders) list.append(boxes[f].parentElement);
}

// name & folder dialog
let editId = null;
function editSong(s) {
  editId = s.id;
  $('#edName').value = s.meta.name || '';
  $('#edName').placeholder = autoName(s);
  $('#edGroup').value = s.meta.group || '';
  $('#edFull').textContent = s.title;
  db.allSongs().then(all => {
    $('#folderList').innerHTML = '';
    for (const f of [...new Set(all.map(x => x.meta.group).filter(Boolean))].sort()) {
      const o = document.createElement('option'); o.value = f; $('#folderList').append(o);
    }
  });
  $('#editDlg').showModal();
}
$('#btnEdSave').onclick = async () => {
  const s = await db.getSong(editId);
  const name = $('#edName').value.trim(), group = $('#edGroup').value.trim();
  if (name) s.meta.name = name; else delete s.meta.name;
  if (group) s.meta.group = group; else delete s.meta.group;
  await db.putSong(s);
  $('#editDlg').close(); renderLibrary();
};

async function importPack(buf, fname) {
  const z = await readZip(buf);
  const meta = JSON.parse(new TextDecoder().decode(z['song.json']));
  const id = (fname || meta.title).replace(/\.song$/i, '');
  // re-adding an updated pack keeps the name and folder chosen on this phone
  const old = await db.getSong(id);
  for (const k of ['name', 'group']) if (old?.meta?.[k] && !meta[k]) meta[k] = old.meta[k];
  dropUnverified(meta); // an old pack file still carries unverified lyrics
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
    try { await importPack(await f.arrayBuffer(), f.name); ok++; autoLyrics(f.name.replace(/\.song$/i, '')); } catch (err) { toast(`Couldn't add ${f.name}: ${err.message}`, 4000); }
  }
  e.target.value = '';
  if (ok) toast(`Added ${ok} song${ok > 1 ? 's' : ''}`);
  renderLibrary();
};

// ---------- audio ----------
let ctx, OUT, analyser, micBuf, osc, melGain;
async function ensureAudio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    OUT = ctx.createGain(); OUT.gain.value = SIM ? 0 : 1; // test mode (?sim) is silent
    OUT.connect(ctx.destination);
  }
  if (ctx.state !== 'running') await ctx.resume();
  if (!osc) {
    osc = ctx.createOscillator(); osc.type = 'triangle';
    melGain = ctx.createGain(); melGain.gain.value = 0;
    osc.connect(melGain).connect(OUT); osc.start();
  }
  if (!micStream && !SIM) await openMic();
}

// ---------- microphone choice (delay is remembered per microphone) ----------
let micStream = null, micSrc = null;
async function openMic() {
  micStream?.getTracks().forEach(t => t.stop());
  micSrc?.disconnect();
  const base = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: settings.micId ? { ...base, deviceId: { exact: settings.micId } } : base });
  } catch (e) {
    if (!settings.micId) throw e;
    toast('Saved microphone not found, using the default one');
    settings.micId = ''; saveSettings();
    stream = await navigator.mediaDevices.getUserMedia({ audio: base });
  }
  micStream = stream;
  if (!analyser) { analyser = ctx.createAnalyser(); analyser.fftSize = 2048; micBuf = new Float32Array(analyser.fftSize); }
  micSrc = ctx.createMediaStreamSource(stream); micSrc.connect(analyser);
  fillMicLists();
}
async function fillMicLists() {
  let devs = [];
  try { devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'); } catch {}
  const named = devs.some(d => d.label);
  for (const sel of document.querySelectorAll('.micSel')) {
    sel.innerHTML = '';
    sel.add(new Option(named ? 'Default microphone' : 'Default (tap Start mic to list all)', ''));
    devs.filter(d => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .forEach((d, i) => sel.add(new Option(d.label || `Microphone ${i + 1}`, d.deviceId)));
    sel.value = settings.micId || '';
    if (sel.value !== (settings.micId || '')) sel.value = '';
  }
  showLatency();
}
function showLatency() {
  $('#playLat').textContent = settings.latency;
  $('#latOut').textContent = settings.latency; $('#setLatency').value = settings.latency;
}
function setLatency(ms) {
  settings.latency = ms;
  (settings.latByMic ??= {})[settings.micId || ''] = ms;
  saveSettings(); showLatency();
}
for (const sel of document.querySelectorAll('.micSel')) {
  sel.onchange = async e => {
    settings.micId = e.target.value;
    const saved = settings.latByMic?.[settings.micId];
    if (saved != null) settings.latency = saved;
    saveSettings(); showLatency();
    if (ctx && !SIM) { try { await openMic(); toast('Microphone changed' + (saved == null ? ' – run Auto-set delay for it' : '')); } catch { toast('Could not open that microphone'); } }
    fillMicLists();
  };
}
navigator.mediaDevices?.addEventListener?.('devicechange', fillMicLists);
fillMicLists();
function readMic() {
  if (!analyser) return null;
  analyser.getFloatTimeDomainData(micBuf);
  return detectPitch(micBuf, ctx.sampleRate);
}

// ---------- session ----------
let S = null;
const cv = $('#cv'), g = cv.getContext('2d');

async function openSong(id, opts = {}) {
  const song = await autoLyrics(id);
  if (!song) return;
  try { await ensureAudio(); } catch (e) { toast('Microphone is needed to play. Allow mic access and try again.', 5000); return; }
  closeSession();
  const mk = blob => { const a = new Audio(); a.src = URL.createObjectURL(blob); a.preload = 'auto'; a.preservesPitch = true; a.webkitPreservesPitch = true; return a; };
  const backing = mk(song.backing), vocals = mk(song.vocals);
  const gB = ctx.createGain(), gV = ctx.createGain();
  const nB = ctx.createMediaElementSource(backing), nV = ctx.createMediaElementSource(vocals);
  nB.connect(gB).connect(OUT); nV.connect(gV).connect(OUT);
  const m = song.meta;
  // an instrumental's guide track is a tone render of the OLD notes; mute it once the melody was re-recorded
  const guideStale = m.edited && m.kind === 'instrumental';
  gV.gain.value = guideStale ? 0 : settings.guide;
  S = {
    song, meta: m, notes: m.notes, phrases: m.phrases, backing, vocals, gB, gV, nodes: [nB, nV, gB, gV],
    lo: m.range[0] - 3, hi: m.range[1] + 3, rate: 1, trail: [], pops: [], running: false,
    mode: 'song', queue: [], qi: 0, attempts: [], passes: 0, guideStale,
  };
  $('#melodyTog').checked = guideStale || !!opts.hearNotes;
  $('#recPanel').hidden = true; $('#syncPanel').hidden = true;
  $('#lyricsTog').checked = settings.lyrics;
  buildLyrics();
  resetStats();
  backing.onended = () => { if (S && S.mode === 'song') finishSong(); };
  $('#playTitle').textContent = songName(song);
  $('#guideVol').value = settings.guide;
  $('#speedSel').value = '1';
  $('#btnPlay').textContent = '▶ Start';
  $('#liveScore').textContent = '0';
  if (opts.sync) startSync();
  else if (opts.record) startRecord();
  else if (opts.practice) startPractice(opts.practice);
  else { S.mode = 'song'; $('#practicePanel').hidden = true; $('#playSub').textContent = m.lyricsCheck?.stale ? 'Full song · no lyrics until re-added from Drive' : 'Full song'; seek(0); }
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
    if (S.stats[i].judged && !S.stats[i].tot) continue; // never measured (app stalled / hidden): don't count as a miss
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

const whenReady = a => new Promise(res => {
  if (a.readyState >= 4) return res();
  const done = () => { a.removeEventListener('canplaythrough', done); res(); };
  a.addEventListener('canplaythrough', done); setTimeout(done, 6000);
});
async function play() {
  if (S.starting) return;
  S.starting = true;
  const ov = $('#overlay'), btn = $('#btnPlay');
  btn.disabled = true;
  await ensureAudio();
  ov.hidden = false; ov.textContent = 'Loading…';
  await Promise.all([whenReady(S.backing), whenReady(S.vocals)]);
  // count-in also gives Bluetooth / mic audio routing time to settle
  for (const n of [3, 2, 1]) { if (!S) return; ov.textContent = n; await new Promise(r => setTimeout(r, 700)); }
  if (!S) return;
  ov.hidden = true; btn.disabled = false; S.starting = false;
  S.vocals.currentTime = S.backing.currentTime;
  await Promise.all([S.backing.play(), S.vocals.play()]).catch(() => {});
  S.lastCT = S.backing.currentTime; S.lastPerf = performance.now(); S.lastT = S.lastCT; S.nextSync = performance.now() + 1500;
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
$('#guideVol').oninput = e => { settings.guide = +e.target.value; saveSettings(); if (S && !S.guideStale) S.gV.gain.value = settings.guide; };
$('#speedSel').onchange = e => { if (!S) return; S.rate = +e.target.value; S.backing.playbackRate = S.vocals.playbackRate = S.rate; };

// ---------- main loop ----------
function tick() {
  if (!S) return;
  const t = songTime();
  const L = (settings.latency / 1000) * S.rate;
  const ts = t - L; // song time of the voice we're hearing now
  let r = null;
  lyricsTick(ts);
  if (S.mode === 'record') { recordTick(t, ts); draw(ts, ts); requestAnimationFrame(tick); return; }
  if (S.mode === 'sync') {
    melody(t);
    if (S.running && (S.backing.ended || t >= S.meta.duration - 0.05)) finishSync();
    draw(ts, ts); requestAnimationFrame(tick); return;
  }
  if (S.running) {
    r = SIM ? simVoice(ts) : readMic();
    scoreFrame(ts, r?.midi ?? null);
    S.trail.push({ t: ts, m: r?.midi ?? null });
    while (S.trail.length && S.trail[0].t < ts - 4) S.trail.shift();
  }
  judge(ts);
  melody(t);
  if (S.mode === 'song' && S.running && t >= S.meta.duration) { finishSong(); return; } // trimmed songs end early
  // re-sync guide track only on real drift, at most every 2 s (each seek stutters)
  if (S.running && performance.now() > S.nextSync && Math.abs(S.vocals.currentTime - S.backing.currentTime) > 0.15) {
    S.vocals.currentTime = S.backing.currentTime; S.nextSync = performance.now() + 2000;
  }
  if (S.mode === 'practice') practiceTick(t, ts);
  draw(ts, ts, r); // draw at "heard" time so bars line up with what she hears (Bluetooth delay)
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

function inLoop(i) { return S.mode === 'song' || (S.mode === 'practice' && i >= S.loop.a && i < S.loop.b); }

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
    if (!st.tot) continue;
    const sc = noteScore(st), n = S.notes[i];
    const [text, color] = sc >= 0.8 ? ['Perfect!', '--gold'] : sc >= 0.5 ? ['Good', '--good'] : ['Miss', '--miss'];
    S.pops.push({ t: n.t + n.d, p: n.p, text, color: css(color), born: performance.now() });
    if (S.mode === 'song') $('#liveScore').textContent = rangeScore(0, S.notes.length, true);
  }
}

function melody(t) {
  if (!melGain) return;
  const listen = S.mode === 'record' && S.rec?.listening;
  const list = listen ? S.rec.preview : S.notes;
  const on = (listen || $('#melodyTog').checked) && S.running && (S.mode !== 'record' || listen);
  let lo = 0, hi = list.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].t + list[m].d < t) lo = m + 1; else hi = m; }
  const n = list[lo];
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
  // practice / record range shading
  if (S.mode !== 'song') {
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
  // newly recorded melody (preview before Keep)
  if (S.mode === 'record' && S.rec.preview) {
    const bh = Math.max(6 * dpr, rowH * 0.75);
    for (const n of S.rec.preview) {
      if (n.t > t1 || n.t + n.d < t0) continue;
      roundRect(x(n.t), y(n.p) - bh / 2, Math.max(2, n.d * pps - 2 * dpr), bh, bh / 2, css('--accent'));
    }
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
  $('#resTitle').textContent = songName(song);
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
  if (S.starting) return;
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
  if (S.mode === 'record') {
    const n = S.phrases.length;
    S.rec.sel = ((S.rec.sel + 1 + dir + n + 1) % (n + 1)) - 1; // -1 = whole song
    loadRec(); return;
  }
  if (S.queue.length > 1) S.qi = (S.qi + dir + S.queue.length) % S.queue.length;
  else S.queue = [Math.min(S.phrases.length - 1, Math.max(0, S.queue[0] + dir))];
  loadLoop();
}

// ---------- record melody (a parent sings the reference) ----------
function startRecord() {
  S.mode = 'record';
  S.rec = { sel: -1, frames: [], preview: null, listening: false };
  $('#practicePanel').hidden = false;
  loadRec();
}
function loadRec() {
  const R = S.rec, p = R.sel >= 0 ? S.phrases[R.sel] : null;
  const dur = S.meta.duration;
  // capture window reaches a bit past the section so early/late notes are kept
  // (never past halfway to a neighbouring section, so its notes stay untouched)
  const prev = p && R.sel > 0 ? S.phrases[R.sel - 1].t1 : -1;
  const next = p && R.sel < S.phrases.length - 1 ? S.phrases[R.sel + 1].t0 : 1e9;
  S.loop = p
    ? { a: p.a, b: p.b, t0: Math.max(0, p.t0 - 0.4, (prev + p.t0) / 2), t1: Math.min(dur, p.t1 + 0.4, (p.t1 + next) / 2),
        start: Math.max(0, p.t0 - 3), end: Math.min(dur, p.t1 + 1) }
    : { a: 0, b: S.notes.length, t0: 0, t1: dur, start: 0, end: dur };
  R.frames = []; R.preview = null; R.listening = false;
  $('#recPanel').hidden = true;
  $('#playSub').textContent = 'Record melody · sing the tune with headphones on';
  $('#pSec').textContent = p ? `Re-record section ${R.sel + 1} of ${S.phrases.length}` : 'Record whole song';
  $('#pAttempts').textContent = 'Press Start and sing the melody. ◀ ▶ picks a section.';
  $('#liveScore').textContent = '🎙️';
  if (S.running) pause();
  $('#btnPlay').textContent = '▶ Start';
  seek(S.loop.start);
}
function recordTick(t, ts) {
  const R = S.rec, L = S.loop;
  melody(t);
  if (!S.running) return;
  if (!R.listening && ts >= L.t0 && ts <= L.t1) {
    const r = SIM ? simVoice(ts) : readMic();
    // sim: an adult singing an octave down and a little flat
    const m = r ? (SIM ? r.midi - 12 - 0.3 : r.midi) : null;
    R.frames.push({ t: ts, m });
    S.trail.push({ t: ts, m });
    while (S.trail.length && S.trail[0].t < ts - 4) S.trail.shift();
  }
  if (t >= L.end || S.backing.ended) finishRec();
}
function finishRec() {
  const R = S.rec;
  pause();
  if (R.listening) { R.listening = false; $('#recPanel').hidden = false; seek(S.loop.start); return; }
  const voiced = R.frames.filter(f => f.m != null).length;
  if (voiced < 20) { toast("Didn't hear singing. Check the mic and try again."); seek(S.loop.start); return; }
  const old = S.notes.slice(S.loop.a, S.loop.b).map(n => n.p).sort((a, b) => a - b);
  const target = old.length ? old[old.length >> 1] : 67;
  R.preview = placeOctave(framesToNotes(R.frames), target);
  $('#pAttempts').textContent = `Heard ${R.preview.length} notes (pink). Listen, then Keep or Retry.`;
  $('#recPanel').hidden = false;
  $('#btnPlay').textContent = '▶ Start';
  seek(S.loop.start);
}
$('#btnRecListen').onclick = () => { if (!S?.rec?.preview) return; S.rec.listening = true; $('#recPanel').hidden = true; seek(S.loop.start); play(); };
$('#btnRecRetry').onclick = () => { if (S) loadRec(); };
$('#btnRecDiscard').onclick = () => { if (!S) return; closeSession(); show('library'); renderLibrary(); };
$('#btnRecKeep').onclick = async () => {
  if (!S?.rec?.preview) return;
  const { t0, t1 } = S.loop, id = S.song.id;
  const kept = S.notes.filter(n => n.t + n.d <= t0 || n.t >= t1);
  const notes = kept.concat(S.rec.preview).sort((a, b) => a.t - b.t);
  const song = await db.getSong(id);
  song.meta = { ...song.meta, notes, phrases: toPhrases(notes), range: noteRange(notes), edited: true };
  await db.putSong(song);
  const sel = S.rec.sel;
  closeSession();
  toast('Melody saved ✓  (use ⤓ to export it)');
  // reopen to check it, with the new notes playing as tones
  openSong(id, sel >= 0 ? { practice: { queue: [Math.min(sel, song.meta.phrases.length - 1)], fromResults: false }, hearNotes: true } : { hearNotes: true });
};

// ---------- trim: end the song early (drops notes/sections/lyrics after it) ----------
async function trimSong(id) {
  const s = await db.getSong(id), cur = fmtTime(s.meta.duration);
  const v = prompt(`End "${songName(s)}" at (m:ss)? Now ends at ${cur}.`, cur);
  if (!v) return;
  const m = v.trim().match(/^(\d+):(\d{1,2})$/);
  if (!m) { toast('Use m:ss, like 3:18'); return; }
  const end = +m[1] * 60 + +m[2];
  if (end < 5 || end > s.meta.duration) { toast('That time is outside the song'); return; }
  const notes = s.meta.notes.filter(n => n.t < end)
    .map(n => (n.t + n.d > end ? { ...n, d: +(end - n.t).toFixed(3) } : n)).filter(n => n.d >= 0.08);
  s.meta = { ...s.meta, duration: end, notes, phrases: toPhrases(notes), range: noteRange(notes),
    lyrics: (s.meta.lyrics || []).filter(l => l.t == null || l.t < end) };
  await db.putSong(s);
  toast(`Song now ends at ${fmtTime(end)} ✓`);
  renderLibrary();
}

// ---------- export a song pack (e.g. after re-recording the melody) ----------
async function exportSong(id) {
  const s = await db.getSong(id);
  const u8 = async b => new Uint8Array(await b.arrayBuffer());
  const blob = writeZip({
    'song.json': new TextEncoder().encode(JSON.stringify(s.meta)),
    'backing.mp3': await u8(s.backing),
    'vocals.mp3': await u8(s.vocals),
  });
  const name = `${id}.song`;
  if (window.showSaveFilePicker) { // desktop Chrome/Edge: save straight into the Drive folder
    try {
      const h = await showSaveFilePicker({ suggestedName: name, types: [{ description: 'Pitch Star song', accept: { 'application/zip': ['.song'] } }] });
      const w = await h.createWritable(); await w.write(blob); await w.close();
      toast('Exported ✓'); return;
    } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast('Exported to Downloads ✓');
}

// ---------- lyrics: auto-found online (LRCLIB), editable, tap-to-sync, karaoke display ----------
const cleanTitle = t => t.replace(/\(.*?\)|\[.*?\]|\|.*$|\s[-–—]\s.*$/g, '')
  .replace(/\b(piano|karaoke|instrumental|accompaniment|lyrics?|official|video|audio)\b/ig, '').replace(/\s+/g, ' ').trim();
function parseLrc(s) {
  return (s || '').split('\n').map(l => {
    const m = l.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)/);
    return m && { t: +m[1] * 60 + +m[2], text: m[3].trim() };
  }).filter(l => l && l.text);
}
async function searchLyrics(q) {
  const r = await fetch('https://lrclib.net/api/search?q=' + encodeURIComponent(q));
  if (!r.ok) throw new Error('search failed');
  return (await r.json()).filter(x => x.plainLyrics || x.syncedLyrics);
}
// result -> [{t|null, text}]; keep timings only when it is (very likely) the same recording
function lyricsFrom(x, duration) {
  const timed = x.syncedLyrics && Math.abs(x.duration - duration) < 4;
  if (timed) return { lines: parseLrc(x.syncedLyrics), timed: true };
  const text = x.plainLyrics || parseLrc(x.syncedLyrics).map(l => l.text).join('\n');
  return { lines: text.split('\n').map(s => s.trim()).filter(Boolean).map(text => ({ t: null, text })), timed: false };
}
// Lyrics are never auto-added by title on the phone: a title match can be a different song
// (2026-11-22). Packs carry lyrics verified against the singing at prep time; anything else
// is picked by hand in the 📝 dialog.
async function autoLyrics(id) {
  return db.getSong(id);
}

let lyId = null, lyTimes = null;
async function openLyrics(id) {
  lyId = id;
  const s = await autoLyrics(id) || await db.getSong(id);
  const ly = s.meta.lyrics || [];
  $('#lyText').value = ly.map(l => l.text).join('\n');
  lyTimes = ly.some(l => l.t != null) ? ly.map(l => l.t) : null;
  $('#lySearch').value = cleanTitle(s.title);
  $('#lyResults').innerHTML = '';
  $('#lyInfo').textContent = !ly.length ? 'No lyrics found automatically. Try Find with a different title, or paste them.'
    : lyTimes ? 'Timed to this recording ✓' : 'Each line follows a section. "Tap to sync" gives exact timing.';
  $('#lyricsDlg').showModal();
}
$('#lyText').oninput = () => {
  if (lyTimes && $('#lyText').value.split('\n').filter(l => l.trim()).length !== lyTimes.length) {
    lyTimes = null; $('#lyInfo').textContent = 'Lines changed: timing reset. Use tap to sync.';
  }
};
$('#btnLyFind').onclick = async () => {
  const q = $('#lySearch').value.trim(), box = $('#lyResults');
  if (!q) return;
  box.textContent = 'Searching…';
  try {
    const res = (await searchLyrics(q)).slice(0, 8), s = await db.getSong(lyId);
    box.innerHTML = '';
    if (!res.length) box.textContent = 'Nothing found. Try another title or paste the lyrics.';
    for (const x of res) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn small';
      const { lines, timed } = lyricsFrom(x, s.meta.duration);
      b.textContent = `${x.trackName} – ${x.artistName} (${fmtTime(x.duration)})${timed ? '  ⏱ timed' : ''}`;
      b.onclick = () => {
        $('#lyText').value = lines.map(l => l.text).join('\n');
        lyTimes = timed ? lines.map(l => l.t) : null;
        $('#lyInfo').textContent = timed ? 'Timed to this recording ✓' : 'Each line follows a section. "Tap to sync" gives exact timing.';
        box.innerHTML = '';
      };
      box.append(b);
    }
  } catch { box.textContent = 'Search failed (offline?). Paste the lyrics instead.'; }
};
async function saveLyrics() {
  const lines = $('#lyText').value.split('\n').map(l => l.trim()).filter(Boolean);
  const s = await db.getSong(lyId);
  s.meta = { ...s.meta, lyricsTried: true, lyricsCheck: { source: 'manual' }, // picked/typed by the user = checked by the user
    lyrics: lines.map((text, i) => ({ t: lyTimes ? lyTimes[i] : null, text })) };
  await db.putSong(s);
  return s;
}
$('#btnLySave').onclick = async () => { await saveLyrics(); $('#lyricsDlg').close(); toast('Lyrics saved ✓'); };
$('#btnLySync').onclick = async () => {
  const s = await saveLyrics(); $('#lyricsDlg').close();
  if (s.meta.lyrics.length) openSong(lyId, { sync: true });
};

// resolve each line's start time (own timing, else its section) and each word's time (spread over the notes)
function buildLyrics() {
  const ly = S.meta.lyrics || [];
  const starts = ly.map((l, i) => l.t ?? S.phrases[i]?.t0 ?? null);
  S.lyr = [];
  ly.forEach((l, i) => {
    if (starts[i] == null) return;
    const t0 = starts[i], t1 = starts.slice(i + 1).find(x => x != null) ?? t0 + 8;
    const words = l.text.split(/\s+/);
    const ns = S.notes.filter(n => n.t >= t0 - 0.2 && n.t < t1 - 0.1);
    const wt = words.map((_, k) => ns.length ? ns[Math.floor((k * ns.length) / words.length)].t : t0 + (k * (t1 - t0)) / words.length);
    S.lyr.push({ t0, words, wt });
  });
  S.lyIdx = -2;
}
function lyricsTick(ts) {
  const box = $('#lyrics');
  const want = settings.lyrics && S.lyr?.length && S.mode !== 'sync';
  box.hidden = !want;
  if (!want) return;
  let i = -1;
  for (let k = 0; k < S.lyr.length; k++) if (S.lyr[k].t0 - 0.6 <= ts) i = k; else break;
  if (i !== S.lyIdx) {
    S.lyIdx = i;
    const cur = $('#lyCur'); cur.innerHTML = '';
    if (i >= 0) S.lyr[i].words.forEach((w, k) => { const sp = document.createElement('span'); sp.className = 'w'; sp.textContent = w + ' '; cur.append(sp); });
    $('#lyNext').textContent = S.lyr[i + 1]?.words.join(' ') || '';
  }
  if (i >= 0) {
    const spans = $('#lyCur').children, wt = S.lyr[i].wt;
    for (let k = 0; k < spans.length; k++) spans[k].classList.toggle('on', wt[k] <= ts);
  }
}
$('#lyricsTog').onchange = e => { settings.lyrics = e.target.checked; saveSettings(); };

function startSync() {
  S.mode = 'sync'; S.sync = { i: 0, times: [] };
  $('#practicePanel').hidden = false; $('#syncPanel').hidden = false;
  $('#playSub').textContent = 'Tap to sync lyrics';
  updateSyncUI();
  seek(0);
}
function updateSyncUI() {
  const ly = S.meta.lyrics, i = S.sync.i;
  $('#pSec').textContent = `Line ${Math.min(i + 1, ly.length)} of ${ly.length}`;
  $('#pAttempts').textContent = ly[i] ? `Next: “${ly[i].text}”` : 'Done';
}
function tapLine() {
  if (!S || S.mode !== 'sync' || !S.running) return;
  const ts = songTime() - (settings.latency / 1000) * S.rate;
  S.sync.times[S.sync.i++] = Math.max(0, +(ts - 0.1).toFixed(2));
  if (S.sync.i >= S.meta.lyrics.length) finishSync(); else updateSyncUI();
}
async function finishSync() {
  if (!S || S.mode !== 'sync') return;
  pause();
  const id = S.song.id, times = S.sync.times;
  const s = await db.getSong(id);
  s.meta = { ...s.meta, lyrics: s.meta.lyrics.map((l, i) => ({ ...l, t: times[i] ?? l.t })) };
  await db.putSong(s);
  closeSession(); toast('Lyrics timing saved ✓');
  openSong(id);
}
$('#btnTap').onclick = tapLine;
addEventListener('keydown', e => { if (e.code === 'Space' && S?.mode === 'sync') { e.preventDefault(); tapLine(); } });

// ---------- settings ----------
const dlg = $('#settingsDlg');
let micTestOn = false;
$('#btnSettings').onclick = () => {
  $('#setDifficulty').value = settings.difficulty;
  $('#setPass').value = settings.passTarget; $('#passOut').textContent = settings.passTarget;
  showLatency(); fillMicLists();
  dlg.showModal();
};
$('#setDifficulty').onchange = e => { settings.difficulty = e.target.value; saveSettings(); };
$('#setPass').oninput = e => { settings.passTarget = +e.target.value; $('#passOut').textContent = e.target.value; saveSettings(); };
$('#setLatency').oninput = e => setLatency(+e.target.value);
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

// ---------- latency calibration: beeps, singer says "tick" on each; median lag = delay ----------
$('#btnCalib').onclick = async () => {
  const out = $('#calibOut'), btn = $('#btnCalib');
  try { await ensureAudio(); } catch { out.textContent = 'mic blocked'; return; }
  if (!analyser) { out.textContent = 'no mic'; return; }
  btn.disabled = true;
  const N = 10, gap = 0.8, t0 = ctx.currentTime + 1.5;
  const beeps = [];
  for (let i = 0; i < N; i++) {
    const t = t0 + i * gap, o = ctx.createOscillator(), gn = ctx.createGain();
    o.frequency.value = 1200; gn.gain.setValueAtTime(0, t);
    gn.gain.linearRampToValueAtTime(0.4, t + 0.005); gn.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(gn).connect(OUT); o.start(t); o.stop(t + 0.1);
    beeps.push(t);
  }
  const buf = new Float32Array(analyser.fftSize), onsets = [];
  let floor = 0, nf = 0, last = -1, prev = 0;
  const end = t0 + N * gap + 0.6;
  await new Promise(done => {
    const loop = () => {
      const now = ctx.currentTime;
      analyser.getFloatTimeDomainData(buf);
      let r = 0; for (let i = 0; i < buf.length; i++) r += buf[i] * buf[i];
      r = Math.sqrt(r / buf.length);
      if (now < t0 - 0.1) { floor += r; nf++; out.textContent = 'Get ready…'; }
      else {
        const th = Math.max(0.02, (floor / Math.max(1, nf)) * 5);
        if (r > th && prev <= th && now - last > 0.3) { onsets.push(now); last = now; }
        const k = Math.floor((now - t0) / gap) + 1;
        out.textContent = k >= 1 && k <= N ? `Say "tick"! ${k}/${N}` : '';
      }
      prev = r;
      if (now < end) requestAnimationFrame(loop); else done();
    };
    loop();
  });
  btn.disabled = false;
  const lags = beeps.slice(2).map(b => onsets.find(o => o > b + 0.02 && o < b + 0.6)).map((o, i) => o && o - beeps[i + 2]).filter(Boolean);
  if (lags.length < 4) { out.textContent = `Heard ${lags.length} ticks. Try again, a bit louder.`; return; }
  lags.sort((a, b) => a - b);
  const ms = Math.round((lags[lags.length >> 1] * 1000) / 10) * 10;
  setLatency(Math.min(600, Math.max(0, ms)));
  out.textContent = `Delay set to ${settings.latency} ms ✓`;
};

// ---------- wake lock ----------
let wake = null;
async function grabWake() { try { wake ??= await navigator.wakeLock?.request('screen'); } catch {} }
function releaseWake() { wake?.release().catch(() => {}); wake = null; }

// ---------- boot ----------
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js?v=202611222342', { updateViaCache: 'none' });
  // new version installed -> reload once, but never in the middle of a song
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    const reload = () => (S ? setTimeout(reload, 2000) : location.reload());
    reload();
  });
}
// Lyrics without a check record (lyricsCheck) came from the old title-only lookup and can be
// another song's words (2026-11-22). Remove them; re-adding the pack from Drive brings verified ones.
function dropUnverified(meta) {
  if (!meta.lyrics?.length || meta.lyricsCheck) return false;
  meta.lyrics = [];
  meta.lyricsCheck = { source: 'none', stale: true, reason: 'old unverified lyrics removed; re-add the song from Drive' };
  return true;
}
async function cleanOldLyrics() {
  for (const s of await db.allSongs()) if (dropUnverified(s.meta)) await db.putSong(s);
}
(async () => {
  await cleanOldLyrics();
  const load = params.get('load'); // dev: ?load=../songs/x.song
  if (load) {
    try { const r = await fetch(load); await importPack(await r.arrayBuffer(), load.split('/').pop()); } catch (e) { toast('load failed: ' + e.message); }
  }
  renderLibrary();
})();
