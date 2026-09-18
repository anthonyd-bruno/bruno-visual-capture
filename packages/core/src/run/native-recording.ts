import path from 'node:path';
import type { BrunoSession, CaptureHelper, RecordingHandle } from '@bruno-capture/automation';
import type { RecordingController } from './executor.js';
import { RecordingError } from './recording.js';

export interface NativeSegment {
  file: string;
  frames: number;
  durationMs: number;
  width: number;
  height: number;
  scale: number;
  startedAt: number;
  stoppedAt: number;
}

/**
 * Full App Window recording through the ScreenCaptureKit helper (PRD §49/§61). The helper targets
 * Bruno's CGWindowID (from `getMediaSourceId()`), so unrelated windows are never in frame. Output is
 * a retina-sized VFR `.mov` that the processing step normalises with `transcodeToMp4`.
 */
export class NativeRecordingController implements RecordingController {
  private handle?: RecordingHandle;
  private startedAt = 0;
  private readonly done: NativeSegment[] = [];
  private seq = 0;

  constructor(
    private readonly session: BrunoSession,
    private readonly helper: CaptureHelper,
    private readonly opts: { framesRoot: string; fps?: number; log?: (m: string) => void },
  ) {}

  async start(target: { framing: string; region?: string; locator?: string }): Promise<void> {
    if (this.handle) throw new RecordingError('Recording is already in progress');
    if (target.framing !== 'full-window') throw new RecordingError(`Native recorder only handles full-window framing (got ${target.framing})`);
    if (!this.session.windowId) throw new RecordingError('Bruno window id unavailable (Electron mode required for Full App Window recording)');
    await this.session.app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus(); }).catch(() => undefined);
    const out = path.join(this.opts.framesRoot, `native-${this.seq++}.mov`);
    this.handle = this.helper.startRecording(this.session.windowId, out, this.opts.fps ?? 30);
    this.startedAt = Date.now() / 1000;
    await this.handle.started;
    this.opts.log?.(`native recording started (window ${this.session.windowId})`);
  }

  async stop(): Promise<{ frames: number }> {
    if (!this.handle) return { frames: 0 };
    const r = await this.handle.stop();
    const seg: NativeSegment = { ...r, startedAt: this.startedAt, stoppedAt: Date.now() / 1000 };
    this.done.push(seg);
    this.handle = undefined;
    this.opts.log?.(`native recording stopped: ${r.frames} frames, ${(r.durationMs / 1000).toFixed(1)} s, ${r.width}×${r.height}`);
    return { frames: r.frames };
  }

  segments(): NativeSegment[] { return [...this.done]; }
}
