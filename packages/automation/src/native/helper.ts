import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export const HELPER_APP_NAME = 'Bruno Capture Helper.app';
export const HELPER_BUNDLE_ID = 'com.usebruno.capture.helper';
const HELPER_REL = path.join(HELPER_APP_NAME, 'Contents', 'MacOS', 'bru-capture-helper');

export interface HelperWindow {
  id: number;
  title: string;
  frame: { x: number; y: number; width: number; height: number };
  layer: number;
  onScreen: boolean;
  app: { bundleId: string; pid: number; name: string };
}

export class HelperError extends Error {
  constructor(public readonly code: string, message: string, public readonly hint?: string) { super(message); this.name = 'HelperError'; }
}

export interface RecordingHandle {
  /** Resolves once the helper wrote its first frame. */
  started: Promise<void>;
  stop(): Promise<{ file: string; frames: number; durationMs: number; width: number; height: number; scale: number }>;
}

const PERMISSION_HINT = 'Allow Screen Recording for the app that runs Bruno Capture (and the Bruno Capture Helper) in System Settings › Privacy & Security › Screen & System Audio Recording, then recheck.';

/** Default install/build locations, first hit wins; `BRU_CAPTURE_HELPER` overrides. */
export function helperCandidates(appSupportBinDir?: string): string[] {
  const out: string[] = [];
  if (process.env.BRU_CAPTURE_HELPER) out.push(process.env.BRU_CAPTURE_HELPER);
  out.push(path.join(appSupportBinDir ?? path.join(os.homedir(), 'Library', 'Application Support', 'Bruno Capture', 'bin'), HELPER_REL));
  out.push(fileURLToPath(new URL('../../../../native/macos-capture-helper/build/' + HELPER_REL, import.meta.url)));
  return out;
}

/**
 * Thin client for the ScreenCaptureKit helper (`native/macos-capture-helper`). One process per
 * command; `record` stays alive until told to stop on stdin. Output is line-delimited JSON.
 */
export class CaptureHelper {
  constructor(public readonly binary: string) {}

  static async locate(appSupportBinDir?: string): Promise<CaptureHelper | undefined> {
    for (const p of helperCandidates(appSupportBinDir)) {
      try { await access(p, constants.X_OK); return new CaptureHelper(p); } catch { /* next */ }
    }
    return undefined;
  }

  private async run(args: string[], timeoutMs = 20_000): Promise<Record<string, unknown>> {
    let stdout = '';
    try {
      ({ stdout } = await execFileP(this.binary, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }));
    } catch (e) {
      const err = e as { stdout?: string; message: string };
      stdout = err.stdout ?? '';
      if (!stdout.trim()) throw new HelperError('helper_failed', `helper ${args[0]} failed: ${err.message.split('\n')[0]}`);
    }
    const last = stdout.trim().split('\n').filter(Boolean).pop() ?? '{}';
    const obj = JSON.parse(last) as Record<string, unknown>;
    if (obj.ok === false) throw new HelperError(String(obj.code ?? 'helper_failed'), String(obj.message ?? 'helper failed'), obj.code === 'permission_denied' ? PERMISSION_HINT : undefined);
    return obj;
  }

  /** `CGPreflightScreenCaptureAccess` — never prompts. */
  async preflight(): Promise<boolean> { return Boolean((await this.run(['preflight'])).granted); }

  /** `CGRequestScreenCaptureAccess` — shows the macOS prompt if not yet granted. */
  async requestAccess(): Promise<boolean> { return Boolean((await this.run(['request'], 60_000)).granted); }

  async windows(filter: { bundleId?: string; pid?: number; onScreenOnly?: boolean } = {}): Promise<HelperWindow[]> {
    const args = ['windows'];
    if (filter.bundleId) args.push('--bundle', filter.bundleId);
    if (filter.pid) args.push('--pid', String(filter.pid));
    if (filter.onScreenOnly) args.push('--onscreen');
    return (await this.run(args)).windows as HelperWindow[];
  }

  async still(windowId: number, out: string): Promise<{ file: string; width: number; height: number; scale: number }> {
    const r = await this.run(['still', '--window', String(windowId), '--out', out], 30_000);
    return { file: String(r.file), width: Number(r.width), height: Number(r.height), scale: Number(r.scale) };
  }

  startRecording(windowId: number, out: string, fps = 30): RecordingHandle {
    const child: ChildProcess = spawn(this.binary, ['record', '--window', String(windowId), '--out', out, '--fps', String(fps)], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    let resolveStarted!: () => void; let rejectStarted!: (e: Error) => void;
    const started = new Promise<void>((res, rej) => { resolveStarted = res; rejectStarted = rej; });
    let resolveFinal!: (v: Record<string, unknown>) => void; let rejectFinal!: (e: Error) => void;
    const final = new Promise<Record<string, unknown>>((res, rej) => { resolveFinal = res; rejectFinal = rej; });
    let finished = false;
    const fail = (e: Error) => { if (!finished) { finished = true; rejectStarted(e); rejectFinal(e); } };
    child.stdout!.on('data', (d: Buffer) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let msg: Record<string, unknown>;
        try { msg = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
        if (msg.event === 'started') resolveStarted();
        if (msg.ok === true && 'frames' in msg) { finished = true; resolveStarted(); resolveFinal(msg); }
        if (msg.ok === false) fail(new HelperError(String(msg.code ?? 'helper_failed'), String(msg.message ?? 'recording failed'), msg.code === 'permission_denied' ? PERMISSION_HINT : undefined));
      }
    });
    child.on('error', (e) => fail(new HelperError('helper_failed', e.message)));
    child.on('exit', (code) => { if (!finished) fail(new HelperError('helper_exited', `helper exited with code ${code} before finishing`)); });
    // Guard against a recording that never sees a frame (e.g. window hidden).
    const startTimer = setTimeout(() => fail(new HelperError('no_frames', 'The native recorder produced no frames within 10 s', 'Is the Bruno window on screen and Screen Recording granted?')), 10_000);
    void started.then(() => clearTimeout(startTimer), () => clearTimeout(startTimer));
    return {
      started,
      stop: async () => {
        child.stdin?.write('stop\n');
        const timer = setTimeout(() => child.kill('SIGTERM'), 15_000);
        try {
          const r = await final;
          return { file: String(r.file), frames: Number(r.frames), durationMs: Number(r.durationMs), width: Number(r.width), height: Number(r.height), scale: Number(r.scale) };
        } finally { clearTimeout(timer); }
      },
    };
  }
}
