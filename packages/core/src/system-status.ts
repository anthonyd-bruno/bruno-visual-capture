import { execFile } from 'node:child_process';
import { access, constants, mkdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describeBrunoExecutable, discoverBruno, type BrunoCandidate } from '@bruno-capture/automation';
import { detectFFmpeg, type FFmpegStatus } from '@bruno-capture/media';
import type { ComponentStatus, Settings, SystemStatus } from '@bruno-capture/shared';
import type { AppPaths } from './paths.js';

const execFileP = promisify(execFile);

export interface SystemStatusDeps {
  settings: Settings;
  paths: AppPaths;
  /** Whether a key is available (env var or Keychain). Never the key itself. */
  aiKeys: { openai: boolean; anthropic: boolean };
  workflowRegistry?: { total: number; invalid: number };
  /** Native helper preflight; absent until Phase 5 installs the helper. */
  screenRecording?: () => Promise<'granted' | 'denied' | 'helper-missing'>;
}

export interface DisplayInfo { width: number; height: number; scale?: number }

/** Largest display "UI looks like" size via system_profiler; undefined when it cannot be parsed. */
export async function primaryDisplay(): Promise<DisplayInfo | undefined> {
  try {
    const { stdout } = await execFileP('/usr/sbin/system_profiler', ['SPDisplaysDataType', '-json'], { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 });
    const json = JSON.parse(stdout) as { SPDisplaysDataType?: Array<{ spdisplays_ndrvs?: Array<Record<string, string>> }> };
    const displays = json.SPDisplaysDataType?.flatMap((g) => g.spdisplays_ndrvs ?? []) ?? [];
    const main = displays.find((d) => d['spdisplays_main'] === 'spdisplays_yes') ?? displays[0];
    if (!main) return undefined;
    const res = main['_spdisplays_resolution'] ?? '';
    const looks = /UI Looks like:\s*(\d+)\s*x\s*(\d+)/i.exec(res);
    const raw = /(\d+)\s*x\s*(\d+)/.exec(res);
    const m = looks ?? raw;
    if (!m) return undefined;
    const width = Number(m[1]), height = Number(m[2]);
    const px = /(\d+)\s*x\s*(\d+)/.exec(main['_spdisplays_pixels'] ?? '');
    const scale = px && looks ? Math.round((Number(px[1]) / width) * 100) / 100 : undefined;
    return { width, height, scale };
  } catch {
    return undefined;
  }
}

export async function resolveBruno(settings: Settings): Promise<{ candidate?: BrunoCandidate; error?: string }> {
  if (settings.bruno.executablePath) {
    try { return { candidate: await describeBrunoExecutable(settings.bruno.executablePath) }; }
    catch (e) { return { error: (e as Error).message }; }
  }
  const found = await discoverBruno();
  return found[0] ? { candidate: found[0] } : {};
}

function brunoStatus(r: { candidate?: BrunoCandidate; error?: string }): ComponentStatus {
  if (r.candidate) {
    const c = r.candidate;
    return { id: 'bruno', label: 'Bruno', state: 'ready', detail: `${c.appPath ? 'Bruno.app' : 'executable'}${c.version ? ` ${c.version}` : ''} — ${c.appPath ?? c.executablePath}` };
  }
  if (r.error) return { id: 'bruno', label: 'Bruno', state: 'error', detail: r.error, remediation: 'Choose a valid Bruno.app or development executable in Settings › Bruno.' };
  return { id: 'bruno', label: 'Bruno', state: 'not-configured', detail: 'Not found in /Applications or ~/Applications', remediation: 'Install Bruno or choose the application in Settings › Bruno.', action: { label: 'Download Bruno', url: 'https://www.usebruno.com/downloads' } };
}

function ffmpegStatus(f: FFmpegStatus): ComponentStatus {
  if (f.ffmpeg.available && f.ffprobe.available)
    return { id: 'ffmpeg', label: 'FFmpeg', state: 'ready', detail: `ffmpeg ${f.ffmpeg.version ?? '?'} — ${f.ffmpeg.path}` };
  return {
    id: 'ffmpeg', label: 'FFmpeg', state: 'unavailable',
    detail: f.ffmpeg.available ? 'ffprobe missing' : (f.ffmpeg.error ?? 'not found'),
    remediation: 'Install with Homebrew: brew install ffmpeg. Screenshots still work; MP4 and GIF output are disabled until FFmpeg is available.',
    action: { label: 'FFmpeg for macOS', url: 'https://ffmpeg.org/download.html#build-mac' },
  };
}

async function dirStatus(dir: string): Promise<ComponentStatus> {
  try {
    await mkdir(dir, { recursive: true });
    await access(dir, constants.W_OK);
    return { id: 'artifactDirectory', label: 'Artifact Directory', state: 'ready', detail: dir };
  } catch (e) {
    return { id: 'artifactDirectory', label: 'Artifact Directory', state: 'error', detail: `${dir}: ${(e as Error).message}`, remediation: 'Choose a writable artifact directory in Settings › Capture.' };
  }
}

function aiStatus(id: 'openai' | 'anthropic', label: string, hasKey: boolean, model: string): ComponentStatus {
  if (hasKey && model) return { id, label, state: 'ready', detail: model };
  if (!hasKey) return { id, label, state: 'not-configured', detail: 'No API key', remediation: `Add an ${label} API key in Settings › AI (stored in macOS Keychain) or set ${id.toUpperCase()}_API_KEY.` };
  return { id, label, state: 'not-configured', detail: 'No model configured', remediation: `Choose a model in Settings › AI.` };
}

/** PRD §83 — every component reports independently; the app launches regardless. */
export async function checkSystemStatus(deps: SystemStatusDeps): Promise<SystemStatus> {
  const [bruno, ffmpeg, artifacts, display, sr] = await Promise.all([
    resolveBruno(deps.settings).then(brunoStatus),
    detectFFmpeg().then(ffmpegStatus),
    dirStatus(deps.settings.capture.artifactRoot ?? deps.paths.artifactsDir),
    primaryDisplay(),
    deps.screenRecording ? deps.screenRecording() : Promise.resolve('helper-missing' as const),
  ]);

  const screenRecording: ComponentStatus =
    sr === 'granted' ? { id: 'screenRecording', label: 'Screen Recording', state: 'ready' }
    : sr === 'denied' ? { id: 'screenRecording', label: 'Screen Recording', state: 'action-required', detail: 'Permission not granted', remediation: 'Allow Bruno Capture Helper under System Settings › Privacy & Security › Screen & System Audio Recording.', action: { label: 'Open System Settings', url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture' } }
    : { id: 'screenRecording', label: 'Screen Recording', state: 'unavailable', detail: 'Native capture helper not installed', remediation: 'Full App Window capture needs the native helper; App Content Only capture works without it.' };

  const displayStatus: ComponentStatus = display
    ? { id: 'display', label: 'Display', state: display.width >= 1920 && display.height >= 1080 + 28 ? 'ready' : 'action-required', detail: `${display.width} × ${display.height} pt${display.scale ? ` @${display.scale}x` : ''}`, remediation: display.width >= 1920 && display.height >= 1108 ? undefined : 'Presets larger than the display (e.g. 1920 × 1080) will be clamped by macOS; use Docs Screenshot (1600 × 1000) or a larger display.' }
    : { id: 'display', label: 'Display', state: 'ready', detail: 'size unknown (checked again at launch)' };

  const openai = aiStatus('openai', 'OpenAI', deps.aiKeys.openai, deps.settings.ai.openai.model);
  const anthropic = aiStatus('anthropic', 'Anthropic', deps.aiKeys.anthropic, deps.settings.ai.anthropic.model);

  const reg = deps.workflowRegistry;
  const workflowRegistry: ComponentStatus = !reg
    ? { id: 'workflowRegistry', label: 'Workflow Registry', state: 'not-configured', detail: 'not loaded' }
    : reg.total === 0
      ? { id: 'workflowRegistry', label: 'Workflow Registry', state: 'error', detail: 'no workflows loaded', remediation: 'Built-in workflows should always load — reinstall Bruno Capture.' }
      : { id: 'workflowRegistry', label: 'Workflow Registry', state: reg.invalid ? 'action-required' : 'ready', detail: `${reg.total} workflows${reg.invalid ? `, ${reg.invalid} invalid` : ''}`, remediation: reg.invalid ? 'Open Workflows to see validation errors.' : undefined };

  const components = [bruno, ffmpeg, screenRecording, artifacts, displayStatus, openai, anthropic, workflowRegistry]
    .map((c) => Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) as ComponentStatus);
  const ready = (id: ComponentStatus['id']) => components.find((c) => c.id === id)?.state === 'ready';
  return {
    checkedAt: new Date().toISOString(),
    components,
    capabilities: {
      screenshots: ready('bruno'),
      fullWindowCapture: ready('bruno') && ready('screenRecording'),
      video: ready('bruno') && ready('ffmpeg'),
      gif: ready('bruno') && ready('ffmpeg'),
      aiPlanning: ready('openai') || ready('anthropic'),
    },
  };
}
