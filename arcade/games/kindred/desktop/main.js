// Kindred for the desktop: the same index.html the arcade ships, in a window.
//
// The page is served from kindred://app/, and the villagers' voice is answered
// here in the main process (brain.js) on the same scheme, at kindred://app/api/brain.
// So the page's fetch('/api/brain') works unchanged, and nothing listens on a
// port: there is no server for anyone, on any network, to reach.
//
//   Kindred.exe                 play
//   Kindred.exe --smoke <file>  load, start a life, ask the voice once, write a report, quit
const { app, BrowserWindow, protocol, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const brain = require('./brain');

protocol.registerSchemesAsPrivileged([{ scheme: 'kindred',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const FILES = { 'index.html': 'text/html; charset=utf-8', 'icon.png': 'image/png' };
const smokeIx = process.argv.indexOf('--smoke');
const SMOKE = smokeIx > 0 ? process.argv[smokeIx + 1] : null;

function json(o, status) {
  return new Response(JSON.stringify(o), { status: status || 200, headers: { 'content-type': 'application/json' } });
}

if (!SMOKE && !app.requestSingleInstanceLock()) app.quit();

let win = null;
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  protocol.handle('kindred', async (req) => {
    const u = new URL(req.url);
    try {
      if (u.pathname === '/api/brain' && req.method === 'GET') return json(brain.status());
      if (u.pathname === '/api/brain' && req.method === 'POST') { const d = await req.json(); return json(await brain.ask(d.system, d.scene)); }
      if (u.pathname === '/api/brain/warm' && req.method === 'POST') { const d = await req.json(); return json(brain.warmup(d.system)); }
    } catch (e) { return json({ ok: false, error: String(e && e.message || e) }, 500); }
    const file = u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\/+/, '');
    if (!FILES[file]) return new Response('not found', { status: 404 });
    return new Response(fs.readFileSync(path.join(__dirname, file)), { headers: { 'content-type': FILES[file] } });
  });

  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 480, minHeight: 380, backgroundColor: '#0b0609', title: 'Kindred',
    icon: path.join(__dirname, 'icon.png'), show: !SMOKE,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('kindred://')) e.preventDefault(); });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.key === 'F12') { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  win.loadURL('kindred://app/index.html');
  if (SMOKE) smoke();
});

async function smoke() {
  const out = { started: new Date().toISOString(), errors: [] };
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 3) out.errors.push(msg); });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    await new Promise((r) => win.webContents.once('did-finish-load', r));
    await wait(2500);
    out.title = await win.webContents.executeJavaScript('document.title');
    out.voiceBefore = await win.webContents.executeJavaScript("fetch('/api/brain').then(r => r.json())");
    await win.webContents.executeJavaScript("localStorage.clear(); document.getElementById('btnPlay').click(); 1");
    await wait(14000);   // the birth reaches the voice, and the answer comes back
    out.voiceAfter = brain.status();
    out.canvas = await win.webContents.executeJavaScript("(function(){var c=document.getElementById('cv');return c.width+'x'+c.height;})()");
    out.name = await win.webContents.executeJavaScript("document.getElementById('vName').textContent");
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  fs.writeFileSync(SMOKE, JSON.stringify(out, null, 2));
  brain.close();
  app.quit();
}

app.on('window-all-closed', () => { brain.close(); app.quit(); });
app.on('before-quit', () => brain.close());
