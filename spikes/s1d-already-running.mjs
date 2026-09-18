// S1d — what happens when Bruno is already running (user-launched) and we launch under Playwright?
import { spawn, execSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
const exe = '/Applications/Bruno.app/Contents/MacOS/Bruno';
const wait = ms => new Promise(r => setTimeout(r, ms));
const procs = () => { try { return execSync('pgrep -f "MacOS/Bruno$"').toString().trim().split('\n').filter(Boolean); } catch { return []; } };
const p = spawn(exe, [], { stdio: ['ignore', 'pipe', 'pipe'] });
let exit = null; p.on('exit', (c, s) => { exit = { code: c, sig: s }; });
await wait(5000);
console.log('manual Bruno alive after 5s:', !exit, '| main procs:', procs().length);
const t0 = Date.now(); let app;
try {
  app = await electron.launch({ executablePath: exe, timeout: 20_000 });
  const win = await app.firstWindow({ timeout: 15_000 });
  console.log(`2nd instance under Playwright: window url="${win.url()}" after ${Date.now() - t0} ms; windows=`, await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length));
} catch (e) { console.log(`2nd instance FAILED after ${Date.now() - t0} ms: ${String(e.message).split('\n')[0]}`); }
await wait(1500);
console.log('manual Bruno alive after 2nd launch attempt:', !exit, exit ?? '', '| main procs:', procs().length);
await app?.close().catch(() => {});
await wait(800);
console.log('after app.close(): manual alive:', !exit, '| main procs:', procs().length);
// graceful quit of a user-launched Bruno, as the relaunch flow would do it
const tq = Date.now();
try { execSync(`osascript -e 'tell application "Bruno" to quit'`, { timeout: 15_000 }); } catch (e) { console.log('osascript quit error:', String(e.message).split('\n')[0]); }
for (let i = 0; i < 40 && !exit; i++) await wait(250);
console.log(`osascript quit → exit=${JSON.stringify(exit)} after ${Date.now() - tq} ms | main procs: ${procs().length}`);
if (!exit) p.kill('SIGTERM');
