import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { resolveTarget, type BrunoSession } from '@bruno-capture/automation';
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
  constructor(private readonly session: BrunoSession) {}

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
          return await this.fullWindow();
      }
    } catch (e) {
      if (e instanceof CaptureError) throw e;
      throw new CaptureError(`Screenshot failed (${req.framing}${req.region ? ' ' + req.region : ''}): ${String((e as Error).message).split('\n')[0]}`, undefined, e);
    }
  }

  private async fullWindow(): Promise<Buffer> {
    if (!this.session.windowId) throw new CaptureError('Full App Window capture needs the Bruno window id, which is only available in Electron mode.');
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bru-capture-win-'));
    const file = path.join(dir, 'window.png');
    try {
      await this.session.app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus(); });
      await this.session.page.waitForTimeout(150);
      await execFileP('/usr/sbin/screencapture', ['-l', String(this.session.windowId), '-o', '-x', '-t', 'png', file], { timeout: 15_000 });
      const png = await readFile(file);
      if (png.length < 1000) throw new CaptureError('screencapture produced an empty image — Screen Recording permission is probably missing', 'Allow Screen Recording for the terminal/app running Bruno Capture in System Settings › Privacy & Security.');
      return png;
    } catch (e) {
      if (e instanceof CaptureError) throw e;
      throw new CaptureError(`screencapture failed: ${String((e as Error).message).split('\n')[0]}`, 'Allow Screen Recording in System Settings › Privacy & Security, then recheck.', e);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
