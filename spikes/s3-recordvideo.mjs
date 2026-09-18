// S3 — does electron.launch({ recordVideo }) work against the packaged app, and what does the WebM look like?
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const exe = '/Applications/Bruno.app/Contents/MacOS/Bruno';
const dir = 'out/s3-video'; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
let app;
try {
  app = await electron.launch({ executablePath: exe, timeout: 45_000, recordVideo: { dir, size: { width: 1600, height: 1000 } } });
  const win = await app.firstWindow({ timeout: 45_000 });
  await win.waitForLoadState('domcontentloaded');
  await win.locator('[data-testid="sidebar"]').waitFor({ timeout: 20_000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentBounds({ x: 40, y: 60, width: 1600, height: 1000 }, false));
  const t0 = Date.now();
  await win.waitForTimeout(800);
  const tStart = Date.now() - t0;                 // where a startRecording step would stamp
  await win.mouse.move(120, 120); await win.mouse.move(900, 600, { steps: 40 });
  await win.locator('[data-testid="toggle-sidebar-button"]').click().catch(() => {});
  await win.waitForTimeout(1200);
  await win.locator('[data-testid="toggle-sidebar-button"]').click().catch(() => {});
  await win.waitForTimeout(1500);
  const tStop = Date.now() - t0;
  const video = win.video();
  console.log('video handle:', !!video, ' marks(ms): start', tStart, 'stop', tStop);
  await app.close(); app = null;
  const p = await video?.path();
  console.log('video path:', p, 'size:', p && fs.statSync(p).size);
  if (p) console.log(execSync(`ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames -show_entries format=duration,size -of json "${p}"`).toString());
  console.log('S3 DONE');
} catch (e) { console.log('S3 FAIL:', String(e.message).split('\n').slice(0, 3).join(' | ')); } finally { await app?.close().catch(() => {}); }
