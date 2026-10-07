import { Renderer } from './gl.js';
import { Vision } from './vision.js';
import { PAGES, NORMAL, findEffect, pageOf } from './effects.js';
import { ICONS } from './icons.js';
import * as sound from './sound.js';

const api = window.booth;
const $ = (sel) => document.querySelector(sel);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = encodeURIComponent;

const els = {
  stage: $('#stage'),
  canvas: $('#preview'),
  grid: $('#grid'),
  viewerImg: $('#viewer-img'),
  viewerVideo: $('#viewer-video'),
  noCamera: $('#no-camera'),
  message: $('#message'),
  modes: $('#modes'),
  btnLive: $('#btn-live'),
  shutter: $('#shutter'),
  countdown: $('#countdown'),
  recTime: $('#rec-time'),
  fxGroup: $('#fx-group'),
  fxPrev: $('#fx-prev'),
  fxNext: $('#fx-next'),
  btnEffects: $('#btn-effects'),
  dots: $('#dots'),
  btnShare: $('#btn-share'),
  strip: $('#strip'),
  stripInner: $('#strip-inner'),
  flash: $('#flash'),
  about: $('#about'),
};

const state = {
  settings: {},
  mode: 'photo',
  effect: NORMAL,
  gridOpen: false,
  page: 0,
  items: [],
  selected: null,
  viewing: false,
  busy: false,
  recorder: null,
  cameraReady: false,
  cameras: [],
  cameraId: null,
  fullscreen: false,
  bgTextures: {}, // slot → { tex, aspect }
  backdrops: {}, // slot → file name
  introUntil: 0,
  introToken: 0,
};

let renderer, vision, video, stream;

// ---------------------------------------------------------------------------
// Helpers

const libUrl = (item) => `app://library/${enc(item.name)}?v=${item.version}`;
const thumbUrl = (item) => (item.thumb ? `app://thumbs/${enc(item.thumb)}?v=${item.version}` : libUrl(item));
const bgFor = (effect) => (effect.kind === 'user' ? state.bgTextures[effect.slot] || null : null);
const now = () => performance.now() / 1000;

function toBuffer(canvas, type = 'image/jpeg', quality = 0.92) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? b.arrayBuffer().then(resolve, reject) : reject(new Error('Encoding failed'))), type, quality));
}

function makeThumb(source, w = source.videoWidth || source.width, h = source.videoHeight || source.height) {
  const c = document.createElement('canvas');
  c.height = 160;
  c.width = Math.round((160 * w) / h);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return toBuffer(c, 'image/jpeg', 0.8);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

let messageTimer;
function showMessage(text, ms = 2200) {
  clearTimeout(messageTimer);
  els.message.textContent = text;
  els.message.hidden = false;
  if (ms) messageTimer = setTimeout(() => { els.message.hidden = true; }, ms);
}
function hideMessage() {
  clearTimeout(messageTimer);
  els.message.hidden = true;
}

function injectIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) el.innerHTML = ICONS[el.dataset.icon] || '';
}

// ---------------------------------------------------------------------------
// Camera

let cameraRetry;

async function startCamera(deviceId, attempt = 0) {
  clearTimeout(cameraRetry);
  stopCamera();
  const constraints = {
    audio: false,
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  };
  if (deviceId) constraints.video.deviceId = { exact: deviceId };
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    if (deviceId) return startCamera(null, attempt);
    console.error('Camera unavailable', err);
    setCameraReady(false);
    await refreshCameras();
    // The camera may still be held by an app that is just closing; keep trying.
    if (state.cameras.length && attempt < 10) {
      cameraRetry = setTimeout(() => startCamera(state.settings.cameraId, attempt + 1), 1500);
    }
    return;
  }
  const track = stream.getVideoTracks()[0];
  state.cameraId = track.getSettings().deviceId || null;
  track.addEventListener('ended', () => setCameraReady(false));
  video.srcObject = stream;
  await video.play().catch(() => {});
  if (!video.videoWidth) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
  renderer.setSize(video.videoWidth, video.videoHeight);
  setCameraReady(true);
  await refreshCameras();
}

function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

function setCameraReady(ready) {
  state.cameraReady = ready;
  els.noCamera.hidden = ready || state.viewing;
  els.canvas.style.visibility = ready ? '' : 'hidden';
  if (!ready) closeGrid();
  layout();
  updateToolbar();
}

async function refreshCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  state.cameras = devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}

async function onDeviceChange() {
  await refreshCameras();
  if (!state.cameraReady && state.cameras.length) startCamera(state.settings.cameraId);
}

// ---------------------------------------------------------------------------
// Rendering

function visionNeeds() {
  const shown = state.gridOpen ? PAGES[state.page] : [state.effect];
  return {
    face: shown.some((e) => e.kind === 'face'),
    mask: shown.some((e) => e.kind === 'backdrop' || (e.kind === 'user' && state.bgTextures[e.slot])),
  };
}

let lastVideoTime = -1;
let lastMaskVersion = -1;

function frame() {
  requestAnimationFrame(frame);
  if (!state.cameraReady || (state.viewing && !state.recorder)) return;
  if (video.readyState < 2) return;

  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    renderer.uploadVideo(video);
    const need = visionNeeds();
    vision.wantMask = need.mask;
    if (need.face || need.mask) vision.process(video, need);
    if (!need.face) vision.face = null;
    if (vision.maskVersion !== lastMaskVersion && vision.mask) {
      lastMaskVersion = vision.maskVersion;
      renderer.uploadMask(vision.mask, vision.maskW, vision.maskH);
    }
    renderer.hasMask = need.mask && vision.hasMask;
    if (renderer.hasMask) renderer.refineMask();
    renderer.face = need.face ? vision.face : null;
  }

  const opts = { mirror: true, time: now() };
  if (state.gridOpen) {
    renderer.renderGrid(PAGES[state.page].map((effect) => ({ effect, bg: bgFor(effect) })), opts);
  } else {
    const effect = currentEffect();
    renderer.render(effect, { ...opts, bg: bgFor(effect) });
  }
}

function currentEffect() {
  return performance.now() < state.introUntil ? NORMAL : state.effect;
}

function layout() {
  const r = els.stage.getBoundingClientRect();
  const ar = els.canvas.width / els.canvas.height || 16 / 9;
  let w = r.width, h = w / ar;
  if (h > r.height) { h = r.height; w = h * ar; }
  const box = { left: `${(r.width - w) / 2}px`, top: `${(r.height - h) / 2}px`, width: `${w}px`, height: `${h}px` };
  Object.assign(els.canvas.style, box);
  Object.assign(els.grid.style, box);
}

// ---------------------------------------------------------------------------
// Effects grid

function buildGrid() {
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.index = i;
    cell.innerHTML = `<div class="drop" hidden>Drag a backdrop here</div><span class="label"></span><kbd class="key">${i + 1}</kbd>`;
    cell.addEventListener('click', () => selectEffect(PAGES[state.page][i]));
    cell.addEventListener('dragover', (e) => {
      const fx = PAGES[state.page][i];
      if (fx.kind !== 'user' || !e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      cell.classList.add('dragover');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('dragover'));
    cell.addEventListener('drop', (e) => {
      cell.classList.remove('dragover');
      const fx = PAGES[state.page][i];
      if (fx.kind !== 'user') return;
      e.preventDefault();
      e.stopPropagation();
      const file = e.dataTransfer.files[0];
      if (file) setBackdrop(fx.slot, api.pathForFile(file));
    });
    els.grid.append(cell);
  }
  for (let i = 0; i < PAGES.length; i++) els.dots.append(document.createElement('i'));
}

function updateGrid() {
  const page = PAGES[state.page];
  [...els.grid.children].forEach((cell, i) => {
    const fx = page[i];
    const emptyUser = fx.kind === 'user' && !state.bgTextures[fx.slot];
    cell.querySelector('.label').textContent = fx.name;
    cell.querySelector('.drop').hidden = !emptyUser;
    cell.classList.toggle('selected', fx.id === state.effect.id);
  });
  [...els.dots.children].forEach((d, i) => d.classList.toggle('on', i === state.page));
}

function openGrid() {
  if (!state.cameraReady || state.busy || state.recorder) return;
  if (state.viewing) goLive();
  state.gridOpen = true;
  const p = pageOf(state.effect);
  if (p >= 0) state.page = p;
  updateGrid();
  els.grid.hidden = false;
  hideMessage();
  updateToolbar();
}

function closeGrid() {
  if (!state.gridOpen) return;
  state.gridOpen = false;
  els.grid.hidden = true;
  updateToolbar();
}

function toggleGrid() {
  state.gridOpen ? closeGrid() : openGrid();
}

function changePage(delta) {
  if (!state.gridOpen) return;
  state.page = (state.page + delta + PAGES.length) % PAGES.length;
  updateGrid();
}

function selectEffect(fx) {
  if (fx.kind === 'user' && !state.bgTextures[fx.slot]) return;
  state.effect = fx;
  closeGrid();
  const token = ++state.introToken;
  if (fx.kind === 'backdrop' || fx.kind === 'user') {
    // Same flow as the original: ask the user to step aside while the backdrop is set up.
    state.introUntil = performance.now() + 2600;
    showMessage('Please step out of the frame…', 0);
    setTimeout(() => {
      if (token !== state.introToken) return;
      showMessage('Background detected', 1100);
    }, 2600);
  } else {
    state.introUntil = 0;
    hideMessage();
  }
  updateToolbar();
}

// Arrows next to the Effects button: flip pages, or step through effects.
function stepEffect(delta) {
  if (state.gridOpen) return changePage(delta);
  const list = [NORMAL];
  for (const page of PAGES) {
    for (const fx of page) {
      if (fx.id === 'normal') continue;
      if (fx.kind === 'user' && !state.bgTextures[fx.slot]) continue;
      list.push(fx);
    }
  }
  const i = Math.max(0, list.findIndex((fx) => fx.id === state.effect.id));
  selectEffect(list[(i + delta + list.length) % list.length]);
}

// ---------------------------------------------------------------------------
// User backdrops

async function loadBackdrop(slot, name) {
  try {
    const tex = await renderer.loadTexture(`app://backdrops/${enc(name)}`);
    renderer.deleteTexture(state.bgTextures[slot]);
    state.bgTextures[slot] = tex;
  } catch (err) {
    console.error(err);
  }
}

async function setBackdrop(slot, file) {
  try {
    const name = await api.setBackdrop(slot, file);
    state.backdrops[slot] = name;
    await loadBackdrop(slot, name);
    updateGrid();
  } catch (err) {
    showMessage('That file can’t be used as a backdrop.');
  }
}

async function clearBackdrop(slot) {
  await api.clearBackdrop(slot);
  delete state.backdrops[slot];
  renderer.deleteTexture(state.bgTextures[slot]);
  delete state.bgTextures[slot];
  if (state.effect.kind === 'user' && state.effect.slot === slot) state.effect = NORMAL;
  updateGrid();
}

// ---------------------------------------------------------------------------
// Toolbar

function updateToolbar() {
  const { viewing, busy, recorder, cameraReady, gridOpen } = state;
  const counting = !els.countdown.hidden;

  els.modes.hidden = viewing;
  els.btnLive.hidden = !viewing;
  els.shutter.hidden = viewing || counting;
  els.fxGroup.hidden = viewing;
  els.btnShare.hidden = !viewing;

  for (const b of els.modes.children) {
    b.classList.toggle('active', b.dataset.mode === state.mode);
    b.disabled = busy || !!recorder;
    b.setAttribute('aria-checked', b.dataset.mode === state.mode);
  }
  els.shutter.dataset.mode = state.mode;
  els.shutter.disabled = !cameraReady || (busy && !recorder);
  els.shutter.title = recorder ? 'Stop Recording' : state.mode === 'video' ? 'Record Video' : 'Take Photo';

  const fxDisabled = !cameraReady || busy || !!recorder;
  els.btnEffects.disabled = fxDisabled;
  els.fxPrev.disabled = fxDisabled;
  els.fxNext.disabled = fxDisabled;
  els.btnEffects.classList.toggle('active', gridOpen);
  els.fxGroup.classList.toggle('open', gridOpen);
}

function setMode(mode) {
  if (state.busy || state.recorder) return;
  state.mode = mode;
  api.setSettings({ mode });
  updateToolbar();
}

// ---------------------------------------------------------------------------
// Capture

function setLit(index) {
  [...els.countdown.children].forEach((s, i) => s.classList.toggle('lit', i === index));
}

async function countdown() {
  els.countdown.hidden = false;
  updateToolbar();
  for (let i = 0; i < 3; i++) {
    setLit(i);
    sound.beep();
    await wait(1000);
  }
  setLit(3);
}

function endCountdown() {
  els.countdown.hidden = true;
  setLit(-1);
  updateToolbar();
}

async function snap(useFlash) {
  if (useFlash) {
    els.flash.classList.add('on');
    await wait(170);
  }
  const effect = currentEffect();
  const canvas = renderer.capture(effect, {
    mirror: !state.settings.autoFlip, time: now(), bg: bgFor(effect),
  });
  sound.shutter();
  if (useFlash) els.flash.classList.remove('on');
  return canvas;
}

function compose4(frames) {
  const W = frames[0].width, H = frames[0].height;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  frames.forEach((f, i) => ctx.drawImage(f, (i % 2) * W / 2, Math.floor(i / 2) * H / 2, W / 2, H / 2));
  return c;
}

async function savePhoto(canvas) {
  const [data, thumb] = await Promise.all([toBuffer(canvas), makeThumb(canvas)]);
  const item = await api.save({ prefix: 'Photo', ext: 'jpg', data, thumb });
  addItem(item);
}

async function take(e = {}) {
  if (!state.cameraReady) return;
  if (state.recorder) return stopRecording();
  if (state.busy) return;
  if (state.viewing) goLive();
  closeGrid();

  const skipCountdown = e.altKey;
  const useFlash = state.settings.flash && !e.shiftKey;
  state.busy = true;
  updateToolbar();
  try {
    if (!skipCountdown) await countdown();
    if (state.mode === 'photo') {
      await savePhoto(await snap(useFlash));
    } else if (state.mode === '4up') {
      const frames = [];
      for (let i = 0; i < 4; i++) {
        if (skipCountdown) { els.countdown.hidden = false; setLit(3); updateToolbar(); }
        frames.push(await snap(useFlash));
        if (i < 3) await wait(useFlash ? 480 : 420);
      }
      await savePhoto(compose4(frames));
    } else {
      await startRecording();
    }
  } catch (err) {
    console.error(err);
    showMessage('The item couldn’t be saved.');
  } finally {
    state.busy = false;
    endCountdown();
  }
}

async function startRecording() {
  const canvasStream = els.canvas.captureStream(30);
  let mic = null;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false } });
  } catch (err) {
    console.warn('Recording without sound', err);
  }
  const tracks = [...canvasStream.getVideoTracks(), ...(mic ? mic.getAudioTracks() : [])];
  const mimeType = [
    'video/mp4;codecs=avc1.42E01F,mp4a.40.2',
    'video/mp4;codecs=avc1,opus',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ].find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(new MediaStream(tracks), { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  const poster = await makeThumb(els.canvas);

  rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
  rec.onstop = async () => {
    mic?.getTracks().forEach((t) => t.stop());
    canvasStream.getTracks().forEach((t) => t.stop());
    try {
      const blob = new Blob(chunks, { type: rec.mimeType });
      const ext = rec.mimeType.includes('mp4') ? 'mp4' : 'webm';
      const item = await api.save({ prefix: 'Movie', ext, data: await blob.arrayBuffer(), thumb: poster });
      addItem(item);
    } catch (err) {
      console.error(err);
      showMessage('The movie couldn’t be saved.');
    }
  };
  rec.start(1000);

  const start = performance.now();
  const tick = () => {
    const s = Math.floor((performance.now() - start) / 1000);
    els.recTime.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  tick();
  state.recorder = { rec, timer: setInterval(tick, 250) };
  els.shutter.classList.add('recording');
  els.recTime.hidden = false;
  updateToolbar();
}

function stopRecording() {
  const r = state.recorder;
  if (!r) return;
  state.recorder = null;
  clearInterval(r.timer);
  r.rec.stop();
  els.shutter.classList.remove('recording');
  els.recTime.hidden = true;
  updateToolbar();
}

// ---------------------------------------------------------------------------
// Strip & viewer

function thumbEl(item) {
  const el = document.createElement('div');
  el.className = `thumb ${item.kind}`;
  el.dataset.name = item.name;
  el.draggable = true;
  const img = document.createElement('img');
  img.alt = '';
  img.decoding = 'async';
  if (item.kind === 'photo' || item.thumb) img.src = thumbUrl(item);
  el.append(img);
  if (item.kind === 'video') {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.innerHTML = ICONS.badgeVideo;
    el.append(badge);
    if (!item.thumb) generateVideoThumb(item, img);
  }
  const del = document.createElement('button');
  del.className = 'del';
  del.title = 'Delete';
  del.textContent = '×';
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteItem(item);
  });
  el.append(del);

  el.addEventListener('click', () => viewItem(item));
  el.addEventListener('dragstart', (e) => {
    e.preventDefault();
    api.startDrag(item.name);
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (state.busy || state.recorder) return;
    viewItem(item);
    api.popupShare({ kind: item.kind });
  });
  return el;
}

async function generateVideoThumb(item, img) {
  try {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.preload = 'auto';
    v.src = libUrl(item);
    await new Promise((resolve, reject) => {
      v.addEventListener('loadeddata', resolve, { once: true });
      v.addEventListener('error', reject, { once: true });
    });
    const thumb = await makeThumb(v);
    const updated = await api.saveThumb({ name: item.name, thumb });
    Object.assign(item, updated);
    img.src = thumbUrl(item);
  } catch (err) {
    console.warn('No thumbnail for', item.name, err);
  }
}

function renderStrip() {
  els.stripInner.replaceChildren(...state.items.map(thumbEl));
  markSelected();
}

function thumbFor(item) {
  return item && els.stripInner.querySelector(`.thumb[data-name="${CSS.escape(item.name)}"]`);
}

function markSelected() {
  for (const el of els.stripInner.children) {
    el.classList.toggle('selected', el.dataset.name === state.selected?.name);
  }
}

function addItem(item) {
  state.items.push(item);
  const el = thumbEl(item);
  el.classList.add('new');
  els.stripInner.append(el);
  requestAnimationFrame(() => els.strip.scrollTo({ left: els.strip.scrollWidth, behavior: 'smooth' }));
}

function viewItem(item) {
  if (!item || state.busy || state.recorder) return;
  closeGrid();
  hideMessage();
  state.selected = item;
  state.viewing = true;
  els.noCamera.hidden = true;
  els.canvas.style.visibility = 'hidden';
  if (item.kind === 'video') {
    els.viewerImg.hidden = true;
    els.viewerImg.removeAttribute('src');
    els.viewerVideo.crossOrigin = 'anonymous';
    els.viewerVideo.src = libUrl(item);
    els.viewerVideo.hidden = false;
  } else {
    stopViewerVideo();
    els.viewerImg.src = libUrl(item);
    els.viewerImg.hidden = false;
  }
  markSelected();
  thumbFor(item)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  updateToolbar();
}

function stopViewerVideo() {
  els.viewerVideo.pause();
  els.viewerVideo.removeAttribute('src');
  els.viewerVideo.load();
  els.viewerVideo.hidden = true;
}

function goLive() {
  if (!state.viewing) return;
  state.viewing = false;
  state.selected = null;
  stopViewerVideo();
  els.viewerImg.hidden = true;
  els.viewerImg.removeAttribute('src');
  els.canvas.style.visibility = state.cameraReady ? '' : 'hidden';
  els.noCamera.hidden = state.cameraReady;
  markSelected();
  updateToolbar();
}

function stepItem(delta) {
  if (!state.viewing || !state.selected) return;
  const i = state.items.indexOf(state.selected);
  const next = state.items[i + delta];
  if (next) viewItem(next);
}

async function deleteItem(item = state.selected) {
  if (!item || state.busy) return;
  const idx = state.items.indexOf(item);
  if (idx < 0) return;
  try {
    await api.remove(item.name);
  } catch (err) {
    console.error(err);
    return showMessage('The item couldn’t be deleted.');
  }
  state.items.splice(idx, 1);
  thumbFor(item)?.remove();
  const wasViewing = state.viewing && state.selected === item;
  if (wasViewing) {
    const next = state.items[idx] || state.items[idx - 1];
    if (next) viewItem(next);
    else goLive();
  } else if (state.selected === item) {
    state.selected = null;
    markSelected();
  }
}

async function undoDelete() {
  const item = await api.undoDelete();
  if (!item) return;
  state.items.push(item);
  state.items.sort((a, b) => a.time - b.time || a.name.localeCompare(b.name));
  renderStrip();
  viewItem(item);
}

async function flipItem(item = state.selected) {
  if (item?.kind !== 'photo') return;
  try {
    const img = await loadImage(libUrl(item));
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0);
    const [data, thumb] = await Promise.all([toBuffer(c, 'image/jpeg', 0.95), makeThumb(c)]);
    const updated = await api.overwrite({ name: item.name, data, thumb });
    Object.assign(item, updated, { version: updated.version + 1 });
    const el = thumbFor(item);
    if (el) el.querySelector('img').src = thumbUrl(item);
    if (state.viewing && state.selected === item) els.viewerImg.src = libUrl(item);
  } catch (err) {
    console.error(err);
    showMessage('The photo couldn’t be flipped.');
  }
}

// ---------------------------------------------------------------------------
// Menus & commands

async function menuState(extra = {}) {
  return {
    mode: state.mode,
    cameraReady: state.cameraReady,
    busy: state.busy || !!state.recorder,
    gridOpen: state.gridOpen,
    effect: state.effect.id,
    selected: state.selected ? { name: state.selected.name, kind: state.selected.kind } : null,
    viewing: state.viewing,
    fullscreen: state.fullscreen,
    cameras: state.cameras,
    cameraId: state.cameraId,
    canUndo: await api.canUndo(),
    ...extra,
  };
}

async function toggleSetting(key) {
  state.settings = await api.setSettings({ [key]: !state.settings[key] });
}

function run(cmd, arg) {
  const sel = state.selected;
  switch (cmd) {
    case 'take': return take();
    case 'effects': return toggleGrid();
    case 'page': return changePage(arg);
    case 'reset': return selectEffect(NORMAL);
    case 'view': return viewItem(sel);
    case 'live': return goLive();
    case 'fullscreen': return api.toggleFullscreen();
    case 'about': els.about.hidden = false; return;
    case 'library': return api.reveal(null);
    case 'export': return sel && api.exportItem(sel.name);
    case 'open': return sel && api.open(sel.name);
    case 'reveal': return sel && api.reveal(sel.name);
    case 'copy': return sel && api.copy(sel.name);
    case 'delete': return deleteItem();
    case 'undo': return undoDelete();
    case 'flip': return flipItem();
    case 'autoflip': return toggleSetting('autoFlip');
    case 'flash': return toggleSetting('flash');
    case 'clearBackdrop': return clearBackdrop(arg);
    case 'camera':
      api.setSettings({ cameraId: arg }).then((s) => { state.settings = s; });
      return startCamera(arg);
  }
}

// ---------------------------------------------------------------------------
// Events

function bindUI() {
  $('.light.close').addEventListener('click', () => api.close());
  $('.light.min').addEventListener('click', () => api.minimize());
  $('.light.zoom').addEventListener('click', () => api.toggleFullscreen());
  $('#titlebar').addEventListener('dblclick', (e) => {
    if (!e.target.closest('.lights')) api.zoom();
  });

  for (const b of els.modes.children) b.addEventListener('click', () => setMode(b.dataset.mode));
  els.shutter.addEventListener('click', (e) => take(e));
  els.btnEffects.addEventListener('click', toggleGrid);
  els.fxPrev.addEventListener('click', () => stepEffect(-1));
  els.fxNext.addEventListener('click', () => stepEffect(1));
  els.btnLive.addEventListener('click', goLive);
  els.btnShare.addEventListener('click', () => state.selected && api.popupShare({ kind: state.selected.kind }));
  els.about.addEventListener('click', () => { els.about.hidden = true; });

  els.strip.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      els.strip.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }, { passive: false });

  // Keep stray file drops from navigating the window.
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());

  document.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    const cell = e.target.closest('.cell');
    const fx = cell && PAGES[state.page][cell.dataset.index];
    const extra = fx?.kind === 'user'
      ? { backdropSlot: fx.slot, backdropFilled: !!state.bgTextures[fx.slot] }
      : {};
    api.popupMenu(await menuState(extra));
  });

  document.addEventListener('keydown', onKey);

  window.addEventListener('blur', () => document.body.classList.add('blurred'));
  window.addEventListener('focus', () => document.body.classList.remove('blurred'));

  new ResizeObserver(layout).observe(els.stage);
  navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);

  api.onCommand(run);
  api.onFullscreen((fs) => {
    state.fullscreen = fs;
    document.body.classList.toggle('fullscreen', fs);
  });
}

function onKey(e) {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (!els.about.hidden) {
    els.about.hidden = true;
    return;
  }
  if (key === 'F11' || (e.ctrlKey && e.metaKey && key === 'f')) {
    e.preventDefault();
    return api.toggleFullscreen();
  }
  if (mod) {
    const map = {
      t: () => take(e), e: () => run('export'), z: () => undoDelete(), c: () => run('copy'),
      f: () => flipItem(), q: () => api.close(), w: () => api.close(),
      ArrowRight: () => changePage(1), ArrowLeft: () => changePage(-1),
    };
    if (map[key]) {
      e.preventDefault();
      map[key]();
    }
    return;
  }
  switch (key) {
    case 'Escape':
      // Toggles the effects grid, so effects can be browsed without the mouse.
      if (state.gridOpen) closeGrid();
      else if (state.viewing) goLive();
      else openGrid();
      break;
    case 'Delete':
    case 'Backspace':
      if (state.viewing) deleteItem();
      break;
    case 'ArrowLeft':
      if (state.gridOpen) changePage(-1);
      else stepItem(-1);
      break;
    case 'ArrowRight':
      if (state.gridOpen) changePage(1);
      else stepItem(1);
      break;
    case 'Enter':
      // Same as clicking the red camera button (also starts/stops a movie).
      // preventDefault stops a focused toolbar button from also being clicked.
      e.preventDefault();
      if (!state.viewing && !e.repeat) take(e);
      break;
    case '1': case '2': case '3': case '4': case '5': case '6': case '7': case '8': case '9':
      // Picks the matching cell (reading order) on the current effects page.
      if (!state.viewing && state.cameraReady && !state.busy && !state.recorder) {
        const fx = PAGES[state.page][Number(key) - 1];
        if (fx.kind === 'user' && !state.bgTextures[fx.slot]) showMessage('Drag an image onto this slot first.');
        else selectEffect(fx);
      }
      break;
    case ' ':
      if (state.viewing && state.selected?.kind === 'video') {
        e.preventDefault();
        els.viewerVideo.paused ? els.viewerVideo.play() : els.viewerVideo.pause();
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Startup

async function init() {
  injectIcons();
  state.settings = await api.getSettings();
  state.mode = state.settings.mode || 'photo';
  state.fullscreen = await api.isFullscreen();
  document.body.classList.toggle('fullscreen', state.fullscreen);

  renderer = new Renderer(els.canvas);
  vision = new Vision();
  video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;

  buildGrid();
  bindUI();
  updateToolbar();
  layout();

  state.backdrops = await api.listBackdrops();
  await Promise.all(Object.entries(state.backdrops).map(([slot, name]) => loadBackdrop(Number(slot), name)));

  state.items = await api.list();
  renderStrip();
  requestAnimationFrame(() => { els.strip.scrollLeft = els.strip.scrollWidth; });

  requestAnimationFrame(frame);
  await startCamera(state.settings.cameraId);
}

init().catch((err) => {
  console.error(err);
  showMessage(String(err.message || err), 0);
});

// Exposed for debugging from DevTools.
window.__booth = {
  state, findEffect, PAGES,
  get renderer() { return renderer; },
  get vision() { return vision; },
  selectEffect: (id) => selectEffect(findEffect(id)),
  openGrid, closeGrid, changePage, viewItem, goLive, take,
};
