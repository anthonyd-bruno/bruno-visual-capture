// S1 reliability: launch/close Bruno under Playwright N times; the first-ever attempt hit a launch race.
import { _electron as electron } from 'playwright';
import { execSync } from 'node:child_process';
const exe = '/Applications/Bruno.app/Contents/MacOS/Bruno';
const wait = ms => new Promise(r => setTimeout(r, ms));
const N = 5; let pass = 0;
for (let i = 1; i <= N; i++) {
  const t0 = Date.now(); let app;
  try {
    app = await electron.launch({ executablePath: exe, timeout: 45_000 });
    const win = await app.firstWindow({ timeout: 45_000 });
    await win.waitForLoadState('domcontentloaded');
    await win.locator('[data-testid="sidebar"]').waitFor({ timeout: 20_000 });
    console.log(`run ${i}: PASS in ${Date.now() - t0} ms`); pass++;
  } catch (e) {
    console.log(`run ${i}: FAIL after ${Date.now() - t0} ms — ${String(e.message).split('\n')[0]}`);
  } finally {
    try { await app?.close(); } catch {}
    await wait(1200);
    try { execSync('pgrep -f "MacOS/Bruno$"'); console.log('  leftover Bruno process, killing'); execSync('pkill -f "MacOS/Bruno$"'); await wait(1000); } catch {}
  }
}
console.log(`S1 reliability: ${pass}/${N}`);
