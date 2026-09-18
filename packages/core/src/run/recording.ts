import path from 'node:path';
import { ScreencastRecorder, resolveTarget, type BrunoSession, type ScreencastResult } from '@bruno-capture/automation';
import type { RecordingController } from './executor.js';

export interface CropRect { x: number; y: number; width: number; height: number }

export interface RecordingSegment extends ScreencastResult {
  /** CSS-pixel crop applied at encode time for region/locator framing (PRD §57, fixed per segment). */
  crop?: CropRect;
  framing: string;
}

export class RecordingError extends Error {
  readonly code = 'recording_failed';
  constructor(message: string, public readonly hint?: string) { super(message); this.name = 'RecordingError'; }
}

/**
 * App Content Only recording of the Bruno renderer. Frames are bounded to the CSS viewport, so a
 * region's `boundingBox()` (CSS px) is directly the crop rectangle. Full App Window recording is the
 * native helper's job and is refused here with a clear message.
 */
export class RendererRecordingController implements RecordingController {
  private recorder?: ScreencastRecorder;
  private current?: { crop?: CropRect; framing: string };
  private readonly done: RecordingSegment[] = [];
  private seq = 0;

  constructor(
    private readonly session: BrunoSession,
    private readonly opts: { framesRoot: string; viewport: { width: number; height: number }; log?: (m: string) => void },
  ) {}

  async start(target: { framing: string; region?: string; locator?: string }): Promise<void> {
    if (this.recorder) throw new RecordingError('Recording is already in progress (only one bounded section per workflow in MVP)');
    if (target.framing === 'full-window') throw new RecordingError('Full App Window recording needs the native capture helper (Phase 5b); use App Content Only or a region for now.');
    let crop: CropRect | undefined;
    if (target.framing === 'region' || target.framing === 'locator' || target.region || target.locator) {
      const loc = resolveTarget(this.session.page, { region: target.region, locator: target.locator });
      await loc.waitFor({ state: 'visible', timeout: 10_000 });
      const box = await loc.boundingBox();
      if (!box) throw new RecordingError('Recording target has no bounding box (is it visible?)');
      const vw = this.opts.viewport.width, vh = this.opts.viewport.height;
      const x = Math.max(0, Math.floor(box.x)), y = Math.max(0, Math.floor(box.y));
      crop = { x, y, width: Math.min(vw - x, Math.ceil(box.width)), height: Math.min(vh - y, Math.ceil(box.height)) };
    }
    const dir = path.join(this.opts.framesRoot, `segment-${this.seq++}`);
    this.recorder = new ScreencastRecorder(this.session.page, { dir, maxWidth: this.opts.viewport.width, maxHeight: this.opts.viewport.height });
    this.current = { crop, framing: target.framing };
    await this.recorder.start();
    this.opts.log?.(`recording started (${target.framing}${crop ? ` crop ${crop.width}×${crop.height}@${crop.x},${crop.y}` : ''})`);
  }

  async stop(): Promise<{ frames: number }> {
    if (!this.recorder) return { frames: 0 };
    const result = await this.recorder.stop();
    const seg: RecordingSegment = { ...result, crop: this.current?.crop, framing: this.current?.framing ?? 'app-content' };
    this.done.push(seg);
    this.recorder = undefined; this.current = undefined;
    this.opts.log?.(`recording stopped: ${result.frames.length} frames over ${(result.stoppedAt - result.startedAt).toFixed(1)} s`);
    return { frames: result.frames.length };
  }

  isRecording(): boolean { return Boolean(this.recorder); }
  segments(): RecordingSegment[] { return [...this.done]; }
}
