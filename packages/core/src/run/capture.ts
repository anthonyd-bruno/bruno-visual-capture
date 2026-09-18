import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { resolveTarget, type BrunoSession, type CaptureHelper } from '@bruno-capture/automation';
import { detectFFmpeg, resizePng } from '@bruno-capture/media';
import type { Framing } from '@bruno-capture/shared';

const execFileP = promisify(execFile);

export interface ScreenshotRequest {
  framing: Framing;
  region?: string;
  locator?: string;
  /** `css` → exactly the CSS-pixel size; `device` → multiplied by the display scale (retina = 2×). */
  scale: 'css' | 'device';
}

export class CaptureError extends Error {
  readonly code = 'capture_failed';
  constructor(message: string, public readonly hint?: string, public override readonly cause?: unknown) { super(message); this.name = 'CaptureError'; }
}

/**
 * Screenshots for all four framings (PRD §48). Full App Window uses macOS's built-in
 * `screencapture -l <CGWindowID>` (needs Screen Recording permission) until the ScreenCaptureKit
 * helper lands in Phase 5; the window id comes from `BrowserWindow#getMediaSourceId()` (measured S1).
 */
export class CaptureController {
  constructor(private readonly session: BrunoSession, private readonly helper?: CaptureHelper) {}

  async screenshot(req: ScreenshotRequest): Promise<Buffer> {
    const page = this.session.page;
    try {
      switch (req.framing) {
        case 'app-content':
          return await page.screenshot({ type: 'png', scale: req.scale, caret: 'hide', animations: 'disabled' });
        case 'region':
        case 'locator': {
          const target = resolveTarget(page, { region: req.region, locator: req.locator });
          await target.waitFor({ state: 'visible', timeout: 10_000 });
          return await target.screenshot({ type: 'png', scale: req.scale, caret: 'hide', animations: 'disabled' });
        }
        case 'full-window':
          return await this.fullWindow(req.scale);
      }
    } catch (e) {
      if (e instanceof CaptureError) throw e;
      throw new CaptureError(`Screenshot failed (${req.framing}${req.region ? ' ' + req.region : ''}): ${String((e as Error).message).split('\n')[0]}`, undefined, e);
    }
  }

  /**
   * Native captures come back in device pixels (2× on retina). Presets are CSS pixels, so with
   * `scale: 'css'` the image is downscaled to the window's CSS size when FFmpeg is available.
   */
  private async fullWindow(scale: 'css' | 'device'): Promise<Buffer> {
    if (!this.session.windowId) throw new CaptureError('Full App Window capture needs the Bruno window id, which is only available in Electron mode.');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bru-capture-win-'));
    const file = path.join(dir, 'window.png');
    try {
      const bounds = await this.session.app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus(); const b = w.getBounds(); return { width: b.width as number, height: b.height as number }; });
      await this.session.page.waitForTimeout(150);
      let captured = false;
      if (this.helper) {
        try { await this.helper.still(this.session.windowId, file); captured = true; }
        catch (e) { if ((e as { code?: string }).code === 'permission_denied') throw new CaptureError((e as Error).message, (e as { hint?: string }).hint, e); /* else fall through to screencapture */ }
      }
      if (!captured) await execFileP('/usr/sbin/screencapture', ['-l', String(this.session.windowId), '-o', '-x', '-t', 'png', file], { timeout: 15_000 });
      let png = await readFile(file);
      if (png.length < 1000) throw new CaptureError('Window capture produced an empty image — Screen Recording permission is probably missing', 'Allow Screen Recording for the terminal/app running Bruno Capture in System Settings › Privacy & Security.');
      const dims = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
      if (scale === 'css' && dims.width > bounds.width && (await detectFFmpeg()).ffmpeg.available) {
        const resized = path.join(dir, 'window-css.png');
        await resizePng(file, resized, bounds.width, Math.round((dims.height * bounds.width) / dims.width));
        png = await readFile(resized);
      }
      return png;
    } catch (e) {
      if (e instanceof CaptureError) throw e;
      throw new CaptureError(`screencapture failed: ${String((e as Error).message).split('\n')[0]}`, 'Allow Screen Recording in System Settings › Privacy & Security, then recheck.', e);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
