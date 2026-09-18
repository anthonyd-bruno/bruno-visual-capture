// Does Bruno stay alive when launched manually with Playwright's flags? Then without them?
import { spawn, execSync } from 'node:child_process';
const exe = '/Applications/Bruno.app/Contents/MacOS/Bruno';
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function trial(label, args) {
  console.log(`\n=== ${label}: ${args.join(' ') || '(no flags)'} ===`);
  let err = '', out = '', exit = null;
  const p = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
  p.on('exit', (code, sig) => { exit = { code, sig, at: Date.now() - t0 }; });
  const t0 = Date.now();
  await wait(12_000);
  console.log('exit after 12s:', exit ?? 'STILL ALIVE');
  try { console.log('procs:\n' + execSync('pgrep -fl "MacOS/Bruno"').toString()); } catch { console.log('procs: none'); }
  if (!exit) { p.kill('SIGTERM'); await wait(1500); }
  console.log('stderr:\n' + err.trim().split('\n').slice(0, 25).join('\n'));
  if (out.trim()) console.log('stdout:\n' + out.trim().slice(0, 1500));
}
await trial('A with playwright flags', ['--inspect=0', '--remote-debugging-port=0']);
await trial('B remote-debugging only', ['--remote-debugging-port=0']);
await trial('C no flags', []);
