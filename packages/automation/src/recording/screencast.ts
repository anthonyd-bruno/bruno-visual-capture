import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CDPSession, Page } from 'playwright';

export interface ScreencastOptions {
  /** Where JPEG frames are spooled (one file per frame). */
  dir: string;
  /** Bound the frame size to the CSS viewport so frames are CSS-pixel sized even on retina. */
  maxWidth: number;
  maxHeight: number;
  quality?: number;
}

export interface ScreencastFrame {
  file: string;
  /** CDP `metadata.timestamp` — seconds since epoch (wall clock). */
  t: number;
  index: number;
}

export interface ScreencastResult {
  frames: ScreencastFrame[];
  /** Wall-clock seconds; the encoder holds the first frame from here and the last frame until `stoppedAt`. */
  startedAt: number;
  stoppedAt: number;
}

interface FrameEvent { data: string; metadata: { timestamp?: number }; sessionId: number }

/**
 * Renderer recording via CDP `Page.startScreencast` (measured S3: change-driven frames, ~16 ms
 * median gap during motion, none while idle). Every frame is acked so Chromium keeps sending; the
 * FFmpeg step turns the timestamped frames into constant-frame-rate video (D9).
 */
export class ScreencastRecorder {
  private cdp?: CDPSession;
  private readonly frames: ScreencastFrame[] = [];
  private readonly writes: Promise<void>[] = [];
  private startedAt = 0;
  private started = false;

  constructor(private readonly page: Page, private readonly opts: ScreencastOptions) {}

  async start(): Promise<void> {
    if (this.started) throw new Error('screencast already started');
    this.started = true;
    await mkdir(this.opts.dir, { recursive: true });
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on('Page.screencastFrame', (f) => this.onFrame(f as FrameEvent));
    this.startedAt = Date.now() / 1000;
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg', quality: this.opts.quality ?? 85,
      maxWidth: Math.round(this.opts.maxWidth), maxHeight: Math.round(this.opts.maxHeight), everyNthFrame: 1,
    });
  }

  private onFrame(f: FrameEvent): void {
    const index = this.frames.length;
    const file = path.join(this.opts.dir, `f${String(index).padStart(6, '0')}.jpg`);
    this.frames.push({ file, t: f.metadata.timestamp ?? Date.now() / 1000, index });
    this.writes.push(writeFile(file, Buffer.from(f.data, 'base64')).catch(() => undefined));
    this.cdp?.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
  }

  get frameCount(): number { return this.frames.length; }

  async stop(): Promise<ScreencastResult> {
    const stoppedAt = Date.now() / 1000;
    if (this.cdp) {
      await this.cdp.send('Page.stopScreencast').catch(() => undefined);
      await this.cdp.detach().catch(() => undefined);
      this.cdp = undefined;
    }
    await Promise.all(this.writes);
    return { frames: [...this.frames], startedAt: this.startedAt, stoppedAt };
  }
}
