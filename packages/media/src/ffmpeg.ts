import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface ToolStatus {
  available: boolean;
  path?: string;
  version?: string;
  error?: string;
}

export interface FFmpegStatus {
  ffmpeg: ToolStatus;
  ffprobe: ToolStatus;
}

/**
 * GUI-launched processes often get a minimal PATH, so look in the usual Homebrew/MacPorts spots
 * too. First hit wins; `BRU_CAPTURE_FFMPEG` / `BRU_CAPTURE_FFPROBE` override everything.
 */
const FALLBACK_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin'];

async function locate(tool: 'ffmpeg' | 'ffprobe'): Promise<string | undefined> {
  const override = process.env[`BRU_CAPTURE_${tool.toUpperCase()}`];
  if (override) return override;
  try {
    const { stdout } = await execFileP('/usr/bin/which', [tool]);
    if (stdout.trim()) return stdout.trim();
  } catch { /* not on PATH */ }
  for (const dir of FALLBACK_DIRS) {
    const p = `${dir}/${tool}`;
    try { await access(p, constants.X_OK); return p; } catch { /* next */ }
  }
  return undefined;
}

async function describe(tool: 'ffmpeg' | 'ffprobe'): Promise<ToolStatus> {
  const p = await locate(tool);
  if (!p) return { available: false, error: `${tool} not found on PATH or in ${FALLBACK_DIRS.join(', ')}` };
  try {
    const { stdout } = await execFileP(p, ['-version'], { timeout: 10_000 });
    const m = new RegExp(`^${tool} version (\\S+)`).exec(stdout);
    return { available: true, path: p, version: m?.[1] };
  } catch (e) {
    return { available: false, path: p, error: `${tool} -version failed: ${(e as Error).message}` };
  }
}

/** PRD §62: `ffmpeg -version` at startup; both tools are required for video/GIF processing. */
export async function detectFFmpeg(): Promise<FFmpegStatus> {
  const [ffmpeg, ffprobe] = await Promise.all([describe('ffmpeg'), describe('ffprobe')]);
  return { ffmpeg, ffprobe };
}

export interface MediaProbe {
  bytes: number;
  durationMs?: number;
  width?: number;
  height?: number;
  codec?: string;
  fps?: number;
  hasAudio: boolean;
  /** Container/format name from ffprobe, e.g. `mov,mp4,m4a,3gp,3g2,mj2`, `gif`, `png_pipe`. */
  format?: string;
}

function parseRate(r: string | undefined): number | undefined {
  if (!r) return undefined;
  const [n, d] = r.split('/').map(Number);
  if (!n || !Number.isFinite(n)) return undefined;
  return d ? n / d : n;
}

/** Metadata inspection for media tests and manifests (PRD §99 Media Tests) — never subjective. */
export async function probeMedia(file: string, ffprobePath?: string): Promise<MediaProbe> {
  const bin = ffprobePath ?? (await locate('ffprobe'));
  if (!bin) throw new Error('ffprobe is not available');
  const { stdout } = await execFileP(bin, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { timeout: 30_000 });
  const json = JSON.parse(stdout) as {
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string }>;
    format?: { duration?: string; size?: string; format_name?: string };
  };
  const video = json.streams?.find((s) => s.codec_type === 'video');
  const duration = json.format?.duration ? Number(json.format.duration) : undefined;
  return {
    bytes: Number(json.format?.size ?? 0),
    durationMs: duration !== undefined && Number.isFinite(duration) ? Math.round(duration * 1000) : undefined,
    width: video?.width,
    height: video?.height,
    codec: video?.codec_name,
    fps: parseRate(video?.avg_frame_rate) ?? parseRate(video?.r_frame_rate),
    hasAudio: Boolean(json.streams?.some((s) => s.codec_type === 'audio')),
    format: json.format?.format_name,
  };
}
