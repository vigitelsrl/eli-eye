const {
  app, BrowserWindow, protocol, ipcMain, Menu, shell, clipboard,
  nativeImage, dialog, session,
} = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Readable } = require('stream');

app.setName('Eli-Eye');

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

// ---------------------------------------------------------------------------
// Paths

const LIBRARY = path.join(app.getPath('pictures'), 'Eli-Eye Library');
const PICTURES = path.join(LIBRARY, 'Pictures');
const THUMBS = path.join(LIBRARY, 'Thumbnails');
const USER_DATA = app.getPath('userData');
const BACKDROPS = path.join(USER_DATA, 'Backdrops');
const HOLDING = path.join(USER_DATA, 'Deleted');
const SETTINGS_FILE = path.join(USER_DATA, 'settings.json');

// One-time move of data from when the app was called "Photo Booth".
function migrateOldData() {
  const oldLibrary = path.join(app.getPath('pictures'), 'Photo Booth Library');
  if (fs.existsSync(oldLibrary) && !fs.existsSync(LIBRARY)) {
    try { fs.renameSync(oldLibrary, LIBRARY); } catch (err) { console.error('Library migration failed', err); }
  }
  const oldData = path.join(app.getPath('appData'), 'Photo Booth');
  for (const name of ['settings.json', 'Backdrops', 'Deleted']) {
    const from = path.join(oldData, name);
    const to = path.join(USER_DATA, name);
    if (fs.existsSync(from) && !fs.existsSync(to)) {
      try {
        fs.mkdirSync(USER_DATA, { recursive: true });
        fs.renameSync(from, to);
      } catch (err) {
        console.error(`Migration of ${name} failed`, err);
      }
    }
  }
}
migrateOldData();

for (const dir of [PICTURES, THUMBS, BACKDROPS, HOLDING]) fs.mkdirSync(dir, { recursive: true });

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/mp4',
  '.woff2': 'font/woff2', '.tflite': 'application/octet-stream', '.task': 'application/octet-stream',
};
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.m4v']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif']);

const ROOTS = { bundle: __dirname, library: PICTURES, thumbs: THUMBS, backdrops: BACKDROPS };

const CORS = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' };

// Serves files with Range support so <video> can seek.
async function serveFile(request, file) {
  let stat;
  try { stat = await fsp.stat(file); } catch { return new Response('Not found', { status: 404 }); }
  if (!stat.isFile()) return new Response('Not found', { status: 404 });
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = request.headers.get('range');
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m) {
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : stat.size - 1;
    if (start >= stat.size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    }
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
      status: 206,
      headers: {
        'Content-Type': type, 'Accept-Ranges': 'bytes', ...CORS,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': String(end - start + 1),
      },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), {
    headers: { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(stat.size), ...CORS },
  });
}

function registerProtocol() {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const root = ROOTS[url.host];
    if (!root) return new Response('Not found', { status: 404 });
    const rel = decodeURIComponent(url.pathname);
    const file = path.normalize(path.join(root, rel));
    if (file !== root && !file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
    return serveFile(request, file);
  });
}

// ---------------------------------------------------------------------------
// Settings

const DEFAULT_SETTINGS = { flash: true, autoFlip: false, cameraId: null, mode: 'photo', backdrops: {} };
let settings = { ...DEFAULT_SETTINGS };
try { settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch {}

function saveSettings() {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// ---------------------------------------------------------------------------
// Library

function kindOf(name) {
  const ext = path.extname(name).toLowerCase();
  if (VIDEO_EXT.has(ext)) return 'video';
  if (IMAGE_EXT.has(ext)) return 'photo';
  return null;
}

function thumbName(name) {
  return name + '.jpg';
}

async function describe(name) {
  const stat = await fsp.stat(path.join(PICTURES, name));
  const hasThumb = fs.existsSync(path.join(THUMBS, thumbName(name)));
  return {
    name,
    kind: kindOf(name),
    time: stat.birthtimeMs || stat.mtimeMs,
    version: Math.round(stat.mtimeMs),
    thumb: hasThumb ? thumbName(name) : null,
  };
}

async function listLibrary() {
  const names = (await fsp.readdir(PICTURES)).filter((n) => !n.startsWith('.') && kindOf(n));
  const items = await Promise.all(names.map(describe));
  return items.sort((a, b) => a.time - b.time || a.name.localeCompare(b.name));
}

// "Photo on 10-6-26 at 5.05 PM.jpg", "Movie on 10-6-26 at 5.05 PM #2.mp4"
function makeName(prefix, ext) {
  const d = new Date();
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const yy = String(d.getFullYear() % 100).padStart(2, '0');
  const base = `${prefix} on ${d.getMonth() + 1}-${d.getDate()}-${yy} at ${h}.${mm} ${ampm}`;
  let name = `${base}.${ext}`;
  for (let i = 2; fs.existsSync(path.join(PICTURES, name)); i++) name = `${base} #${i}.${ext}`;
  return name;
}

function safeName(name) {
  const base = path.basename(String(name));
  if (!base || base !== name || base.startsWith('.')) throw new Error('Invalid name');
  return base;
}

// Deleted items wait here so Undo can restore them; they go to the trash on quit.
const undoStack = [];

async function flushDeleted() {
  for (const entry of await fsp.readdir(HOLDING).catch(() => [])) {
    const p = path.join(HOLDING, entry);
    await shell.trashItem(p).catch(() => fsp.rm(p, { recursive: true, force: true }));
  }
}

// ---------------------------------------------------------------------------
// Window

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 860,
    height: 662,
    minWidth: 600,
    minHeight: 480,
    frame: false,
    title: 'Eli-Eye',
    backgroundColor: '#1e1e1e',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  win.setMenu(null);
  win.loadURL('app://bundle/renderer/index.html');
  win.once('ready-to-show', () => win.show());
  win.on('enter-full-screen', () => win.webContents.send('fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('fullscreen', false));
  win.on('maximize', () => win.webContents.send('maximized', true));
  win.on('unmaximize', () => win.webContents.send('maximized', false));
}

function send(command, arg) {
  win?.webContents.send('command', command, arg);
}

// ---------------------------------------------------------------------------
// IPC

ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:set', (_e, patch) => {
  settings = { ...settings, ...patch };
  saveSettings();
  return settings;
});

ipcMain.handle('lib:list', () => listLibrary());
ipcMain.handle('lib:path', () => PICTURES);

ipcMain.handle('lib:save', async (_e, { prefix, ext, data, thumb }) => {
  const name = makeName(prefix, ext);
  await fsp.writeFile(path.join(PICTURES, name), Buffer.from(data));
  if (thumb) await fsp.writeFile(path.join(THUMBS, thumbName(name)), Buffer.from(thumb));
  return describe(name);
});

ipcMain.handle('lib:overwrite', async (_e, { name, data, thumb }) => {
  name = safeName(name);
  await fsp.writeFile(path.join(PICTURES, name), Buffer.from(data));
  if (thumb) await fsp.writeFile(path.join(THUMBS, thumbName(name)), Buffer.from(thumb));
  return describe(name);
});

ipcMain.handle('lib:saveThumb', async (_e, { name, thumb }) => {
  name = safeName(name);
  await fsp.writeFile(path.join(THUMBS, thumbName(name)), Buffer.from(thumb));
  return describe(name);
});

ipcMain.handle('lib:delete', async (_e, name) => {
  name = safeName(name);
  const item = await describe(name);
  const slot = path.join(HOLDING, String(Date.now()) + '-' + Math.random().toString(36).slice(2));
  await fsp.mkdir(slot);
  await fsp.rename(path.join(PICTURES, name), path.join(slot, name));
  const thumb = path.join(THUMBS, thumbName(name));
  if (fs.existsSync(thumb)) await fsp.rename(thumb, path.join(slot, thumbName(name)));
  undoStack.push({ slot, name, time: item.time });
  return true;
});

ipcMain.handle('lib:undoDelete', async () => {
  const entry = undoStack.pop();
  if (!entry) return null;
  const { slot, name } = entry;
  let target = name;
  if (fs.existsSync(path.join(PICTURES, target))) {
    const ext = path.extname(name);
    target = makeName(path.basename(name, ext).split(' on ')[0], ext.slice(1));
  }
  await fsp.rename(path.join(slot, name), path.join(PICTURES, target));
  const thumb = path.join(slot, thumbName(name));
  if (fs.existsSync(thumb)) await fsp.rename(thumb, path.join(THUMBS, thumbName(target)));
  await fsp.rm(slot, { recursive: true, force: true });
  return { ...(await describe(target)), time: entry.time };
});

ipcMain.handle('lib:canUndo', () => undoStack.length > 0);

ipcMain.handle('lib:open', (_e, name) => shell.openPath(path.join(PICTURES, safeName(name))));
ipcMain.handle('lib:reveal', (_e, name) => {
  if (name) shell.showItemInFolder(path.join(PICTURES, safeName(name)));
  else shell.openPath(PICTURES);
});

ipcMain.handle('lib:copy', (_e, name) => {
  const file = path.join(PICTURES, safeName(name));
  if (kindOf(name) === 'photo') {
    clipboard.writeImage(nativeImage.createFromPath(file));
  } else {
    clipboard.writeBuffer('text/uri-list', Buffer.from(`file://${encodeURI(file)}\r\n`));
  }
});

ipcMain.handle('lib:export', async (_e, name) => {
  name = safeName(name);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export',
    defaultPath: path.join(app.getPath('pictures'), name),
  });
  if (canceled || !filePath) return false;
  await fsp.copyFile(path.join(PICTURES, name), filePath);
  return true;
});

ipcMain.on('lib:drag', (event, name) => {
  try {
    name = safeName(name);
    const file = path.join(PICTURES, name);
    const thumb = path.join(THUMBS, thumbName(name));
    let icon = nativeImage.createFromPath(fs.existsSync(thumb) ? thumb : file);
    if (icon.isEmpty()) icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
    event.sender.startDrag({ file, icon: icon.resize({ width: 96 }) });
  } catch {}
});

// User backdrops (the last effects page).
ipcMain.handle('backdrop:list', () => settings.backdrops);
ipcMain.handle('backdrop:set', async (_e, { slot, file }) => {
  const ext = path.extname(file).toLowerCase();
  if (!IMAGE_EXT.has(ext)) throw new Error('Not an image');
  const old = settings.backdrops[slot];
  const name = `slot${slot}-${Date.now()}${ext}`;
  await fsp.copyFile(file, path.join(BACKDROPS, name));
  if (old) await fsp.rm(path.join(BACKDROPS, old), { force: true });
  settings.backdrops = { ...settings.backdrops, [slot]: name };
  saveSettings();
  return name;
});
ipcMain.handle('backdrop:clear', async (_e, slot) => {
  const old = settings.backdrops[slot];
  if (old) await fsp.rm(path.join(BACKDROPS, old), { force: true });
  const next = { ...settings.backdrops };
  delete next[slot];
  settings.backdrops = next;
  saveSettings();
});

// Window controls (custom title bar).
ipcMain.on('win:close', () => win?.close());
ipcMain.on('win:minimize', () => win?.minimize());
ipcMain.on('win:fullscreen', () => win?.setFullScreen(!win.isFullScreen()));
ipcMain.on('win:zoom', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
ipcMain.handle('win:isFullscreen', () => win?.isFullScreen() ?? false);

// The toolbar's Share button.
ipcMain.on('menu:share', (_e, item) => {
  Menu.buildFromTemplate([
    { label: 'Open With Default App', click: () => send('open') },
    { label: 'Show in Files', click: () => send('reveal') },
    { label: 'Copy', click: () => send('copy') },
    { label: 'Export…', click: () => send('export') },
    ...(item?.kind === 'photo' ? [{ type: 'separator' }, { label: 'Flip Photo', click: () => send('flip') }] : []),
    { type: 'separator' },
    { label: 'Delete', click: () => send('delete') },
  ]).popup({ window: win });
});

// The macOS menu bar, offered as a context menu (Linux has no global menu bar here).
ipcMain.on('menu:popup', (_e, s) => {
  const has = !!s.selected;
  const isPhoto = s.selected?.kind === 'photo';
  const accel = (a) => ({ accelerator: a, registerAccelerator: false });
  const menu = Menu.buildFromTemplate([
    {
      label: 'Eli-Eye',
      submenu: [
        { label: 'About Eli-Eye', click: () => send('about') },
        { type: 'separator' },
        { label: 'Quit Eli-Eye', ...accel('Ctrl+Q'), click: () => app.quit() },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: s.mode === 'video' ? 'Record Video' : 'Take Photo', ...accel('Ctrl+T'), enabled: s.cameraReady && !s.busy, click: () => send('take') },
        { type: 'separator' },
        { label: 'Export…', ...accel('Ctrl+E'), enabled: has, click: () => send('export') },
        { label: 'Open With Default App', enabled: has, click: () => send('open') },
        { label: 'Show in Files', enabled: has, click: () => send('reveal') },
        { type: 'separator' },
        { label: 'Open Eli-Eye Library', click: () => send('library') },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo Delete', ...accel('Ctrl+Z'), enabled: s.canUndo, click: () => send('undo') },
        { type: 'separator' },
        { label: 'Copy', ...accel('Ctrl+C'), enabled: has, click: () => send('copy') },
        { label: 'Delete', ...accel('Delete'), enabled: has, click: () => send('delete') },
        { type: 'separator' },
        { label: 'Flip Photo', ...accel('Ctrl+F'), enabled: isPhoto, click: () => send('flip') },
        { label: 'Auto Flip New Items', type: 'checkbox', checked: settings.autoFlip, click: () => send('autoflip') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: s.gridOpen ? 'Hide Effects' : 'Show Effects', enabled: s.cameraReady && !s.busy, click: () => send('effects') },
        { label: 'Next Page', ...accel('Ctrl+Right'), enabled: s.gridOpen, click: () => send('page', 1) },
        { label: 'Previous Page', ...accel('Ctrl+Left'), enabled: s.gridOpen, click: () => send('page', -1) },
        { label: 'Reset Effect', enabled: s.effect !== 'normal', click: () => send('reset') },
        { type: 'separator' },
        { label: 'Show Photo Preview', enabled: !!s.selected && !s.viewing, click: () => send('view') },
        { label: 'Show Video Preview', enabled: !!s.viewing, click: () => send('live') },
        { type: 'separator' },
        { label: s.fullscreen ? 'Exit Full Screen' : 'Enter Full Screen', ...accel('F11'), click: () => send('fullscreen') },
      ],
    },
    {
      label: 'Camera',
      submenu: [
        ...(s.cameras.length
          ? s.cameras.map((c) => ({
            label: c.label, type: 'radio', checked: c.id === s.cameraId, click: () => send('camera', c.id),
          }))
          : [{ label: 'No Camera Connected', enabled: false }]),
        { type: 'separator' },
        { label: 'Enable Screen Flash', type: 'checkbox', checked: settings.flash, click: () => send('flash') },
      ],
    },
    ...(s.backdropSlot != null && s.backdropFilled ? [
      { type: 'separator' },
      { label: 'Remove Backdrop', click: () => send('clearBackdrop', s.backdropSlot) },
    ] : []),
  ]);
  menu.popup({ window: win });
});

// ---------------------------------------------------------------------------
// App lifecycle

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['media', 'fullscreen', 'clipboard-sanitized-write'].includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler(() => true);
  // Everything is bundled locally, so the app never needs the network. This also
  // stops MediaPipe's built-in usage logging from phoning home.
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const local = /^(app|blob|data|devtools|file):/.test(details.url);
    if (!local) console.log('Blocked network request:', details.url);
    cb({ cancel: !local });
  });
  registerProtocol();
  createWindow();
});

let flushing = false;
app.on('before-quit', (e) => {
  if (flushing) return;
  e.preventDefault();
  flushing = true;
  flushDeleted().finally(() => app.quit());
});

app.on('window-all-closed', () => app.quit());
