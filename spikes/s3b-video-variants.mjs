import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const exe = '/Applications/Bruno.app/Contents/MacOS/Bruno';
const ready = (win) => win.locator('[data-testid="sidebar"]').waitFor({ timeout: 20_000 });
const race = (p, ms, label) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(label + ' timeout')), ms))]);

// A: recordVideo (no size), skip waitForLoadState — is the page usable and does a WebM appear?
async function variantA() {
  const dir = 'out/s3a'; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  let app; const t0 = Date.now();
  try {
    app = await electron.launch({ executablePath: exe, timeout: 45_000, recordVideo: { dir } });
    console.log('A launched', Date.now() - t0, 'ms');
    const win = await app.firstWindow({ timeout: 45_000 });
    console.log('A firstWindow', Date.now() - t0, 'ms url=', win.url());
    try { await ready(win); console.log('A sidebar visible at', Date.now() - t0, 'ms'); } catch (e) { console.log('A sidebar wait FAILED:', String(e.message).split('\n')[0]); }
    try { console.log('A title:', await race(win.title(), 5000, 'title')); } catch (e) { console.log('A', e.message); }
    try { console.log('A evaluate:', await race(win.evaluate(() => document.readyState), 5000, 'evaluate')); } catch (e) { console.log('A', e.message); }
    await win.waitForTimeout(2000);
    const video = win.video();
    await app.close(); app = null;
    const p = await race(video?.path(), 10_000, 'video.path').catch(e => e.message);
    const exists = fs.existsSync(String(p));
    console.log('A video:', p, exists ? `${fs.statSync(p).size} bytes` : '(missing)');
    if (exists) console.log('A ffprobe:', execSync(`ffprobe -v error -show_entries stream=codec_name,width,height,avg_frame_rate,nb_frames -show_entries format=duration -of json "${p}"`).toString().replace(/\s+/g, ' '));
  } catch (e) { console.log('A FAIL:', String(e.message).split('\n')[0]); } finally { await app?.close().catch(() => {}); }
}

// B: CDP Page.startScreencast frames → per-frame timestamps → FFmpeg concat → CFR 30fps MP4
async function variantB() {
  const dir = 'out/s3b'; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const app = await electron.launch({ executablePath: exe, timeout: 45_000 });
  try {
    const win = await app.firstWindow({ timeout: 45_000 }); await ready(win);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentBounds({ x: 40, y: 60, width: 1600, height: 1000 }, false));
    await win.waitForTimeout(500);
    const cdp = await win.context().newCDPSession(win);
    const frames = [];
    cdp.on('Page.screencastFrame', (f) => { frames.push({ t: f.metadata.timestamp, data: f.data }); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
    const t0 = Date.now();
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 1600, maxHeight: 1000, everyNthFrame: 1 });
    await win.mouse.move(120, 120); await win.mouse.move(900, 600, { steps: 40 });
    await win.locator('[data-testid="toggle-sidebar-button"]').click().catch(() => {});
    await win.waitForTimeout(1200);
    await win.locator('[data-testid="toggle-sidebar-button"]').click().catch(() => {});
    await win.waitForTimeout(1500);
    const nBeforeIdle = frames.length;
    await win.waitForTimeout(1500);                       // idle: do frames still arrive when nothing changes?
    await cdp.send('Page.stopScreencast');
    const wall = (Date.now() - t0) / 1000;
    console.log(`B frames: ${frames.length} in ${wall.toFixed(2)}s (${(frames.length / wall).toFixed(1)} fps avg); frames during 1.5s idle: ${frames.length - nBeforeIdle}`);
    if (frames.length > 1) {
      const ts = frames.map(f => f.t), gaps = ts.slice(1).map((t, i) => (t - ts[i]) * 1000).sort((a, b) => a - b);
      console.log(`B gap ms: min ${gaps[0] | 0} median ${gaps[gaps.length >> 1] | 0} max ${gaps[gaps.length - 1] | 0}`);
      const list = [];
      frames.forEach((f, i) => { const fn = `f${String(i).padStart(5, '0')}.jpg`; fs.writeFileSync(`${dir}/${fn}`, Buffer.from(f.data, 'base64')); const d = i < frames.length - 1 ? frames[i + 1].t - f.t : 0.5; list.push(`file '${fn}'\nduration ${d.toFixed(4)}`); });
      list.push(`file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'`);
      fs.writeFileSync(`${dir}/list.txt`, list.join('\n'));
      execSync(`ffmpeg -v error -y -f concat -safe 0 -i list.txt -vf "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p" -c:v libx264 -preset veryfast -crf 20 -an out.mp4`, { cwd: dir });
      console.log('B mp4:', execSync(`ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,nb_frames -show_entries format=duration,size -of json "${dir}/out.mp4"`).toString().replace(/\s+/g, ' '));
    }
  } catch (e) { console.log('B FAIL:', String(e.message).split('\n')[0]); } finally { await app.close().catch(() => {}); }
}
await variantA();
await variantB();
