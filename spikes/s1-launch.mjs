// S1 — can Playwright's Electron launcher drive the signed, hardened-runtime Bruno.app?
import { _electron as electron } from 'playwright';

const exe = '/Applications/Bruno.app/Contents/MacOS/Bruno';
const t0 = Date.now();
let app;
const killTimer = setTimeout(() => { console.error('HARD TIMEOUT'); process.exit(2); }, 120_000);
try {
  app = await electron.launch({ executablePath: exe, timeout: 60_000 });
  console.log('launched in', Date.now() - t0, 'ms');
  const win = await app.firstWindow({ timeout: 60_000 });
  await win.waitForLoadState('domcontentloaded');
  console.log('title:', await win.title());
  console.log('url:', win.url());

  const main = await app.evaluate(({ app, BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return {
      version: app.getVersion(), name: app.getName(), userData: app.getPath('userData'),
      bounds: w.getBounds(), contentBounds: w.getContentBounds(),
      mediaSourceId: w.getMediaSourceId(),
      electron: process.versions.electron, chrome: process.versions.chrome,
      windows: BrowserWindow.getAllWindows().length,
    };
  });
  console.log('main-process:', JSON.stringify(main, null, 2));
  console.log('viewportSize:', win.viewportSize());

  // settle a bit so the renderer paints real UI, then inventory live test ids
  await win.waitForTimeout(4000);
  const ids = await win.evaluate(() =>
    [...new Set([...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')))].sort());
  console.log('live testids:', ids.length);
  console.log(ids.join(', '));
  await win.screenshot({ path: 'out/s1.png' });
  console.log('S1 PASS');
} catch (e) {
  console.error('S1 FAIL:', e?.message ?? e);
  process.exitCode = 1;
} finally {
  clearTimeout(killTimer);
  try { await app?.close(); } catch {}
}
