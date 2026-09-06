// One place to open a browser for every suite.
//
// Playwright's bundled Chromium (build 1243, with 1.63) crashes at newPage on
// this machine whatever the flags; the system Edge and Chrome do not, and they
// are on every Windows 11 install with nothing to download. So: Edge, then
// Chrome, then the bundled build as the last resort. Set PW_CHANNEL to force
// one (e.g. PW_CHANNEL=chromium for the bundled build).
const { chromium, devices } = require('playwright');

const FLAGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];

async function launch(extraArgs) {
  const args = FLAGS.concat(extraArgs || []);
  const order = process.env.PW_CHANNEL ? [process.env.PW_CHANNEL] : ['msedge', 'chrome', 'chromium'];
  let lastErr = null;
  for (const ch of order) {
    try {
      const b = ch === 'chromium' ? await chromium.launch({ args }) : await chromium.launch({ channel: ch, args });
      // A launch can succeed and the first page still crash (that is exactly
      // what the bundled build does), so prove a page before handing it over.
      const probe = await b.newContext(); const p = await probe.newPage(); await p.setContent('<b>ok</b>'); await probe.close();
      b.__channel = ch;
      return b;
    } catch (e) { lastErr = e; }
  }
  throw new Error('no working browser (tried ' + order.join(', ') + '): ' + (lastErr && lastErr.message.split('\n')[0]));
}

// The phone, as every suite frames it.
function phone(extra) {
  return Object.assign({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: devices['iPhone 13 Pro'].userAgent }, extra || {});
}

module.exports = { launch, phone, devices };
