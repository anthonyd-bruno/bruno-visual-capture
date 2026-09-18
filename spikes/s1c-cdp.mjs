import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const exe = '/Applications/Bruno.app/Contents/MacOS/Bruno';
const wait = ms => new Promise(r => setTimeout(r, ms));
const p = spawn(exe, ['--remote-debugging-port=9333'], { stdio: ['ignore', 'pipe', 'pipe'] });
let exit = null, err = '';
p.on('exit', (code, sig) => { exit = { code, sig, at: Date.now() - t0 }; });
p.stderr.on('data', d => err += d);
const t0 = Date.now();
while (!/DevTools listening/.test(err) && Date.now() - t0 < 30_000 && !exit) await wait(200);
console.log('devtools up after', Date.now() - t0, 'ms; exit =', exit);
await wait(3000);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 30_000 });
const ctx = browser.contexts()[0];
console.log('connected; contexts =', browser.contexts().length, 'pages =', ctx?.pages().map(pg => pg.url()));
await wait(8000);
console.log('alive 8s after attach?', exit ? `NO — exited ${JSON.stringify(exit)}` : 'YES');
const page = ctx?.pages()[0];
if (!exit && page) {
  console.log('title:', await page.title(), '| viewportSize:', page.viewportSize());
  const ids = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')))].sort());
  console.log('live testids:', ids.length, '\n' + ids.join(', '));
  await page.screenshot({ path: 'out/s1c-cdp.png' });
  const cdp = await ctx.newCDPSession(page);
  const m = await cdp.send('Page.getLayoutMetrics');
  console.log('cssVisualViewport:', JSON.stringify(m.cssVisualViewport), 'dpr-ish size', JSON.stringify(m.cssLayoutViewport));
  await cdp.detach();
}
try { await browser.close(); } catch (e) { console.log('browser.close():', e.message); }
await wait(1500);
console.log('after browser.close(): exit =', exit);
if (!exit) p.kill('SIGTERM');
