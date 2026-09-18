import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { detectFFmpeg, probeMedia, type MediaProbe } from './ffmpeg.js';

const execFileP = promisify(execFile);

export class MediaError extends Error {
  readonly code = 'media_failed';
  constructor(message: string, public readonly hint?: string, public readonly stderr?: string) { super(message); this.name = 'MediaError'; }
}

export interface FrameInput { file: string; t: number }
export interface CropRect { x: number; y: number; width: number; height: number }

export interface EncodeVideoOptions {
  frames: FrameInput[];
  /** Timeline start: the first frame is held from here (a pause before the first change is preserved). */
  startAt: number;
  /** Timeline end: the last frame is held until here (idle produces no frames). */
  stopAt: number;
  out: string;
  fps?: number;
  crop?: CropRect;
  /** Optional final size; the aspect ratio is preserved and the image padded to fit. */
  scale?: { width: number; height: number };
  ffmpegPath?: string;
  signal?: AbortSignal;
}

export interface EncodeResult { file: string; probe: MediaProbe }

async function ffmpegBinary(explicit?: string): Promise<{ ffmpeg: string; ffprobe?: string }> {
  if (explicit) return { ffmpeg: explicit };
  const s = await detectFFmpeg();
  if (!s.ffmpeg.available || !s.ffmpeg.path) throw new MediaError('FFmpeg is not available', 'Install with Homebrew: brew install ffmpeg');
  return { ffmpeg: s.ffmpeg.path, ffprobe: s.ffprobe.path };
}

async function runFFmpeg(bin: string, args: string[], signal?: AbortSignal): Promise<void> {
  try {
    await execFileP(bin, ['-hide_banner', '-nostdin', '-v', 'error', '-y', ...args], { maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60_000, signal });
  } catch (e) {
    const err = e as { stderr?: string; message: string; code?: string };
    if (err.code === 'ABORT_ERR') throw err;
    const tail = (err.stderr ?? err.message).trim().split('\n').slice(-6).join('\n');
    throw new MediaError(`ffmpeg failed: ${tail.split('\n')[0]}`, undefined, tail);
  }
}

/** Total timeline length in seconds — the first frame is held from `startAt`, the last until `stopAt`. */
export function timelineSeconds(frames: FrameInput[], startAt: number, stopAt: number, minDuration = 1 / 120): number {
  const t0 = Math.min(startAt, frames[0]?.t ?? startAt);
  const last = frames[frames.length - 1]?.t ?? startAt;
  return Math.max(stopAt, last + minDuration) - t0;
}

/**
 * concat demuxer list: `file` + `duration` per frame. The last file is repeated so the demuxer honours
 * the final duration; measured on ffmpeg 8 the repeat then *adds* a copy of that duration, so the
 * encoder always hard-trims with `-t timelineSeconds()`.
 */
export function buildConcatList(frames: FrameInput[], startAt: number, stopAt: number, minDuration = 1 / 120): string {
  if (frames.length === 0) throw new MediaError('No frames were recorded', 'Nothing changed on screen while recording, or the recording never started.');
  const lines: string[] = [];
  const esc = (p: string) => p.replace(/'/g, "'\\''");
  const t0 = Math.min(startAt, frames[0]!.t);
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!;
    const begin = i === 0 ? t0 : f.t;
    const end = i < frames.length - 1 ? frames[i + 1]!.t : Math.max(stopAt, f.t + minDuration);
    lines.push(`file '${esc(f.file)}'`, `duration ${Math.max(minDuration, end - begin).toFixed(6)}`);
  }
  lines.push(`file '${esc(frames[frames.length - 1]!.file)}'`);
  return lines.join('\n') + '\n';
}

function videoFilters(fps: number, crop?: CropRect, scale?: { width: number; height: number }): string {
  const vf: string[] = [];
  if (crop) vf.push(`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`);
  if (scale) vf.push(`scale=${scale.width}:${scale.height}:force_original_aspect_ratio=decrease:flags=lanczos`, `pad=${scale.width}:${scale.height}:(ow-iw)/2:(oh-ih)/2`);
  vf.push(`fps=${fps}`, 'scale=trunc(iw/2)*2:trunc(ih/2)*2', 'format=yuv420p');
  return vf.join(',');
}

/** PRD §49/§87: timestamped frames → MP4, H.264, constant 30 fps, no audio. */
export async function encodeFramesToMp4(opts: EncodeVideoOptions): Promise<EncodeResult> {
  const fps = opts.fps ?? 30;
  const { ffmpeg, ffprobe } = await ffmpegBinary(opts.ffmpegPath);
  await mkdir(path.dirname(opts.out), { recursive: true });
  const list = path.join(path.dirname(opts.out), `${path.basename(opts.out, path.extname(opts.out))}.concat.txt`);
  await writeFile(list, buildConcatList(opts.frames, opts.startAt, opts.stopAt), 'utf8');
  await runFFmpeg(ffmpeg, [
    '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', videoFilters(fps, opts.crop, opts.scale),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-r', String(fps), '-fps_mode', 'cfr', '-t', timelineSeconds(opts.frames, opts.startAt, opts.stopAt).toFixed(3),
    '-movflags', '+faststart', '-an', opts.out,
  ], opts.signal);
  return { file: opts.out, probe: await probeMedia(opts.out, ffprobe) };
}

export interface TranscodeOptions {
  input: string;
  out: string;
  fps?: number;
  crop?: CropRect;
  scale?: { width: number; height: number };
  ffmpegPath?: string;
  signal?: AbortSignal;
}

/** Native helper `.mov` (variable frame rate, retina-sized) → the same MP4 contract as the renderer path. */
export async function transcodeToMp4(opts: TranscodeOptions): Promise<EncodeResult> {
  const fps = opts.fps ?? 30;
  const { ffmpeg, ffprobe } = await ffmpegBinary(opts.ffmpegPath);
  await mkdir(path.dirname(opts.out), { recursive: true });
  await runFFmpeg(ffmpeg, [
    '-i', opts.input,
    '-vf', videoFilters(fps, opts.crop, opts.scale),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-r', String(fps), '-fps_mode', 'cfr', '-movflags', '+faststart', '-an', opts.out,
  ], opts.signal);
  return { file: opts.out, probe: await probeMedia(opts.out, ffprobe) };
}

export interface GifOptions {
  input: string;
  out: string;
  /** PRD §88 / D6: readability over frame rate. */
  fps?: number;
  /** Output width in px; height follows the aspect ratio (PRD §54 Docs GIF). */
  width?: number;
  ffmpegPath?: string;
  signal?: AbortSignal;
}

/** PRD §51/§88: proper palette generation, never naive frame conversion. */
export async function mp4ToGif(opts: GifOptions): Promise<EncodeResult> {
  const fps = opts.fps ?? 15;
  const { ffmpeg, ffprobe } = await ffmpegBinary(opts.ffmpegPath);
  await mkdir(path.dirname(opts.out), { recursive: true });
  const pre = [`fps=${fps}`, ...(opts.width ? [`scale=${opts.width}:-2:flags=lanczos`] : [])].join(',');
  const vf = `${pre},split[a][b];[a]palettegen=stats_mode=diff:max_colors=256[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
  await runFFmpeg(ffmpeg, ['-i', opts.input, '-vf', vf, '-loop', '0', '-an', opts.out], opts.signal);
  return { file: opts.out, probe: await probeMedia(opts.out, ffprobe) };
}

/** Grab one PNG frame (thumbnails, tests). */
export async function extractFrame(input: string, out: string, atSeconds = 0, ffmpegPath?: string): Promise<string> {
  const { ffmpeg } = await ffmpegBinary(ffmpegPath);
  await mkdir(path.dirname(out), { recursive: true });
  await runFFmpeg(ffmpeg, ['-ss', String(atSeconds), '-i', input, '-frames:v', '1', out]);
  return out;
}

/** Synthetic frames for tests: `count` JPEGs of a moving test pattern. */
export async function generateTestFrames(dir: string, count: number, width = 320, height = 200, ffmpegPath?: string): Promise<string[]> {
  const { ffmpeg } = await ffmpegBinary(ffmpegPath);
  await mkdir(dir, { recursive: true });
  await runFFmpeg(ffmpeg, ['-f', 'lavfi', '-i', `testsrc=size=${width}x${height}:rate=10`, '-frames:v', String(count), '-q:v', '3', path.join(dir, 'f%06d.jpg')]);
  return Array.from({ length: count }, (_, i) => path.join(dir, `f${String(i + 1).padStart(6, '0')}.jpg`));
}
