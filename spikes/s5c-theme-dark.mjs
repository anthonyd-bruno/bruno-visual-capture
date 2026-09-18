import { _electron as electron } from 'playwright';
const exe = '/Applications/Bruno.app/Contents/MacOS/Bruno';
const app = await electron.launch({ executablePath: exe, timeout: 45_000 });
try {
  const win = await app.firstWindow({ timeout: 45_000 });
  const ready = () => win.locator('[data-testid="sidebar"]').waitFor({ timeout: 20_000 });
  const state = () => win.evaluate(() => ({ htmlClass: document.documentElement.className, ls: localStorage.getItem('bruno.theme'), bg: getComputedStyle(document.querySelector('[data-testid="sidebar"]')).backgroundColor }));
  await ready(); await win.waitForTimeout(500);
  const orig = await state(); console.log('start:', JSON.stringify(orig));
  const setTheme = async (v) => { const t0 = Date.now(); await win.evaluate(v => localStorage.setItem('bruno.theme', JSON.stringify(v)), v); await win.reload(); await ready(); await win.waitForTimeout(300); console.log(`set "${v}" + reload → ${JSON.stringify(await state())} in ${Date.now() - t0} ms`); };
  await setTheme('dark');
  await win.screenshot({ path: 'out/s5c-dark.png' });
  await setTheme('light');
  // does changing localStorage WITHOUT reload do anything?
  await win.evaluate(() => localStorage.setItem('bruno.theme', JSON.stringify('dark'))); await win.waitForTimeout(800);
  console.log('set "dark" without reload →', JSON.stringify(await state()));
  await setTheme(JSON.parse(orig.ls));
} catch (e) { console.log('S5c FAIL:', String(e.message).split('\n')[0]); } finally { await app.close().catch(() => {}); }
