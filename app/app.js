// ?v= stamps are rewritten by publish.ps1 so every publish loads fresh files past GitHub's CDN cache
import { readZip, writeZip } from './zip.js?v=202611241444';
import * as db from './db.js?v=202611241444';
import { detectPitch } from './pitch.js?v=202611241444';
import { framesToNotes, placeOctave, toPhrases, noteRange } from './melody.js?v=202611241444';

const $ = s => document.querySelector(s);
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = m => { const r = Math.round(m); return NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1); };
const fmtTime = s => (s = Math.max(0, s), `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
const TOL = { easy: 100, normal: 60, hard: 40 };
const params = new URLSearchParams(location.search);
const SIM = params.has('sim'); // dev: fake singer that follows the melody
if (SIM) window.__S = () => S; // dev inspection
if (SIM) setTimeout(() => { window.__score = { scoreFrame, noteScore, resetStats, lyricsTick, traceWrite, draw, simVoice }; }); // dev: scoring tests

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
// a dash with a space on at least one side splits ("DPEE- All I Want…"); "one-horse" doesn't. File
// extensions in uploaded-video titles (".wmv") are dropped.
const DASH = /\s[-–—]|[-–—]\s/;
const cleanT = t => t.replace(/\.(wmv|mp4|avi|mov|mkv|flv|webm|mp3|m4a|wav)\b/ig, '').replace(/\(.*?\)|\[.*?\]/g, '');
const splitTitle = t => cleanT(t).split(new RegExp(`\\s*\\|\\s*|${DASH.source}`)).map(x => x.trim()).filter(Boolean);
// words that mark a title part as a description ("Piano accompaniment"), never the song name
const DESCR = /\b(piano|accompaniment|karaoke|instrumental|cover|lyrics?|version|tutorial|backing track|official|video|audio|remaster(ed)?|live)\b/i;
function autoName(s) {
  // "Title | Channel": the song is before the first "|". Within it, YouTube's usual
  // "Artist - Title" puts the song second, unless that part is only a description.
  const first = cleanT(s.title).split('|')[0];
  const parts = first.split(DASH).map(x => x.trim()).filter(Boolean);
  const fromTitle = (parts.length > 1 && !DESCR.test(parts[1]) ? parts[1] : parts[0]) || s.title;
  // published title of the verified lyrics; the video's wording wins when it contains it
  // ("(all I want for Christmas is) My two front teeth" vs "All I Want for Christmas is my Two Front Teeth")
  // lyrics read off the video's slides carry no song title ("on-screen lyrics (video slides)")
  const pub = /^on-screen/.test(s.meta.lyricsCheck?.published || '') ? '' : s.meta.lyricsCheck?.published?.split(' – ')[0]?.trim();
  if (!pub) return fromTitle;
  const core = normW(pub.replace(/\(.*?\)/g, ''));
  return core && normW(fromTitle).includes(core) ? fromTitle : pub.replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
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
    b.textContent = `⚠ Lyrics need an update for: ${stale.map(songName).join(', ')}. Tap here and pick ${stale.length > 1 ? 'them' : 'it'} from Drive → PitchStar → Songs.`;
    b.onclick = () => $('#importInput').click();
    list.append(b);
  }
  // folders: songs without one sit on top, then one collapsible group per folder
  const folders = allFolders(songs);
  const boxes = { '': list };
  settings.folderOpen ||= {};
  for (const f of folders) {
    const n = songs.filter(s => songGroup(s) === f).length;
    const d = document.createElement('details'); d.className = 'folder';
    d.open = settings.folderOpen[f] !== false;
    d.innerHTML = '<summary><span></span><small></small></summary><div class="list"></div>';
    d.querySelector('span').textContent = '📁 ' + f;
    d.querySelector('small').textContent = n;
    d.ontoggle = () => { settings.folderOpen[f] = d.open; saveSettings(); };
    if (!n) {
      const e = document.createElement('div'); e.className = 'hint folderEmpty';
      e.innerHTML = 'Empty. Tap <b>📁</b> on a song to move it here. <button type="button" class="btn small">Remove folder</button>';
      e.querySelector('button').onclick = () => {
        settings.folders = (settings.folders || []).filter(x => x !== f);
        (settings.hiddenFolders ||= []).push(f); saveSettings(); renderLibrary();
      };
      d.querySelector('.list').append(e);
    }
    list.append(d); boxes[f] = d.querySelector('.list');
  }
  for (const s of songs) {
    const el = document.createElement('div'); el.className = 'card song';
    el.innerHTML = `<div class="meta"><b></b><small class="desc"></small><small>${s.meta.start ? `${fmtTime(s.meta.start)}–` : ''}${fmtTime(s.meta.duration)} · ${s.meta.phrases.length} sections${best[s.id] != null ? ` · best ${best[s.id]}` : ''}${s.meta.edited ? ' · ✎ own melody' : ''}</small><button class="chip" data-a="folder"></button>${s.meta.lyricsCheck?.stale ? '<button class="btn small warn" data-a="readd">⚠ Lyrics need an update: tap, then pick this song from Drive</button>' : ''}${unsavedEdits(s.meta) ? '<button class="btn small warn" data-a="saveEd">☁️ Save edits to Drive (so other devices get them)</button>' : ''}</div>
      <div class="actions">
        <button class="btn primary small" data-a="sing">▶ Sing</button>
        <button class="icon" data-a="edit" title="Rename" aria-label="Rename">✏️</button>
        <button class="icon" data-a="ly" title="Lyrics" aria-label="Lyrics">📝</button>
        <button class="icon" data-a="rec" title="Record melody" aria-label="Record melody">🎙️</button>
        <button class="icon" data-a="trim" title="Trim the start or end" aria-label="Trim">✂️</button>
        <button class="icon" data-a="exp" title="Export song file" aria-label="Export">⤓</button>
        <button class="icon" data-a="del" title="Remove" aria-label="Delete">🗑️</button>
      </div>`;
    el.querySelector('b').textContent = songName(s);
    const desc = songDesc(s), dEl = el.querySelector('.desc');
    if (desc) dEl.textContent = desc; else dEl.remove();
    el.querySelector('[data-a=readd]')?.addEventListener('click', () => $('#importInput').click());
    el.querySelector('[data-a=saveEd]')?.addEventListener('click', () => saveEdits(s.id));
    const g = songGroup(s), fb = el.querySelector('[data-a=folder]');
    fb.textContent = g ? `📁 ${g}` : '📁 Add to folder';
    fb.onclick = () => openFolderDlg(s);
    el.querySelector('[data-a=sing]').onclick = () => openSong(s.id);
    el.querySelector('[data-a=edit]').onclick = () => editSong(s);
    el.querySelector('[data-a=rec]').onclick = () => openSong(s.id, { record: true });
    el.querySelector('[data-a=ly]').onclick = () => openLyrics(s.id);
    el.querySelector('[data-a=exp]').onclick = () => exportSong(s.id);
    el.querySelector('[data-a=trim]').onclick = () => trimSong(s.id);
    el.querySelector('[data-a=del]').onclick = async () => {
      if (confirm(`Remove "${songName(s)}"?`)) { await db.deleteSong(s.id); renderLibrary(); }
    };
    boxes[songGroup(s) || ''].append(el);
  }
  // keep folders after the loose songs
  for (const f of folders) list.append(boxes[f].parentElement);
}

// ---------- folders (user request 2026-11-23: groups by genre or any custom folder; a Christmas
// folder out of the box; making a folder must be obvious) ----------
// meta.group: a folder name, '' = the user chose "no folder", missing = automatic.
// Automatic: Christmas songs (by title, verified title or lyrics) go into "Christmas".
const XMAS = /\b(christmas|xmas|jingle|santa|sleigh|reindeer|rudolph|noel|nativity|mistletoe|grinch|frosty|silent night|holly)\b/i;
const autoGroup = s => XMAS.test([s.title, s.meta.name, s.meta.lyricsCheck?.published, ...(s.meta.lyrics || []).map(l => l.text)].join(' ')) ? 'Christmas' : '';
const songGroup = s => (s.meta.group !== undefined ? s.meta.group : autoGroup(s));
function allFolders(songs) {
  const hidden = settings.hiddenFolders || [];
  const fs = new Set([...(settings.folders || []), ...(hidden.includes('Christmas') ? [] : ['Christmas'])]);
  songs.forEach(s => songGroup(s) && fs.add(songGroup(s)));
  return [...fs].sort((a, b) => a.localeCompare(b));
}
let folderSongId = null;
async function openFolderDlg(s) {
  folderSongId = s?.id ?? null;
  $('#fdTitle').textContent = s ? 'Put in a folder' : 'New folder';
  $('#fdSong').textContent = s ? songName(s) : 'Name the folder, then tap 📁 on any song to move it in.';
  const box = $('#fdList'); box.innerHTML = '';
  if (s) {
    const cur = songGroup(s);
    for (const f of [...allFolders(await db.allSongs()), '']) {
      const b = document.createElement('button'); b.type = 'button';
      b.className = 'btn' + (f === cur ? ' primary' : '');
      b.textContent = f ? `📁 ${f}` : 'No folder';
      b.onclick = () => setFolder(f);
      box.append(b);
    }
  }
  $('#fdNew').value = '';
  $('#folderDlg').showModal();
}
async function setFolder(f) {
  if (folderSongId) { const s = await db.getSong(folderSongId); s.meta.group = f; await db.putSong(s); }
  $('#folderDlg').close(); renderLibrary();
}
$('#btnFdNew').onclick = async () => {
  const f = $('#fdNew').value.trim().replace(/\s+/g, ' ');
  if (!f) { $('#fdNew').focus(); return; }
  settings.folders = [...new Set([...(settings.folders || []), f])];
  settings.hiddenFolders = (settings.hiddenFolders || []).filter(x => x !== f);
  settings.folderOpen ||= {}; settings.folderOpen[f] = true; saveSettings();
  if (folderSongId) await setFolder(f);
  else { $('#folderDlg').close(); renderLibrary(); toast(`Folder "${f}" made. Tap 📁 on a song to move it in.`, 4000); }
};
$('#fdNew').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('#btnFdNew').click(); } };
$('#btnNewFolder').onclick = () => openFolderDlg(null);

// rename dialog
let editId = null;
function editSong(s) {
  editId = s.id;
  $('#edName').value = s.meta.name || '';
  $('#edName').placeholder = autoName(s);
  $('#edFull').textContent = s.title;
  $('#editDlg').showModal();
}
$('#btnEdSave').onclick = async () => {
  const s = await db.getSong(editId);
  const name = $('#edName').value.trim();
  if (name) s.meta.name = name; else delete s.meta.name;
  await db.putSong(s);
  $('#editDlg').close(); renderLibrary();
};

// ---------- edits -> Drive (user, 2026-11-23: "pull my edits into the source files so that other
// devices can pull them in as the master source"). Every local edit stamps meta.editedAt.
// ☁️ writes <id>.edits.txt (JSON) into Drive; tools\merge_edits.py folds it into the master pack
// and stamps the pack's meta.editsMerged with the edit time. ----------
const unsavedEdits = m => !!m.editedAt && !((m.editsSaved || 0) >= m.editedAt);
async function saveEdits(id) {
  const s = await db.getSong(id), m = s.meta;
  const ed = {
    type: 'pitchstar-edits', version: 1, song: id, title: s.title, saved: new Date().toISOString(), editedAt: m.editedAt,
    notes: m.edited ? m.notes : undefined,
    start: m.start || undefined,
    end: m.fullDuration && m.duration < m.fullDuration - 0.5 ? m.duration : undefined,
    name: m.name, group: m.group,
    lyrics: m.lyrics?.length ? m.lyrics : undefined,
    lyricsManual: m.lyricsCheck?.source === 'manual' || undefined,
  };
  const name = `${id}.edits.txt`;
  const file = new File([JSON.stringify(ed)], name, { type: 'text/plain' });
  try {
    if (window.showSaveFilePicker) { // desktop Chrome/Edge: save straight into G:\My Drive\PitchStar\PrepFiles
      const h = await showSaveFilePicker({ suggestedName: name, types: [{ description: 'Pitch Star edits', accept: { 'text/plain': ['.txt'] } }] });
      const w = await h.createWritable(); await w.write(file); await w.close();
    } else if (navigator.canShare?.({ files: [file] })) { // phone: share sheet -> Drive -> PitchStar -> PrepFiles
      await navigator.share({ files: [file], title: `${songName(s)} edits` });
    } else {
      const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }
  } catch (e) { if (e.name === 'AbortError') return; toast(`Couldn't save: ${e.message}`, 4000); return; }
  s.meta.editsSaved = Date.now(); await db.putSong(s);
  toast('Edits saved ✓  Put them in Drive → PitchStar → PrepFiles; the PC merges them into the song.', 5000);
  renderLibrary();
}

async function importPack(buf, fname) {
  const z = await readZip(buf);
  const meta = JSON.parse(new TextDecoder().decode(z['song.json']));
  const id = (fname || meta.title).replace(/\.song$/i, '');
  // re-adding an updated pack keeps the name and folder chosen on this phone
  const old = await db.getSong(id);
  // don't silently throw away edits made here that the Drive pack doesn't have yet
  if (old?.meta?.editedAt && !((meta.editsMerged || 0) >= old.meta.editedAt) &&
      !confirm(`"${songName(old)}" has edits on this device that this Drive file doesn't have yet` +
        `${unsavedEdits(old.meta) ? ' (not saved with ☁️)' : ' (saved, but not merged on the PC yet)'}.\n\nReplace them with the Drive version?`)) {
    // keeping the edits here still takes a new check-singer tune from the Drive file
    if (meta.check && meta.check.at !== old.meta.check?.at) {
      old.meta = { ...old.meta, check: meta.check }; await db.putSong(old);
      throw new Error('kept your edits here, added the 🔔 check singer');
    }
    throw new Error('kept your edits');
  }
  for (const k of ['name', 'group']) if (old?.meta?.[k] !== undefined && meta[k] === undefined) meta[k] = old.meta[k]; // '' (no folder) is kept too
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
  if (ok) { toast(`Added ${ok} song${ok > 1 ? 's' : ''}`); keepStorage(); } // ask again right after a tap (some browsers want one)
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
    // every note on screen, even one moved an octave away (the range field skips the outer 3%)
    // the view = the song's lowest to highest note (+2 semitones so edge bars aren't cut)
    lo: Math.min(...m.notes.map(n => n.p), m.range[0]) - 2, hi: Math.max(...m.notes.map(n => n.p), m.range[1]) + 2, rate: 1, trail: [], pops: [], running: false,
    mode: 'song', queue: [], qi: 0, attempts: [], passes: 0, guideStale,
  };
  S.trace = traceFor(song);
  S.flags = checkFlags();
  $('#edCheckRow').hidden = !m.check?.notes?.length;
  $('#edCheckSing').checked = false; $('#edFlagInfo').textContent = '';
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
  else { S.mode = 'song'; $('#practicePanel').hidden = true; $('#playSub').textContent = m.lyricsCheck?.stale ? 'Full song · no lyrics until re-added from Drive' : 'Full song'; seek(m.start || 0); }
  $('#editPanel').hidden = true;
  $('#btnEdit').hidden = S.mode !== 'song';
  $('#btnBack10').hidden = $('#btnFwd10').hidden = S.mode === 'sync' || S.mode === 'record';
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
const noteScore = st => (st.tot ? Math.max(st.hit / st.tot, st.floor || 0) : 0);
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

// ---------- whole-song pitch trace: what she sang, kept for the editor (user, 2026-11-23: "If I
// made a live pitch trace while singing in play mode, I would like that trace to remain when in
// edit mode"). 20 ms bins per song, NaN = silence; singing a stretch again overwrites it. Kept
// while the app is open (also across "Sing again"). ----------
const TRACE_DT = 0.02, traces = new Map();
function traceFor(song) {
  const need = Math.ceil((song.meta.fullDuration || song.meta.duration) / TRACE_DT) + 2;
  let tr = traces.get(song.id);
  if (!tr || tr.length < need) {
    const n = new Float32Array(need).fill(NaN);
    if (tr) n.set(tr.subarray(0, Math.min(tr.length, need)));
    traces.set(song.id, tr = n);
  }
  return tr;
}
function traceWrite(ts, midi) {
  const tr = S.trace, b = Math.round(ts / TRACE_DT);
  if (!tr || b < 0 || b >= tr.length) return;
  const from = S.traceBin != null && b > S.traceBin && b - S.traceBin < 10 ? S.traceBin + 1 : b; // fill gaps between frames
  for (let k = from; k <= b; k++) tr[k] = midi ?? NaN;
  S.traceBin = b;
}

function seek(t) {
  t = Math.max(0, t);
  if (S) S.traceBin = null;
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
  // no count-in (user, 2026-11-23: "you can kill the 3 second countdown, no longer has value")
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

// ---------- skip back / forward 10 s (user, 2026-11-23) ----------
function skip(dt) {
  if (!S || S.starting || S.mode === 'sync' || S.mode === 'record') return;
  const now = songTime();
  const lo = S.mode === 'practice' ? S.loop.t0 : (S.meta.start || 0);
  const hi = (S.mode === 'practice' ? S.loop.t1 : S.meta.duration) - 1;
  const t = Math.min(hi, Math.max(lo, now + dt));
  if (t < now) resetStats(lowerBound(t), lowerBound(now) + 1); // going back: those notes count again
  seek(t);
}
$('#btnBack10').onclick = () => skip(-10);
$('#btnFwd10').onclick = () => skip(10);

// ---------- note editor: pick a target note, move / re-pitch / delete it (user, 2026-11-23:
// "be able to delete or move/edit pitch targets"). Each change is saved right away. ----------
function beep(p) {
  if (!ctx || SIM) return;
  if (performance.now() - (beep.last || 0) < 40) return; // a mass edit beeps once
  beep.last = performance.now();
  const o = ctx.createOscillator(), gn = ctx.createGain();
  o.type = 'triangle'; o.frequency.value = 440 * 2 ** ((p - 69) / 12);
  gn.gain.setValueAtTime(0.2, ctx.currentTime); gn.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
  o.connect(gn).connect(OUT); o.start(); o.stop(ctx.currentTime + 0.5);
}
function edShow() {
  const n = S.notes[S.sel], many = selected();
  $('#edMulti').textContent = S.multiMode ? '☑ select many' : '☐ select many';
  $('#edMulti').classList.toggle('primary', !!S.multiMode);
  if (many.length > 1) {
    const ps = many.map(x => x.p), last = many[many.length - 1];
    $('#edInfo').textContent = `${many.length} notes · ${noteName(Math.min(...ps))}–${noteName(Math.max(...ps))} · ${fmtTenth(many[0].t)}–${fmtTenth(last.t + last.d)}`;
    if (S.meta.check) $('#edFlagInfo').textContent = '';
    return;
  }
  $('#edInfo').textContent = n ?`${noteName(n.p)} at ${fmtTime(n.t)}.${String(Math.floor((n.t % 1) * 10))} · ${n.d.toFixed(2)} s` : 'Tap a note to pick it';
  if (S.meta.check) {
    const fs = (S.flags || []).filter(f => f.i === S.sel && S.sel != null);
    $('#edFlagInfo').textContent = fs.length ? '⚠ ' + fs.map(f => f.msg).join(' · ') : n ? '🔔 agrees with this note' : '';
  }
}

// ---------- check singer (user, 2026-11-24: "make a singer tool that sings without melisma along
// with the song as it understands it without looking at the pitch markers ... as a means of
// validating the pitch markers"). tools\check_notes.py works out the tune again a different way
// (pYIN pitch, one note per sung syllable) and stores it as meta.check. Edit mode draws it as
// dashed outlines, marks the targets it disagrees with (⚠), and 🔔 plays it instead of the targets.
// Same rules as check_notes.py compare(); octaves are ignored, like scoring.
const fold12 = d => ((((d + 6) % 12) + 12) % 12) - 6;
const ovl = (a, b) => Math.max(0, Math.min(a.t + a.d, b.t + b.d) - Math.max(a.t, b.t));
function checkHits(n) {
  const ck = S.meta.check?.notes || [];
  return ck.filter(c => c.t < n.t + n.d && c.t + c.d > n.t);
}
// spoken lyric lines (on-screen lyrics mark them): speech there is not a missing note
function spokenSpans() {
  const ly = S.meta.lyrics || [], out = [];
  ly.forEach((l, k) => {
    if (!l.spoken || l.t == null) return;
    const nxt = ly.slice(k + 1).find(x => x.t != null)?.t ?? l.t + 6;
    out.push([l.t - 0.2, nxt - 0.1]);
  });
  return out;
}
function checkFlags() {
  const sp = spokenSpans();
  const ck = S.meta.check?.notes?.filter(c => !sp.some(([a, b]) => c.t + c.d / 2 >= a && c.t + c.d / 2 < b));
  if (!ck?.length) return [];
  const out = [];
  S.notes.forEach((n, i) => {
    const hits = checkHits(n), sung = hits.reduce((s, c) => s + ovl(n, c), 0);
    if (sung < 0.3 * n.d) { out.push({ t: n.t, i, msg: `the check singer hears no singing under this ${noteName(n.p)}` }); return; }
    const by = new Map();
    for (const c of hits) { const k = fold12(c.p - n.p); by.set(k, (by.get(k) || 0) + ovl(n, c)); }
    const [k, share] = [...by].sort((a, b) => b[1] - a[1])[0];
    const main = hits.filter(c => fold12(c.p - n.p) === k).sort((a, b) => ovl(n, b) - ovl(n, a))[0];
    if (k && share >= 0.5 * n.d && Math.abs(fold12((main.c ?? main.p) - n.p)) >= 0.7)
      out.push({ t: n.t, i, msg: `check singer sings ${noteName(n.p + k)} here, not ${noteName(n.p)}` });
    const last = Math.max(...hits.map(c => c.t + c.d));
    if (n.t + n.d - last > 0.3 && n.d > 0.5) out.push({ t: n.t, i, msg: `singing stops ${(n.t + n.d - last).toFixed(1)} s before this note ends (too long?)` });
  });
  for (const c of ck) {
    if (c.d < 0.3) continue;
    const cov = S.notes.reduce((s, n) => s + ovl(c, n), 0);
    if (cov < 0.3 * c.d) out.push({ t: c.t, i: -1, c, msg: `check singer sings ${noteName(c.p)} for ${c.d.toFixed(1)} s with no target here (missing note? ＋ adds one)` });
  }
  return out.sort((a, b) => a.t - b.t);
}
$('#edCheckSing').onchange = () => { if (S) S.checkSing = $('#edCheckSing').checked; };
$('#edFlag').onclick = () => {
  if (!S?.edit) return;
  if (!S.flags.length) { $('#edFlagInfo').textContent = '🔔 agrees with every target ✓'; return; }
  // step through the list; if a different note was picked meanwhile, carry on from that note
  const cur = S.flags[S.flagK];
  let k;
  if (cur && (cur.i < 0 ? S.sel == null : cur.i === S.sel)) k = (S.flagK + 1) % S.flags.length;
  else {
    const base = S.sel != null && S.notes[S.sel] ? S.notes[S.sel].t + 0.001 : songTime();
    k = Math.max(0, S.flags.findIndex(f => f.t >= base));
  }
  const f = S.flags[k]; S.flagK = k;
  if (f.i >= 0) { edSelect(f.i); seek(Math.max(0, f.t - 1)); }
  else { S.sel = null; seek(Math.max(0, f.t - 1)); edShow(); }
  $('#edFlagInfo').textContent = `⚠ ${k + 1}/${S.flags.length} at ${fmtTenth(f.t)}: ${f.msg}`;
};
$('#edTake').onclick = () => {
  if (!selected().length) { toast('Tap a note first'); return; }
  let none = 0;
  edApply(x => { // each picked note takes the check singer's note under it
    const c = checkHits(x).sort((a, b) => ovl(x, b) - ovl(x, a))[0];
    if (c) { x.p += fold12(c.p - x.p); beep(x.p); } else none++;
  });
  if (none) toast(`The check singer sings nothing under ${none} of them`);
};

// ---------- several notes at once (user, 2026-11-24: "let me select multiple pitch markers for
// mass shifting options"). S.multi holds the picked note objects (they survive re-sorting); every
// edit button then works on all of them. S.sel stays the "first" note (🎤 lines it up). ----------
function selected() {
  if (!S) return [];
  if (S.multi?.size) return [...S.multi].filter(n => S.notes.includes(n)).sort((a, b) => a.t - b.t);
  return S.notes[S.sel] ? [S.notes[S.sel]] : [];
}
function toggleMulti(n) {
  S.multi ??= new Set();
  if (!S.multi.size && S.notes[S.sel] && S.notes[S.sel] !== n) S.multi.add(S.notes[S.sel]);
  if (S.multi.has(n)) S.multi.delete(n); else { S.multi.add(n); beep(n.p); }
  const first = selected()[0];
  S.sel = first ? S.notes.indexOf(first) : null;
  edShow();
}
function pushUndo() {
  (S.undo ??= []).push(S.notes.map(n => ({ ...n })));
  if (S.undo.length > 50) S.undo.shift();
}
$('#edMulti').onclick = () => {
  if (!S?.edit) return;
  S.multiMode = !S.multiMode;
  if (!S.multiMode) { const f = selected()[0]; S.multi = new Set(); S.sel = f ? S.notes.indexOf(f) : S.sel; }
  else if (S.notes[S.sel]) S.multi = new Set([S.notes[S.sel]]);
  toast(S.multiMode ? 'Tap notes to add or remove them · › adds the next one' : 'One note at a time');
  edShow();
};
$('#edView').onclick = () => {
  if (!S?.edit || !S.geo) return;
  const { t, pps, nowX } = S.geo, a = t - nowX / pps, b = t + (cv.width - nowX) / pps;
  const vis = S.notes.filter(n => n.t + n.d > a && n.t < b);
  if (!vis.length) { toast('No notes on screen'); return; }
  S.multiMode = true; S.multi = new Set(vis); S.sel = S.notes.indexOf(vis[0]);
  edShow();
};
$('#edUndo').onclick = () => {
  if (!S?.edit) return;
  const prev = S.undo?.pop();
  if (!prev) { toast('Nothing to undo'); return; }
  const firstT = selected()[0]?.t;
  S.notes.splice(0, S.notes.length, ...prev);
  S.multi = new Set();
  edChanged();
  S.sel = firstT != null ? Math.max(0, Math.min(S.notes.length - 1, lowerBound(firstT))) : null;
  edShow(); toast('Undone');
};
function edSelect(i) {
  if (!S.notes.length) { S.sel = null; edShow(); return; }
  if (!S.multiMode) S.multi = new Set();
  S.sel = Math.max(0, Math.min(S.notes.length - 1, i));
  const n = S.notes[S.sel];
  if (!S.running && (n.t < songTime() - 2.5 || n.t > songTime() + 4)) seek(Math.max(0, n.t - 1)); // bring it into view
  beep(n.p); edShow();
}
let edTimer = null;
function edChanged() {
  S.notes.sort((a, b) => a.t - b.t);
  S.phrases = toPhrases(S.notes);
  S.stats = null; resetStats();
  S.ni = S.ji = lowerBound(songTime());
  S.flags = checkFlags();
  edShow();
  clearTimeout(edTimer);
  const id = S.song.id, notes = S.notes;
  edTimer = setTimeout(async () => {
    const song = await db.getSong(id);
    song.meta = { ...song.meta, notes, phrases: toPhrases(notes), range: noteRange(notes), edited: true, editedAt: Date.now() };
    await db.putSong(song);
    if (S?.song.id === id) S.meta = song.meta;
  }, 400);
}
function edApply(f) {
  const list = selected();
  if (!list.length) { toast('Tap a note first'); return; }
  pushUndo();
  list.forEach(n => f(n));
  const keep = list[0]; edChanged(); S.sel = S.notes.indexOf(keep); edShow();
}
$('#btnEdit').onclick = () => {
  if (!S || S.mode !== 'song') return;
  S.edit = !S.edit;
  $('#editPanel').hidden = !S.edit;
  S.multiMode = false; S.multi = new Set();
  if (S.edit) { if (S.running) pause(); toast('Pause, tap a note, then fix it. Changes save as you go.'); edSelect(lowerBound(songTime())); }
  else S.sel = null;
};
// timeline slider: drag the white line (where the live pitch dot sits) through the song
// (user, 2026-11-23: "slider control of where my live pitch line sits in the timeline")
const fmtTenth = t => `${fmtTime(t)}.${Math.floor((t % 1) * 10)}`;
function edSliderSync() {
  if (!S?.edit || S.scrubbing) return;
  const sl = $('#edSlider'), t = songTime();
  sl.min = S.meta.start || 0; sl.max = S.meta.duration;
  sl.value = t; $('#edTime').textContent = fmtTenth(t);
}
$('#edSlider').oninput = e => {
  if (!S?.edit) return;
  S.scrubbing = true;
  const t = +e.target.value, now = songTime();
  if (t < now) resetStats(lowerBound(t), lowerBound(now) + 1); // scrubbing back: un-judge those notes
  seek(t); $('#edTime').textContent = fmtTenth(t);
};
$('#edSlider').onchange = () => { if (S) S.scrubbing = false; };
$('#edDone').onclick = () => { if (S?.edit) $('#btnEdit').onclick(); toast('Notes saved ✓ (⤓ exports them)'); };
// in "select many": › adds the next note after the selection, ‹ drops the last one
$('#edPrev').onclick = () => {
  if (!S?.edit) return;
  const many = selected();
  if (S.multiMode && many.length > 1) { S.multi.delete(many[many.length - 1]); edShow(); return; }
  edSelect((S.sel ?? 1) - 1);
};
$('#edNext').onclick = () => {
  if (!S?.edit) return;
  const many = selected();
  if (S.multiMode && many.length) {
    const nx = S.notes[S.notes.indexOf(many[many.length - 1]) + 1];
    if (nx) { S.multi.add(nx); beep(nx.p); if (nx.t > songTime() + 4) seek(nx.t - 3); edShow(); }
    return;
  }
  edSelect((S.sel ?? -1) + 1);
};
$('#edUp').onclick = () => edApply(n => { n.p += 1; beep(n.p); });
$('#edDown').onclick = () => edApply(n => { n.p -= 1; beep(n.p); });
// octave shift (user, 2026-11-24: "I need better octave control... The "Hear Notes" option throws
// notes in the wrong octave lots ... Maybe give up/down arrows for octave shifting"). Scoring ignores
// octaves; this sets the octave "Hear notes" plays and where the note is drawn.
function edOctave(k) {
  edApply(n => {
    n.p += 12 * k; beep(n.p);
    S.lo = Math.min(S.lo, n.p - 3); S.hi = Math.max(S.hi, n.p + 3); // keep it on screen
  });
}
$('#edOctUp').onclick = () => edOctave(1);
$('#edOctDown').onclick = () => edOctave(-1);
$('#edLeft').onclick =() => edApply(n => { n.t = +Math.max(0, n.t - 0.05).toFixed(3); });
$('#edRight').onclick = () => edApply(n => { n.t = +(n.t + 0.05).toFixed(3); });
$('#edMine').onclick = () => {
  if (S?.live == null) { toast('Sing the note (music paused), then tap 🎤 again'); return; }
  // several notes: the first goes to your pitch, the rest move by the same step (the tune's shape stays)
  const first = selected()[0];
  if (!first) { toast('Tap a note first'); return; }
  const step = Math.round(placePitch(S.live, first.p)) - first.p;
  edApply(n => { n.p += step; S.lo = Math.min(S.lo, n.p - 2); S.hi = Math.max(S.hi, n.p + 2); });
  beep(first.p);
};
$('#edShort').onclick = () => edApply(n => { n.d = +Math.max(0.1, n.d - 0.05).toFixed(3); });
$('#edLong').onclick = () => edApply(n => { n.d = +(n.d + 0.05).toFixed(3); });
$('#edAdd').onclick = () => {
  if (!S?.edit) return;
  const t = +songTime().toFixed(3), near = S.notes[Math.min(S.notes.length - 1, lowerBound(t))] || S.notes[S.notes.length - 1];
  const base = near?.p ?? Math.round((S.lo + S.hi) / 2);
  const p = S.live != null ? Math.round(placePitch(S.live, base)) : base;
  const n = { t, d: 0.5, p };
  pushUndo(); S.multi = new Set();
  S.notes.push(n); edChanged();
  S.sel = S.notes.indexOf(n); beep(p); edShow();
  toast(`Added ${noteName(p)} at the white line`);
};
$('#edDel').onclick = () => {
  const list = selected();
  if (!list.length) { toast('Tap a note first'); return; }
  pushUndo();
  const at = S.notes.indexOf(list[0]);
  for (const n of list) S.notes.splice(S.notes.indexOf(n), 1);
  S.multi = new Set(); edChanged();
  edSelect(Math.min(at, S.notes.length - 1));
  toast(list.length > 1 ? `${list.length} notes deleted (↶ undo brings them back)` : 'Note deleted');
};
cv.addEventListener('click', e => {
  if (!S?.edit || !S.geo) return;
  const { t, pps, nowX, y, rowH, dpr } = S.geo, r = cv.getBoundingClientRect();
  // map the tap to canvas pixels with the real scale on each axis (they differ if the canvas is stretched)
  const px = (e.clientX - r.left) * (cv.width / r.width), py = (e.clientY - r.top) * (cv.height / r.height), tt = t + (px - nowX) / pps;
  let best = -1, bd = Infinity;
  S.notes.forEach((n, i) => {
    if (tt < n.t - 0.15 || tt > n.t + n.d + 0.15) return;
    const d = Math.abs(py - y(n.p));
    if (d < bd) { bd = d; best = i; }
  });
  if (best < 0 || bd >= Math.max(rowH * 2, 30 * dpr)) return;
  const n = S.notes[best];
  if (e.shiftKey && S.notes[S.sel]) { // PC: everything between the first pick and this one
    const a = Math.min(S.sel, best), b = Math.max(S.sel, best);
    S.multi = new Set(S.notes.slice(a, b + 1)); S.sel = a; beep(n.p); edShow();
  } else if (S.multiMode || e.ctrlKey || e.metaKey) toggleMulti(n);
  else edSelect(best);
});

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
    traceWrite(ts, r?.midi ?? null);
    S.trail.push({ t: ts, m: r?.midi ?? null });
    while (S.trail.length && S.trail[0].t < ts - 4) S.trail.shift();
    S.live = null;
  } else if (!S.starting) {
    // paused: still show the live pitch (helps fixing notes), but never score
    // (user, 2026-11-23: "allow the live pitch marker to show up even if the music is paused" /
    // "only allow scoring to work if music is playing")
    const v = SIM ? simVoice(ts) : readMic();
    S.live = v?.midi ?? null;
  }
  judge(ts);
  melody(t);
  if (S.mode === 'song' && S.running && t >= S.meta.duration) { finishSong(); return; } // trimmed songs end early
  // re-sync guide track only on real drift, at most every 2 s (each seek stutters)
  if (S.running && performance.now() > S.nextSync && Math.abs(S.vocals.currentTime - S.backing.currentTime) > 0.15) {
    S.vocals.currentTime = S.backing.currentTime; S.nextSync = performance.now() + 2000;
  }
  if (S.mode === 'practice') practiceTick(t, ts);
  edSliderSync();
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
// Where a sung pitch is drawn (and where 🎤 / ＋ put a note): always its true pitch, never moved by
// octaves (user, 2026-11-24: "the pitch markers are positionally correct for the notes the
// represent. I don't want to go lower and see my pitch marker jump to the top of the screen" and
// "there should be no out of range voices, thus no shifted octave views. Make the highest and lowest
// notes of the song determine the view"; folding options only if a song's range zooms out too far).
// A voice outside the view sits at the edge with an arrow (edgeDot). Scoring still ignores octaves.
const placePitch = m => m;
const foldCents = (m, p) =>((((m - p) % 12) + 18) % 12 - 6) * 100;

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
    // Quick notes (< QUICK s) are hard to land in fast singing (user, 2026-11-23: "if the pitch
    // level passes through the marker it at least counts toward a minimal score, but no points if
    // it misses the mark entirely"): touching the target earns at least "Good", sliding through it
    // (pitch crosses the line between two frames) at least "Close". Missing it entirely stays 0.
    if (n.d < QUICK) {
      const crossed = st.lastE != null && st.lastE * e < 0 && Math.abs(st.lastE) < 350 && a < 350;
      st.floor = Math.max(st.floor || 0, a <= tol ? 0.6 : crossed ? 0.4 : 0);
      st.lastE = e;
    }
  } else st.lastE = null;
}
const QUICK = 0.4;

function judge(ts) {
  while (S.ji < S.notes.length && S.notes[S.ji].t + S.notes[S.ji].d < ts) {
    const i = S.ji++, st = S.stats[i];
    if (!inLoop(i) || st.judged) continue;
    st.judged = true;
    if (!st.tot) continue;
    const sc = noteScore(st), n = S.notes[i];
    const [text, color] = sc >= 0.8 ? ['Perfect!', '--gold'] : sc >= 0.5 ? ['Good', '--good'] : sc >= 0.3 ? ['Close', '--close'] : ['Miss', '--miss'];
    S.pops.push({ t: n.t + n.d, p: n.p, text, color: css(color), born: performance.now() });
    if (S.mode === 'song') $('#liveScore').textContent = rangeScore(0, S.notes.length, true);
  }
}

function melody(t) {
  if (!melGain) return;
  const listen = S.mode === 'record' && S.rec?.listening;
  const check = S.edit && S.checkSing && S.meta.check?.notes; // 🔔 the check singer sings its own tune
  const list = listen ? S.rec.preview : check || S.notes;
  const on = (listen || check || $('#melodyTog').checked) && S.running && (S.mode !== 'record' || listen);
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
// The stage also changes size when panels open (edit panel, lyrics). Without re-measuring, the
// drawing is stretched and taps land on a note's "ghost" (user, 2026-11-24). Re-measure on any size change.
new ResizeObserver(() => S && resize()).observe(cv);

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
    else if (st.judged && !st.tot) col = '#5a4f8a'; // skipped past / paused over: not sung, not scored
    else if (st.judged) { const sc = noteScore(st); col = sc >= 0.8 ? css('--gold') : sc >= 0.5 ? css('--good') : sc >= 0.3 ? css('--close') : css('--miss'); }
    else if (n.t <= ts && st.tot) {
      const sc = noteScore(st); col = sc >= 0.8 ? css('--gold') : sc >= 0.5 ? css('--good') : css('--bar');
    }
    const bh = Math.max(6 * dpr, rowH * 0.75);
    roundRect(x(n.t), y(n.p) - bh / 2, Math.max(2, n.d * pps - 2 * dpr), bh, bh / 2, col);
  }
  // edit mode: the check singer's tune (dashed, folded to the targets' octave) and ⚠ where it disagrees
  if (S.edit && S.meta.check?.notes) {
    const bh = Math.max(6 * dpr, rowH * 0.75), oct = (p, tt) => { const r = S.notes[Math.min(S.notes.length - 1, lowerBound(tt))]?.p ?? p; return p - 12 * Math.round((p - r) / 12); };
    g.save(); g.strokeStyle = css('--check'); g.lineWidth = 2 * dpr; g.setLineDash([5 * dpr, 4 * dpr]);
    for (const c of S.meta.check.notes) {
      if (c.t > t1 || c.t + c.d < t0) continue;
      g.strokeRect(x(c.t), y(oct(c.p, c.t)) - bh / 2, Math.max(2, c.d * pps - 2 * dpr), bh);
    }
    g.setLineDash([]); g.fillStyle = css('--check'); g.font = `bold ${15 * dpr}px system-ui`; g.textAlign = 'center';
    for (const f of S.flags || []) {
      if (f.t > t1 || f.t < t0 - 3) continue;
      const p = f.i >= 0 ? S.notes[f.i].p : oct(f.c.p, f.t);
      g.fillText('⚠', x(f.t) + 7 * dpr, y(p) - bh / 2 - 9 * dpr);
    }
    g.restore();
  }
  // edit mode: the whole sung trace, folded to the octave of the nearest target note
  if (S.edit && S.trace) {
    const tr = S.trace, b0 = Math.max(0, Math.floor(t0 / TRACE_DT)), b1 = Math.min(tr.length - 1, Math.ceil(t1 / TRACE_DT));
    g.save(); g.globalAlpha = 0.75; g.lineWidth = 3 * dpr; g.strokeStyle = css('--accent'); g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); let pen = false, last = 0;
    for (let k = b0; k <= b1; k++) {
      const m = tr[k];
      if (Number.isNaN(m)) { pen = false; continue; }
      const tt = k * TRACE_DT, ni = Math.min(S.notes.length - 1, lowerBound(tt)), r = S.notes[ni]?.p ?? m;
      const fm = placePitch(m, r), px = x(tt), py = y(fm);
      if (pen && Math.abs(fm - last) < 3) g.lineTo(px, py); else g.moveTo(px, py);
      pen = true; last = fm;
    }
    g.stroke(); g.restore();
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

  // voice trail (true pitch when it fits the view, see placePitch)
  const ref = tt => { const i = S.notes.findIndex((n, k) => k >= S.ni - 2 && n.t + n.d >= tt); const n = S.notes[i >= 0 ? i : S.notes.length - 1]; return n ? n.p : (S.lo + S.hi) / 2; };
  const fold = placePitch;
  // the live dot; a voice above / below the song's range sits at the edge with an arrow pointing out
  const edgeDot = (px, py, rad) => {
    const lo = rad + 2 * dpr, hi = H - rad - 2 * dpr, out = py < lo ? -1 : py > hi ? 1 : 0;
    py = Math.min(hi, Math.max(lo, py));
    g.fillStyle = css('--accent'); g.beginPath(); g.arc(px, py, rad, 0, 7); g.fill();
    if (out) {
      g.fillStyle = '#fff'; g.font = `bold ${12 * dpr}px system-ui`; g.textAlign = 'center';
      g.fillText(out < 0 ? '⇡' : '⇣', px, py + 1 * dpr); g.textAlign = 'start';
    }
    return py;
  };
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
    const r = ref(cur.t), fm = fold(cur.m, r), px = x(cur.t), py = edgeDot(px, y(fm), 7 * dpr);
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
  // paused: live pitch dot on the now line, with its note name
  if (!S.running && S.live != null) {
    const fm = S.live, py = edgeDot(nowX, y(fm), 8 * dpr);
    g.fillStyle = '#fff'; g.font = `bold ${14 * dpr}px system-ui`;
    g.fillText(noteName(Math.round(fm)), nowX + 12 * dpr, py);
  }
  // selected note (edit mode)
  if (S.edit) {
    const bh = Math.max(6 * dpr, rowH * 0.75);
    g.strokeStyle = '#fff'; g.lineWidth = 2 * dpr;
    for (const n of selected()) {
      if (n.t > t1 || n.t + n.d < t0) continue;
      g.strokeRect(x(n.t) - 2 * dpr, y(n.p) - bh / 2 - 2 * dpr, Math.max(2, n.d * pps) + 2 * dpr, bh + 4 * dpr);
    }
  }
  S.geo = { t, pps, nowX, y, rowH, dpr };
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
  song.meta = { ...song.meta, notes, phrases: toPhrases(notes), range: noteRange(notes), edited: true, editedAt: Date.now() };
  await db.putSong(song);
  const sel = S.rec.sel;
  closeSession();
  toast('Melody saved ✓  (use ⤓ to export it)');
  // reopen to check it, with the new notes playing as tones
  openSong(id, sel >= 0 ? { practice: { queue: [Math.min(sel, song.meta.phrases.length - 1)], fromResults: false }, hearNotes: true } : { hearNotes: true });
};

// ---------- trim: skip a slow start and/or end the song early ----------
// (start: user, 2026-11-23: "I would like the option to trim off slow starts from songs as well")
// The audio isn't cut: the song plays from meta.start and stops at meta.duration; notes,
// sections and lyrics outside that stretch are dropped. Times stay song times.
async function trimSong(id) {
  const s = await db.getSong(id), st = s.meta.start || 0;
  const sing = s.meta.notes[0]?.t ?? 0; // first sung note
  const v = prompt(`Trim "${songName(s)}": start - end (m:ss - m:ss).\n` +
    `Singing starts at ${fmtTime(sing)}. To skip a slow start, try ${fmtTime(Math.max(0, sing - 3))} as the start.`,
    `${fmtTime(st)} - ${fmtTime(s.meta.duration)}`);
  if (!v) return;
  const tm = '(\\d+):(\\d{1,2})';
  const m = v.trim().match(new RegExp(`^(?:${tm}\\s*-\\s*)?${tm}$`));
  if (!m) { toast('Use start - end, like 0:12 - 3:18'); return; }
  const start = m[1] != null ? +m[1] * 60 + +m[2] : st, end = +m[3] * 60 + +m[4];
  if (end > s.meta.duration + 0.5 || start < 0 || end - start < 5) { toast('That time is outside the song'); return; }
  if (start < st - 0.5) { toast(`The start can't go back before ${fmtTime(st)} — re-add the song from Drive to undo`); return; }
  const notes = s.meta.notes.filter(n => n.t >= start && n.t < end)
    .map(n => (n.t + n.d > end ? { ...n, d: +(end - n.t).toFixed(3) } : n)).filter(n => n.d >= 0.08);
  if (!notes.length) { toast('No singing left between those times'); return; }
  s.meta = { ...s.meta, editedAt: Date.now(), fullDuration: s.meta.fullDuration ?? s.meta.duration,
    start: start || undefined, duration: Math.min(end, s.meta.duration), notes, phrases: toPhrases(notes),
    range: noteRange(notes), lyrics: (s.meta.lyrics || []).filter(l => l.t == null || (l.t >= start - 1 && l.t < end)) };
  await db.putSong(s);
  toast(`Song now plays ${fmtTime(start)} – ${fmtTime(end)} ✓`);
  renderLibrary();
}

// ---------- export a song pack (e.g. after re-recording the melody) ----------
// ⤓ exports the whole song with its edits, so it counts as saving them (user, 2026-11-24: "that
// save edits yellow flag doesn't give me google drive as an option" / "I've been using the export
// arrow instead"). The exported file says it holds the edits (editsMerged), so another device
// re-adding it replaces its copy without asking, and the ☁️ flag clears here.
async function exportSong(id) {
  const s = await db.getSong(id);
  const u8 = async b => new Uint8Array(await b.arrayBuffer());
  const meta = s.meta.editedAt ? { ...s.meta, editsMerged: s.meta.editedAt } : s.meta;
  const done = async () => {
    if (!s.meta.editedAt) return;
    s.meta.editsSaved = Date.now(); s.meta.editsMerged = s.meta.editedAt;
    await db.putSong(s); renderLibrary();
  };
  const blob = writeZip({
    'song.json': new TextEncoder().encode(JSON.stringify(meta)),
    'backing.mp3': await u8(s.backing),
    'vocals.mp3': await u8(s.vocals),
  });
  const name = `${id}.song`;
  if (window.showSaveFilePicker) { // desktop Chrome/Edge: save straight into the Drive folder
    try {
      const h = await showSaveFilePicker({ suggestedName: name, types: [{ description: 'Pitch Star song', accept: { 'application/zip': ['.song'] } }] });
      const w = await h.createWritable(); await w.write(blob); await w.close();
      await done(); toast('Exported ✓'); return;
    } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast('Exported to Downloads ✓'); // a phone download isn't in Drive yet: the ☁️ flag stays
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
  s.meta = { ...s.meta, editedAt: Date.now(), lyricsTried: true, lyricsCheck: { source: 'manual' }, // picked/typed by the user = checked by the user
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
    S.lyr.push({ t0, words, wt, who: l.who || '', spoken: !!l.spoken });
  });
  S.lyIdx = -2;
}
// Who sings the line (parts read off the video's slides, 2026-11-23). One steady colour per name.
const WHO_COL = ['#5fb4ff', '#4be3a0', '#ff9b5f', '#c99bff', '#ff5fa2', '#ffd23f'];
function whoTag(l) {
  const b = document.createElement('b'); b.className = 'who';
  let h = 0; for (const c of l.who) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  b.style.background = /^all$/i.test(l.who) ? '#8f82b8' : WHO_COL[h % WHO_COL.length];
  b.textContent = l.who + (l.spoken ? ' (spoken)' : '');
  return b;
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
    cur.classList.toggle('spoken', !!S.lyr[i]?.spoken);
    if (i >= 0 && S.lyr[i].who) cur.append(whoTag(S.lyr[i]));
    if (i >= 0) S.lyr[i].words.forEach((w, k) => { const sp = document.createElement('span'); sp.className = 'w'; sp.textContent = w + ' '; cur.append(sp); });
    // the next two lines, same style (user, 2026-11-23: "have lyrics que up at least 3 lines,
    // making the 3rd line the same format as the 2nd")
    for (const [id, k] of [['#lyNext', 1], ['#lyNext2', 2]]) {
      const nx = $(id), n = S.lyr[i + k], prev = S.lyr[i + k - 1]; nx.innerHTML = '';
      if (n?.who && n.who !== prev?.who) nx.append(whoTag(n));
      nx.append(n?.words.join(' ') || '');
    }
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
  seek(S.meta.start || 0);
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
  s.meta = { ...s.meta, editedAt: Date.now(), lyrics: s.meta.lyrics.map((l, i) => ({ ...l, t: times[i] ?? l.t })) };
  await db.putSong(s);
  closeSession(); toast('Lyrics timing saved ✓');
  openSong(id);
}
$('#btnTap').onclick = tapLine;
addEventListener('keydown', e => { if (e.code === 'Space' && S?.mode === 'sync') { e.preventDefault(); tapLine(); } });

// ---------- settings ----------
const dlg = $('#settingsDlg');
let micTestOn = false;
// ---------- keep the song library (user, 2026-11-24, after losing it: "add the permanent storage
// request"). Without it a browser may clear the app's songs when the device runs low on space. ----------
async function keepStorage() {
  if (!navigator.storage?.persist) return null; // browser can't promise it
  try { return (await navigator.storage.persisted()) || (await navigator.storage.persist()); } catch { return false; }
}
async function showStorage() {
  const ok = await keepStorage();
  $('#storeInfo').textContent = ok ? '💾 Songs are kept permanently on this device.'
    : ok === null ? "💾 This browser can't promise to keep the songs: keep the .song files in Drive."
    : '💾 The browser may clear the songs if space runs low. Installing the app (Add to Home Screen) usually lets it keep them.';
}
keepStorage();
$('#btnSettings').onclick = () => {
  showStorage();
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
  navigator.serviceWorker.register('sw.js?v=202611241444', { updateViaCache: 'none' });
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
// Packs checked before the >90% gate (no `coverage` in the record) could miss whole verses
// (Jingle Bells' first verse): treat them the same. Lyrics the user saved (manual) are kept.
// Ship gate raised to 95% (user, 2026-11-23: "lets bump the lyrics accuracy check to >95%"):
// copies that passed only the old 90% gate lose their lyrics too.
const LYRIC_SHIP = 0.95;
function dropUnverified(meta) {
  const c = meta.lyricsCheck;
  if (!meta.lyrics?.length || c?.source === 'manual') return false;
  if (c?.coverage != null && (c.agree <= LYRIC_SHIP || c.coverage <= LYRIC_SHIP)) {
    meta.lyrics = [];
    // stale: the Drive pack may pass now (a human answer can settle a rough part), so offer a re-add
    meta.lyricsCheck = { ...c, source: 'none', stale: true, reason: `below ${LYRIC_SHIP * 100}% certainty; re-add the song from Drive` };
    return true;
  }
  if (c?.coverage != null) return false;
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
