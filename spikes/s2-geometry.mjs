// S2 — exact, deterministic geometry: setViewportSize vs setContentBounds vs CDP device-metrics override.
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
const exe = '/Applications/Bruno.app/Contents/MacOS/Bruno';
const png = p => { const b = fs.readFileSync(p); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
const app = await electron.launch({ executablePath: exe, timeout: 45_000 });
try {
  const win = await app.firstWindow({ timeout: 45_000 });
  await win.waitForLoadState('domcontentloaded');
  await win.locator('[data-testid="sidebar"]').waitFor({ timeout: 20_000 });
  const geom = () => app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return { bounds: w.getBounds(), content: w.getContentBounds(), scale: screen.getPrimaryDisplay().scaleFactor, work: screen.getPrimaryDisplay().workAreaSize };
  });
  const inner = () => win.evaluate(() => ({ iw: innerWidth, ih: innerHeight, dpr: devicePixelRatio }));
  console.log('initial:', JSON.stringify(await geom()));

  try { await win.setViewportSize({ width: 1600, height: 1000 }); console.log('1. page.setViewportSize: OK ->', JSON.stringify(await inner())); }
  catch (e) { console.log('1. page.setViewportSize: THROWS —', String(e.message).split('\n')[0]); }

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentBounds({ x: 40, y: 60, width: 1600, height: 1000 }, false));
  await win.waitForTimeout(700);
  console.log('2. setContentBounds(1600x1000):', JSON.stringify(await geom()), 'renderer:', JSON.stringify(await inner()));
  await win.screenshot({ path: 'out/s2-bounds-device.png' });
  await win.screenshot({ path: 'out/s2-bounds-css.png', scale: 'css' });
  console.log('   screenshot scale=device:', JSON.stringify(png('out/s2-bounds-device.png')), ' scale=css:', JSON.stringify(png('out/s2-bounds-css.png')));

  const cdp = await win.context().newCDPSession(win);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await win.waitForTimeout(700);
  console.log('3. DMO 1920x1080 dsf=1 — window:', JSON.stringify((await geom()).content), 'renderer:', JSON.stringify(await inner()));
  await win.screenshot({ path: 'out/s2-dmo.png' });
  console.log('   screenshot:', JSON.stringify(png('out/s2-dmo.png')));
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 2, mobile: false });
  await win.waitForTimeout(500);
  await win.screenshot({ path: 'out/s2-dmo2x.png' });
  console.log('   DMO dsf=2 screenshot:', JSON.stringify(png('out/s2-dmo2x.png')), 'renderer:', JSON.stringify(await inner()));
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await cdp.detach();

  const region = await win.locator('[data-testid="sidebar"]').boundingBox();
  await win.locator('[data-testid="sidebar"]').screenshot({ path: 'out/s2-region.png' });
  console.log('4. region (sidebar) bbox:', JSON.stringify(region), 'screenshot:', JSON.stringify(png('out/s2-region.png')));
  console.log('5. mediaSourceId:', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getMediaSourceId()));
  console.log('S2 DONE');
} catch (e) { console.log('S2 FAIL:', e.message); } finally { await app.close().catch(() => {}); }
