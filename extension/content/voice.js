// StickStack — voice notes for Substack DMs.
//
// Sending: a mic button appears next to the sticker button in message composers. Record, preview,
// then "Attach" turns the recording into a PNG waveform card with the audio hidden inside it
// (see lib/voicecodec.js) and attaches it the same way stickers are attached.
// Receiving: images that turn out to be voice cards get an inline player.
//
// Runs after lib/voicecodec.js and content/substack.js in the same isolated world, and reuses
// substack.js's attach/toast helpers through window.__stickstackSubstack.api.
(() => {
  'use strict';

  // ---------- single instance (survives extension reloads/updates) ----------
  const prev = window.__stickstackVoice;
  if (prev && prev.alive()) return;
  try {
    prev?.destroy?.();
  } catch {}
  document.querySelectorAll('[data-stickstack-voice-host],[data-stickstack-voice-player]').forEach((n) => n.remove());
  document.querySelectorAll('[data-stickstack-voice-img]').forEach(unhide);

  const V = globalThis.StickStackVoice;
  const ss = window.__stickstackSubstack;
  const api = ss?.api;
  if (!V || !api) return;

  let dead = false;
  const alive = () => !dead && ss.alive();
  let settings = { voiceNotes: true, showButton: true };
  const enabled = () => !dead && settings.voiceNotes !== false;

  // For testing on pages we don't recognise as DMs yet:
  //   localStorage.setItem('stickstack:voice:everywhere', '1')   (in the page's DevTools console)
  const DM_PATH = /^\/(messages|inbox|dm|dms|chat)(\/|$)/i;
  function isDmComposer(ed) {
    try {
      if (localStorage.getItem('stickstack:voice:everywhere') === '1') return true;
    } catch {}
    if (DM_PATH.test(location.pathname)) return true;
    const hints = [
      ed.getAttribute('aria-label'),
      ed.getAttribute('placeholder'),
      ed.getAttribute('data-placeholder'),
      ed.querySelector?.('[data-placeholder]')?.getAttribute('data-placeholder'),
      ed.closest('form')?.getAttribute('aria-label'),
    ]
      .filter(Boolean)
      .join(' ');
    return /\bmessage\b/i.test(hints);
  }

  // ---------- UI ----------
  const MIC = `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="currentColor" d="M12 14.5a3.5 3.5 0 0 0 3.5-3.5V5.5a3.5 3.5 0 1 0-7 0V11a3.5 3.5 0 0 0 3.5 3.5Zm6-3.5a1 1 0 1 0-2 0 4 4 0 0 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.91V19H8.5a1 1 0 1 0 0 2h7a1 1 0 1 0 0-2H13v-2.09A6 6 0 0 0 18 11Z"/></svg>`;
  const PLAY = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.2-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6Z"/></svg>`;
  const PAUSE = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>`;

  const THEME = `
  .light{--bg:#fff;--fg:#171a21;--mut:#6b7280;--line:#e1e5ec;--hov:#eef1f6;--acc:#4f63d2;--accfg:#fff;--rest:#c3cad8;--rec:#e5484d;--shadow:0 12px 40px rgba(15,23,42,.18),0 2px 8px rgba(15,23,42,.08)}
  .dark{--bg:#171a20;--fg:#e8ebf0;--mut:#9aa1ad;--line:#2a2f38;--hov:#22262e;--acc:#8b9bf5;--accfg:#0c1020;--rest:#3a4150;--rec:#ff6b6f;--shadow:0 12px 40px rgba(0,0,0,.5),0 2px 8px rgba(0,0,0,.3)}`;

  const STYLE = `
  :host{all:initial}
  *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  ${THEME}
  .mic{position:fixed;width:30px;height:30px;border-radius:50%;border:1px solid var(--line);background:var(--bg);color:var(--acc);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.12);opacity:.72;transition:opacity .15s,transform .15s;padding:0;z-index:3}
  .mic:hover,.mic:focus-visible,.mic.on{opacity:1;transform:scale(1.06)}
  .mic.rec{color:var(--rec);opacity:1}
  .mic:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
  [hidden]{display:none!important}
  .panel{position:fixed;width:312px;max-width:calc(100vw - 16px);background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow);padding:12px;z-index:4;font-size:13px;display:flex;flex-direction:column;gap:10px}
  .row{display:flex;align-items:center;gap:10px;height:40px}
  .dot{width:12px;height:12px;border-radius:50%;background:var(--rec);flex-shrink:0;animation:pulse 1.2s ease-in-out infinite}
  .starting .dot{background:var(--mut)}
  @keyframes pulse{50%{opacity:.35}}
  .play{width:36px;height:36px;border-radius:50%;border:0;background:var(--acc);color:var(--accfg);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;padding:0}
  canvas{flex:1;min-width:0;height:36px;cursor:default}
  .preview canvas{cursor:pointer}
  .time{font-variant-numeric:tabular-nums;color:var(--mut);font-size:12px;min-width:66px;text-align:right}
  .msg{color:var(--mut);font-size:12px;line-height:1.4;min-height:16px}
  .actions{display:flex;gap:6px;justify-content:flex-end}
  .actions button{height:32px;border-radius:8px;padding:0 12px;cursor:pointer;font-size:13px}
  .ghost{border:1px solid var(--line);background:transparent;color:var(--fg)}
  .ghost:hover{background:var(--hov)}
  .main{border:0;background:var(--acc);color:var(--accfg);font-weight:600}
  .main:disabled{opacity:.6;cursor:progress}
  button:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
  @media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}`;

  const hostEl = document.createElement('div');
  hostEl.setAttribute('data-stickstack-voice-host', '');
  hostEl.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483646;';
  const root = hostEl.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${STYLE}</style>
    <div class="wrap light">
      <button class="mic" type="button" hidden aria-label="Record a voice note" title="Voice note">${MIC}</button>
      <div class="panel" hidden role="dialog" aria-label="Voice note">
        <div class="row">
          <span class="dot" aria-hidden="true"></span>
          <button class="play" type="button" aria-label="Play" hidden>${PLAY}</button>
          <canvas aria-hidden="true"></canvas>
          <span class="time">0:00</span>
        </div>
        <div class="msg" aria-live="polite"></div>
        <div class="actions">
          <button class="ghost cancel" type="button">Cancel</button>
          <button class="ghost redo" type="button" hidden>Re-record</button>
          <button class="main stop" type="button">Stop</button>
          <button class="main attach" type="button" hidden>Attach</button>
        </div>
      </div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const wrap = $('.wrap');
  const mic = $('.mic');
  const panel = $('.panel');
  const canvas = $('canvas');
  const timeEl = $('.time');
  const msgEl = $('.msg');
  const playBtn = $('.play');
  const btn = { cancel: $('.cancel'), redo: $('.redo'), stop: $('.stop'), attach: $('.attach') };

  for (const ev of ['keydown', 'keyup', 'keypress', 'input', 'paste', 'copy', 'cut', 'wheel']) panel.addEventListener(ev, (e) => e.stopPropagation());
  for (const ev of ['mousedown', 'pointerdown', 'mouseup', 'pointerup', 'click', 'focusin', 'focusout', 'touchstart']) {
    hostEl.addEventListener(ev, (e) => e.stopPropagation());
  }

  function syncTheme() {
    api.applyTheme();
    const dark = api.isDark();
    wrap.classList.toggle('dark', dark);
    wrap.classList.toggle('light', !dark);
    return dark;
  }
  const cssVar = (el, name) => getComputedStyle(el).getPropertyValue(name).trim();

  // ---------- composer tracking & placement ----------
  let editor = null;
  let micHover = false;

  function mountFor(ed) {
    const dialog = ed?.closest?.('[role="dialog"],[aria-modal="true"],dialog');
    const target = dialog || document.body || document.documentElement;
    if (hostEl.parentNode !== target) target.appendChild(hostEl);
  }

  document.addEventListener(
    'focusin',
    (e) => {
      if (!enabled()) return;
      const ed = api.resolveEditor(e.composedPath?.()[0] || e.target);
      if (!ed || !isDmComposer(ed)) return;
      if (state !== 'idle' && ed !== editor) return; // don't jump while recording
      editor = ed;
      showMic();
    },
    true
  );
  document.addEventListener('focusout', () => setTimeout(maybeHideMic, 250), true);
  mic.addEventListener('mouseenter', () => (micHover = true));
  mic.addEventListener('mouseleave', () => {
    micHover = false;
    setTimeout(maybeHideMic, 400);
  });

  function maybeHideMic() {
    if (dead || !panel.hidden || micHover) return;
    if (editor && api.resolveEditor(api.deepActive()) === editor) return;
    mic.hidden = true;
  }

  function showMic() {
    if (!editor?.isConnected) return;
    mountFor(editor);
    syncTheme();
    mic.hidden = false;
    position();
  }

  let raf = 0;
  const schedulePosition = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      position();
    });
  };
  window.addEventListener('scroll', schedulePosition, { capture: true, passive: true });
  window.addEventListener('resize', schedulePosition, { passive: true });

  function position() {
    if (!editor) return;
    if (!editor.isConnected) {
      if (state === 'idle') {
        mic.hidden = true;
        closePanel();
        editor = null;
      }
      return;
    }
    const o = hostEl.getBoundingClientRect();
    const r = editor.getBoundingClientRect();
    const vw = innerWidth;
    const vh = innerHeight;
    const size = 30;
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) {
      mic.style.visibility = 'hidden';
    } else {
      mic.style.visibility = '';
      // Just left of the sticker button (top-right corner of the composer).
      const gap = settings.showButton !== false ? size + 6 : 0;
      let x = Math.min(r.right, vw) - size - 4 - gap;
      let y = Math.max(r.top, 0) + 4;
      if (r.height < size + 8) y = r.top + (r.height - size) / 2;
      x = Math.max(4, Math.min(vw - size - 4, x));
      y = Math.max(4, Math.min(vh - size - 4, y));
      mic.style.left = `${x - o.left}px`;
      mic.style.top = `${y - o.top}px`;
    }
    if (!panel.hidden) positionPanel();
  }

  function positionPanel() {
    const o = hostEl.getBoundingClientRect();
    const a = mic.style.visibility === 'hidden' ? editor.getBoundingClientRect() : mic.getBoundingClientRect();
    const pw = Math.min(312, innerWidth - 16);
    const ph = panel.offsetHeight || 130;
    let x = a.right - pw;
    let y = a.bottom + 6;
    if (y + ph > innerHeight - 8) y = a.top - ph - 6;
    y = Math.max(8, y);
    x = Math.max(8, Math.min(innerWidth - pw - 8, x));
    panel.style.left = `${x - o.left}px`;
    panel.style.top = `${y - o.top}px`;
  }

  // ---------- recording ----------
  // idle → starting → recording → stopping → preview → attaching → idle
  let state = 'idle';
  let stream = null;
  let recorder = null;
  let audioCtx = null;
  let analyser = null;
  let sampleBuf = null;
  let chunks = [];
  let levels = [];
  let t0 = 0;
  let tick = 0;
  let take = null; // { blob, mime, durationMs, levels }
  let previewAudio = null;
  let previewUrl = '';
  let previewRaf = 0;

  function setState(s) {
    state = s;
    panel.classList.toggle('starting', s === 'starting');
    panel.classList.toggle('preview', s === 'preview' || s === 'attaching');
    const rec = s === 'starting' || s === 'recording' || s === 'stopping';
    $('.dot').hidden = !rec;
    playBtn.hidden = rec;
    btn.stop.hidden = !rec;
    btn.stop.disabled = s !== 'recording';
    btn.redo.hidden = rec;
    btn.attach.hidden = rec;
    btn.attach.disabled = s === 'attaching';
    btn.attach.textContent = s === 'attaching' ? 'Attaching…' : 'Attach';
    mic.classList.toggle('rec', s === 'recording');
    mic.classList.toggle('on', !panel.hidden);
    if (s === 'starting') msgEl.textContent = 'Waiting for the microphone…';
    else if (s === 'recording') msgEl.textContent = `Recording · up to ${V.formatDuration(V.MAX_MS)}`;
    else if (s === 'preview') msgEl.textContent = 'Listen back, then attach it to your message.';
  }

  function openPanel() {
    if (!editor?.isConnected) return;
    syncTheme();
    panel.hidden = false;
    mic.classList.add('on');
    positionPanel();
  }

  function closePanel() {
    panel.hidden = true;
    mic.classList.remove('on');
    if (editor?.isConnected) editor.focus({ preventScroll: true });
  }

  mic.addEventListener('mousedown', (e) => e.preventDefault()); // keep the composer's caret
  mic.addEventListener('click', () => {
    if (state === 'recording') return stopRecording();
    if (!panel.hidden) return state === 'idle' ? closePanel() : undefined;
    openPanel();
    startRecording();
  });
  btn.stop.addEventListener('click', () => stopRecording());
  btn.cancel.addEventListener('click', () => cancel());
  btn.redo.addEventListener('click', () => startRecording());
  btn.attach.addEventListener('click', () => attach());
  playBtn.addEventListener('click', () => togglePreview());
  canvas.addEventListener('click', (e) => {
    if (state !== 'preview' || !take) return;
    const r = canvas.getBoundingClientRect();
    seekPreview((e.clientX - r.left) / r.width);
  });
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  });

  function pickMime() {
    if (typeof MediaRecorder === 'undefined') return null;
    for (const m of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm']) {
      try {
        if (MediaRecorder.isTypeSupported(m)) return m;
      } catch {}
    }
    return '';
  }

  function micError(e) {
    const n = e?.name || '';
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'Microphone access is blocked. Allow it for this site (the icon at the left of the address bar), then try again.';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No microphone was found.';
    if (n === 'NotReadableError') return 'Your microphone is being used by another app.';
    return `Couldn’t start the microphone: ${e?.message || e}`;
  }

  async function startRecording() {
    if (state !== 'idle' && state !== 'preview') return;
    discardTake();
    setState('starting');
    drawLive();
    timeEl.textContent = '0:00';
    const mime = pickMime();
    if (mime === null || !navigator.mediaDevices?.getUserMedia) {
      setState('idle');
      closePanel();
      api.toast('This browser can’t record audio here.', 'err');
      return;
    }
    let s;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch (e) {
      setState('idle');
      closePanel();
      api.toast(micError(e), 'err');
      return;
    }
    if (state !== 'starting' || dead) {
      s.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = s;
    try {
      recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 16000 });
    } catch {
      recorder = new MediaRecorder(stream);
    }
    chunks = [];
    levels = [];
    recorder.ondataavailable = (e) => {
      if (e.data?.size) chunks.push(e.data);
    };
    try {
      audioCtx = new AudioContext();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      sampleBuf = new Float32Array(analyser.fftSize);
    } catch {
      analyser = null; // no live waveform, recording still works
    }
    t0 = performance.now();
    recorder.start(1000);
    setState('recording');
    tick = setInterval(sample, 50);
  }

  function sample() {
    if (state !== 'recording') return;
    let rms = 0;
    if (analyser) {
      analyser.getFloatTimeDomainData(sampleBuf);
      let sum = 0;
      for (let i = 0; i < sampleBuf.length; i++) sum += sampleBuf[i] * sampleBuf[i];
      rms = Math.sqrt(sum / sampleBuf.length);
    }
    levels.push(rms);
    const ms = performance.now() - t0;
    timeEl.textContent = `${V.formatDuration(ms)} / ${V.formatDuration(V.MAX_MS)}`;
    drawLive();
    if (ms >= V.MAX_MS) stopRecording();
  }

  function releaseMic() {
    clearInterval(tick);
    tick = 0;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    audioCtx?.close().catch(() => {});
    audioCtx = null;
    analyser = null;
  }

  async function stopRecording() {
    if (state !== 'recording') return;
    setState('stopping');
    const durationMs = Math.min(V.MAX_MS, performance.now() - t0);
    const r = recorder;
    await new Promise((res) => {
      r.onstop = res;
      try {
        r.stop();
      } catch {
        res();
      }
    });
    releaseMic();
    if (state !== 'stopping') return; // cancelled meanwhile
    const mime = (r.mimeType || 'audio/webm').replace(/\s+/g, '');
    const blob = new Blob(chunks, { type: mime });
    chunks = [];
    if (durationMs < 800 || !blob.size) {
      setState('idle');
      closePanel();
      api.toast('That was too short. Click the mic and talk for a bit longer.');
      return;
    }
    take = { blob, mime, durationMs, levels: levels.slice() };
    setState('preview');
    timeEl.textContent = V.formatDuration(durationMs);
    drawPreview(0);
    positionPanel();
    btn.attach.focus({ preventScroll: true });
  }

  function cancel() {
    if (state === 'attaching') return;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {}
    }
    releaseMic();
    chunks = [];
    discardTake();
    setState('idle');
    closePanel();
  }

  function discardTake() {
    cancelAnimationFrame(previewRaf);
    previewAudio?.pause();
    previewAudio = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    take = null;
    playBtn.innerHTML = PLAY;
    playBtn.setAttribute('aria-label', 'Play');
  }

  // ---------- panel waveform & preview playback ----------
  function sizeCanvas(c) {
    const r = c.getBoundingClientRect();
    const dpr = Math.min(3, devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    return c.getContext('2d');
  }

  function drawLive() {
    const ctx = sizeCanvas(canvas);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const n = 40;
    const recent = levels.slice(-n);
    const peaks = new Array(n - recent.length).fill(0).concat(recent.map((v) => Math.round(Math.sqrt(Math.min(1, v / 0.25)) * 255)));
    V.drawWave(ctx, peaks, 0, 0, canvas.width, canvas.height, 1, cssVar(wrap, '--rec'), cssVar(wrap, '--rest'));
  }

  function drawPreview(progress) {
    if (!take) return;
    const ctx = sizeCanvas(canvas);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    V.drawWave(ctx, V.downsample(take.levels, 40), 0, 0, canvas.width, canvas.height, progress, cssVar(wrap, '--acc'), cssVar(wrap, '--rest'));
  }

  function previewEl() {
    if (!previewAudio && take) {
      previewUrl = URL.createObjectURL(take.blob);
      previewAudio = new Audio(previewUrl);
      previewAudio.addEventListener('ended', () => {
        playBtn.innerHTML = PLAY;
        playBtn.setAttribute('aria-label', 'Play');
        cancelAnimationFrame(previewRaf);
        drawPreview(0);
        timeEl.textContent = V.formatDuration(take?.durationMs);
      });
    }
    return previewAudio;
  }

  function previewLoop() {
    if (!previewAudio || !take) return;
    const p = Math.min(1, (previewAudio.currentTime * 1000) / take.durationMs);
    drawPreview(p);
    timeEl.textContent = `${V.formatDuration(previewAudio.currentTime * 1000)} / ${V.formatDuration(take.durationMs)}`;
    if (!previewAudio.paused) previewRaf = requestAnimationFrame(previewLoop);
  }

  function togglePreview() {
    const a = previewEl();
    if (!a) return;
    if (a.paused) {
      a.play().then(
        () => {
          playBtn.innerHTML = PAUSE;
          playBtn.setAttribute('aria-label', 'Pause');
          previewLoop();
        },
        () => {}
      );
    } else {
      a.pause();
      playBtn.innerHTML = PLAY;
      playBtn.setAttribute('aria-label', 'Play');
    }
  }

  function seekPreview(frac) {
    const a = previewEl();
    if (!a || !take) return;
    try {
      a.currentTime = Math.max(0, Math.min(1, frac)) * (take.durationMs / 1000);
    } catch {}
    previewLoop();
  }

  // ---------- packaging & attaching ----------
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');

  async function buildFile(t) {
    const peaks = V.downsample(t.levels, V.BARS);
    const c = document.createElement('canvas');
    c.width = V.CARD.w;
    c.height = V.CARD.h;
    V.drawCard(c.getContext('2d'), { peaks, durationMs: t.durationMs });
    const pngBlob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Couldn’t draw the voice note'))), 'image/png'));
    const png = new Uint8Array(await pngBlob.arrayBuffer());
    const audio = new Uint8Array(await t.blob.arrayBuffer());
    const bytes = V.embedVoice(png, { mime: t.mime, durationMs: t.durationMs, peaks }, audio);
    if (!V.extractVoice(bytes)) throw new Error('Couldn’t package the voice note');
    return new File([bytes], `voice-note-${stamp()}.png`, { type: 'image/png' });
  }

  async function attach() {
    if (state !== 'preview' || !take) return;
    if (!editor?.isConnected) {
      api.toast('Click into the message box, then press Attach again.', 'err');
      return;
    }
    previewAudio?.pause();
    setState('attaching');
    let file;
    try {
      file = await buildFile(take);
    } catch (e) {
      setState('preview');
      api.toast(e?.message || String(e), 'err');
      return;
    }
    let r = { ok: false };
    try {
      r = await api.insert(editor, file);
    } catch {}
    if (state !== 'attaching') return;
    if (r.ok) {
      discardTake();
      setState('idle');
      closePanel();
      api.toast('Voice note attached. Press Send to share it.');
    } else {
      setState('preview');
      // Not the clipboard: Chrome re-encodes clipboard images, which would drop the audio.
      api.toast('The message box didn’t accept the voice note. Download it and drag the file into the box.', 'err', { label: 'Download', run: () => download(file) });
    }
  }

  function download(file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.style.display = 'none';
    root.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ---------- receiving: inline players ----------
  const CANDIDATE = /substackcdn\.com\/image\/fetch\/|substack-post-media\.s3\.amazonaws\.com\//;
  const checked = new WeakMap(); // img → src already looked at
  const waiting = new WeakSet(); // imgs with a pending load listener
  const players = new Map(); // img → { host, anchor, src, stop }
  const voiceCache = new Map(); // original url → Promise<voice|null>
  let current = null; // the player that is playing

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function loadVoice(url) {
    if (!voiceCache.has(url)) {
      if (voiceCache.size > 300) voiceCache.delete(voiceCache.keys().next().value);
      voiceCache.set(
        url,
        api
          .send({ type: 'voice:fetch', url })
          .then((r) => (r.voice ? { ...r.voice, audio: b64ToBytes(r.voice.audio) } : null))
          .catch(() => null)
      );
    }
    return voiceCache.get(url);
  }

  function consider(img) {
    if (!enabled() || !img.isConnected || hostEl.contains(img)) return;
    const src = img.currentSrc || img.src || '';
    if (checked.get(img) === src) return;
    if (!CANDIDATE.test(src)) {
      checked.set(img, src);
      return;
    }
    const url = V.originalImageUrl(src);
    if (!url) {
      checked.set(img, src);
      return;
    }
    // Substack names uploads "<id>_<w>x<h>.<ext>", which saves waiting for the image to load.
    const named = /_(\d+)x(\d+)\.(\w+)$/i.exec(new URL(url).pathname);
    if (named) {
      checked.set(img, src);
      if (named[3].toLowerCase() !== 'png' || !V.looksLikeCard(+named[1], +named[2])) return;
    } else {
      if (!img.complete || !img.naturalWidth) {
        if (!waiting.has(img)) {
          waiting.add(img);
          img.addEventListener('load', () => (waiting.delete(img), consider(img)), { once: true });
        }
        return;
      }
      checked.set(img, src);
      if (!V.looksLikeCard(img.naturalWidth, img.naturalHeight)) return;
    }
    loadVoice(url).then((v) => {
      if (v && !dead && img.isConnected && (img.currentSrc || img.src) === src && !players.has(img)) mountPlayer(img, v, src);
    });
  }

  const PLAYER_STYLE = `
  :host{all:initial;display:block}
  *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  ${THEME}
  .p{display:flex;align-items:center;gap:10px;width:320px;max-width:100%;height:56px;padding:0 12px 0 10px;border-radius:28px;background:var(--hov);border:1px solid var(--line);color:var(--fg)}
  .pp{width:36px;height:36px;border-radius:50%;border:0;background:var(--acc);color:var(--accfg);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;padding:0}
  canvas{flex:1;min-width:0;height:30px;cursor:pointer}
  .t{font-variant-numeric:tabular-nums;font-size:12px;color:var(--mut);min-width:34px;text-align:right}
  .sp{border:1px solid var(--line);background:var(--bg);color:var(--fg);font-size:11px;font-weight:600;border-radius:999px;height:22px;min-width:36px;padding:0 6px;cursor:pointer}
  button:focus-visible{outline:2px solid var(--acc);outline-offset:2px}`;
  const SPEEDS = [1, 1.5, 2];

  function mountPlayer(img, v, src) {
    const anchor = img.parentElement?.tagName === 'PICTURE' ? img.parentElement : img;
    const host = document.createElement('span');
    host.setAttribute('data-stickstack-voice-player', '');
    host.style.cssText = 'all:initial;display:block;max-width:100%;margin:2px 0;';
    const sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML = `<style>${PLAYER_STYLE}</style>
      <div class="p ${syncTheme() ? 'dark' : 'light'}" title="Voice note (StickStack)">
        <button class="pp" type="button" aria-label="Play voice note">${PLAY}</button>
        <canvas aria-label="Seek"></canvas>
        <span class="t">${V.formatDuration(v.durationMs)}</span>
        <button class="sp" type="button" aria-label="Playback speed">1×</button>
      </div>`;
    // Keep Substack's own handlers (e.g. "open image" lightboxes, links) away from the player.
    for (const ev of ['click', 'mousedown', 'pointerdown', 'mouseup', 'pointerup', 'touchstart', 'keydown']) {
      host.addEventListener(ev, (e) => {
        e.stopPropagation();
        if (ev === 'click') e.preventDefault();
      });
    }
    const box = sr.querySelector('.p');
    const pp = sr.querySelector('.pp');
    const cv = sr.querySelector('canvas');
    const t = sr.querySelector('.t');
    const sp = sr.querySelector('.sp');
    let audio = null;
    let url = '';
    let speed = 0;
    let frame = 0;

    const draw = (p) => {
      const ctx = sizeCanvas(cv);
      ctx.clearRect(0, 0, cv.width, cv.height);
      V.drawWave(ctx, v.peaks, 0, 0, cv.width, cv.height, p, cssVar(box, '--acc'), cssVar(box, '--rest'));
    };
    const progress = () => (audio ? Math.min(1, (audio.currentTime * 1000) / v.durationMs) : 0);
    const loop = () => {
      draw(progress());
      t.textContent = V.formatDuration(audio && audio.currentTime > 0 ? audio.currentTime * 1000 : v.durationMs);
      if (audio && !audio.paused) frame = requestAnimationFrame(loop);
    };
    const setIcon = (playing) => {
      pp.innerHTML = playing ? PAUSE : PLAY;
      pp.setAttribute('aria-label', playing ? 'Pause voice note' : 'Play voice note');
    };
    const ensure = () => {
      if (audio) return audio;
      url = URL.createObjectURL(new Blob([v.audio], { type: v.mime }));
      audio = new Audio(url);
      audio.playbackRate = SPEEDS[speed];
      audio.addEventListener('pause', () => setIcon(false));
      audio.addEventListener('play', () => setIcon(true));
      audio.addEventListener('ended', () => {
        cancelAnimationFrame(frame);
        audio.currentTime = 0;
        loop();
      });
      return audio;
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      audio?.pause();
      if (url) URL.revokeObjectURL(url);
      audio = null;
      url = '';
    };
    const ctl = { host, anchor, src, stop, pause: () => audio?.pause() };

    pp.addEventListener('click', () => {
      const a = ensure();
      if (a.paused) {
        if (current && current !== ctl) current.pause();
        current = ctl;
        a.play().then(loop, () => api.toast('This voice note couldn’t be played.', 'err'));
      } else a.pause();
    });
    cv.addEventListener('click', (e) => {
      const a = ensure();
      const r = cv.getBoundingClientRect();
      try {
        a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (v.durationMs / 1000);
      } catch {}
      loop();
    });
    sp.addEventListener('click', () => {
      speed = (speed + 1) % SPEEDS.length;
      sp.textContent = `${SPEEDS[speed]}×`;
      if (audio) audio.playbackRate = SPEEDS[speed];
    });

    anchor.after(host);
    anchor.setAttribute('data-stickstack-voice-img', '');
    anchor.style.setProperty('display', 'none', 'important');
    players.set(img, ctl);
    requestAnimationFrame(() => draw(0));
  }

  function unhide(el) {
    el.style.removeProperty('display');
    el.removeAttribute('data-stickstack-voice-img');
  }

  function unmount(img) {
    const p = players.get(img);
    if (!p) return;
    p.stop();
    p.host.remove();
    if (p.anchor.isConnected) unhide(p.anchor);
    if (current === p) current = null;
    players.delete(img);
  }

  // ---------- page observation ----------
  let pending = new Set();
  let flushScheduled = false;
  function queue(img) {
    pending.add(img);
    if (flushScheduled) return;
    flushScheduled = true;
    setTimeout(() => {
      flushScheduled = false;
      const batch = pending;
      pending = new Set();
      for (const img of batch) consider(img);
    }, 150);
  }

  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.tagName === 'IMG') queue(node);
    else if (node.firstElementChild) node.querySelectorAll('img').forEach(queue);
  }

  const mo = new MutationObserver((muts) => {
    if (!enabled()) return;
    for (const m of muts) {
      if (m.type === 'attributes') {
        const img = m.target;
        if (players.has(img) && players.get(img).src !== (img.currentSrc || img.src)) unmount(img);
        queue(img);
      } else for (const n of m.addedNodes) scan(n);
    }
    for (const img of players.keys()) if (!img.isConnected) unmount(img);
    // New messages push the composer around without scrolling or resizing it.
    if (editor && (!mic.hidden || !editor.isConnected)) schedulePosition();
  });

  function start() {
    if (!document.body) return;
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset'] });
    scan(document.body);
  }
  start();

  // ---------- settings & lifecycle ----------
  api
    .send({ type: 'settings:get' })
    .then((r) => (settings = r.settings || settings))
    .catch(() => {});
  try {
    chrome.storage?.onChanged?.addListener((changes) => {
      if (!changes.settings?.newValue) return;
      settings = changes.settings.newValue;
      if (settings.voiceNotes === false) {
        if (state !== 'idle') cancel();
        mic.hidden = true;
        for (const img of [...players.keys()]) unmount(img);
      } else {
        scan(document.body);
        position();
      }
    });
  } catch {}

  const heartbeat = setInterval(() => {
    if (!ss.alive()) destroy();
  }, 10000);

  function destroy() {
    if (dead) return;
    try {
      cancel();
    } catch {}
    dead = true;
    clearInterval(heartbeat);
    mo.disconnect();
    for (const img of [...players.keys()]) unmount(img);
    hostEl.remove();
  }

  window.__stickstackVoice = { alive, destroy, _test: { isDmComposer, consider, players } };
})();
