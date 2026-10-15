// Build the desktop app with nothing to install:
//
//   node arcade/games/kindred/desktop/build.js
//
// Takes Electron from the local download cache (%LOCALAPPDATA%\electron\Cache,
// filled by any Electron install on this PC, e.g. Eliza's), unpacks it as
// dist/Kindred-win32-x64/Kindred.exe, puts this folder's main.js + brain.js and
// the game's own index.html in resources/app, and zips the lot to
// dist/Kindred-win32-x64.zip. The game file is copied, never forked: the
// desktop build plays exactly what the arcade ships.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const VERSION = process.env.KINDRED_ELECTRON || '34.5.8';
const HERE = __dirname;
const GAME = path.join(HERE, '..', 'index.html');
const ICON = path.join(HERE, '..', '..', '..', 'icon-180.png');
const DIST = path.join(HERE, 'dist');
const APPDIR = path.join(DIST, 'Kindred-win32-x64');
const ZIP = APPDIR + '.zip';
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');   // bsdtar: reads and writes zip

function findElectronZip() {
  const cache = path.join(process.env.LOCALAPPDATA || '', 'electron', 'Cache');
  const want = 'electron-v' + VERSION + '-win32-x64.zip';
  for (const d of fs.existsSync(cache) ? fs.readdirSync(cache) : []) {
    const f = path.join(cache, d, want);
    if (fs.existsSync(f)) return f;
  }
  throw new Error(want + ' is not in ' + cache + ' (install electron@' + VERSION + ' anywhere once, or set KINDRED_ELECTRON)');
}

fs.rmSync(APPDIR, { recursive: true, force: true });
fs.rmSync(ZIP, { force: true });
fs.mkdirSync(APPDIR, { recursive: true });
execFileSync(TAR, ['-xf', findElectronZip(), '-C', APPDIR]);
fs.renameSync(path.join(APPDIR, 'electron.exe'), path.join(APPDIR, 'Kindred.exe'));
fs.rmSync(path.join(APPDIR, 'resources', 'default_app.asar'), { force: true });

const app = path.join(APPDIR, 'resources', 'app');
fs.mkdirSync(app, { recursive: true });
const ver = fs.readFileSync(path.join(HERE, '..', '..', '..', 'VERSION'), 'utf8').trim();
fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'kindred', productName: 'Kindred', version: ver, main: 'main.js' }, null, 2));
for (const f of ['main.js', 'brain.js']) fs.copyFileSync(path.join(HERE, f), path.join(app, f));
fs.copyFileSync(GAME, path.join(app, 'index.html'));
fs.copyFileSync(ICON, path.join(app, 'icon.png'));

execFileSync(TAR, ['-a', '-cf', ZIP, '-C', DIST, 'Kindred-win32-x64']);
console.log('built ' + APPDIR + '\\Kindred.exe (Electron ' + VERSION + ', arcade v' + ver + ')');
console.log('zipped ' + ZIP + ' ' + Math.round(fs.statSync(ZIP).size / 1048576) + ' MB');
