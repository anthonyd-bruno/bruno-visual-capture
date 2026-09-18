import { mkdir } from 'node:fs/promises';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { findRunningBruno, quitBrunoGracefully, type RunningBruno } from './discovery.js';

export type ProfileMode = 'user' | 'capture';

export interface LaunchBrunoOptions {
  executablePath: string;
  /** Development builds: extra argv, e.g. the app directory for a bare Electron binary (PRD §21). */
  args?: string[];
  profileMode: ProfileMode;
  /** Capture mode: passed as `--user-data-dir` (measured S6: isolates userData on the packaged app). */
  captureProfileDir?: string;
  /** User-profile mode only: what to do when the user's Bruno is already running (PRD §22). */
  existingInstance?: 'fail' | 'quit-and-relaunch';
  timeoutMs?: number;
  signal?: AbortSignal;
  log?: (message: string) => void;
}

export interface BrunoSession {
  mode: 'electron';
  app: ElectronApplication;
  page: Page;
  executablePath: string;
  version?: string;
  electronVersion?: string;
  chromeVersion?: string;
  pid?: number;
  profileMode: ProfileMode;
  userDataPath?: string;
  /** CGWindowID from `BrowserWindow#getMediaSourceId()` — what native capture targets. */
  windowId?: number;
  close(): Promise<void>;
}

export class BrunoAlreadyRunningError extends Error {
  readonly code = 'bruno_already_running';
  constructor(public readonly running: RunningBruno[]) {
    super(`Bruno is already running (pid ${running.map((r) => r.pid).join(', ')}) without automation access — it must be relaunched to enable capture`);
    this.name = 'BrunoAlreadyRunningError';
  }
}

export class BrunoLaunchError extends Error {
  readonly code = 'bruno_launch_failed';
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = 'BrunoLaunchError';
  }
}

/** Something that is on screen once Bruno's renderer is usable, whatever the workspace state. */
export const APP_SHELL_LOCATOR = '[data-testid="sidebar"], [data-testid="workspace-menu"], [data-testid="onboarding-create-collection"]';

const firstLine = (e: unknown) => String((e as Error)?.message ?? e).split('\n')[0];

/**
 * Launch Bruno under Playwright's Electron driver (measured S1: works on the signed app; one
 * first-launch race observed → single retry). Capture mode never touches the user's instance.
 */
export async function launchBruno(opts: LaunchBrunoOptions): Promise<BrunoSession> {
  const log = opts.log ?? (() => undefined);
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  const args = [...(opts.args ?? [])];
  let userDataPath: string | undefined;

  if (opts.profileMode === 'capture') {
    if (!opts.captureProfileDir) throw new BrunoLaunchError('captureProfileDir is required for profileMode "capture"');
    await mkdir(opts.captureProfileDir, { recursive: true });
    args.push(`--user-data-dir=${opts.captureProfileDir}`);
    userDataPath = opts.captureProfileDir;
  } else {
    const running = await findRunningBruno();
    if (running.length > 0) {
      if (opts.existingInstance !== 'quit-and-relaunch') throw new BrunoAlreadyRunningError(running);
      log(`Bruno already running (pid ${running.map((r) => r.pid).join(', ')}); asking it to quit`);
      if (!(await quitBrunoGracefully(15_000))) throw new BrunoLaunchError('Bruno did not quit within 15 s; close it manually and retry');
    }
  }

  let app: ElectronApplication | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2 && !app; attempt++) {
    opts.signal?.throwIfAborted();
    try {
      app = await electron.launch({ executablePath: opts.executablePath, args, env, timeout: timeoutMs });
    } catch (e) {
      lastError = e;
      log(`launch attempt ${attempt} failed: ${firstLine(e)}`);
      await new Promise((r) => setTimeout(r, 750));
    }
  }
  if (!app) throw new BrunoLaunchError(`Could not launch Bruno at ${opts.executablePath}: ${firstLine(lastError)}`, lastError);

  try {
    const page = await app.firstWindow({ timeout: timeoutMs });
    await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs });
    await page.locator(APP_SHELL_LOCATOR).first().waitFor({ state: 'visible', timeout: timeoutMs });
    const info = await app.evaluate(({ app: electronApp, BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return {
        version: electronApp.getVersion() as string,
        userData: electronApp.getPath('userData') as string,
        electron: process.versions.electron as string | undefined,
        chrome: process.versions.chrome as string | undefined,
        pid: process.pid as number,
        mediaSourceId: (w?.getMediaSourceId() ?? '') as string,
      };
    });
    const windowId = Number(/^window:(\d+):/.exec(info.mediaSourceId)?.[1]);
    if (opts.profileMode === 'capture' && info.userData !== opts.captureProfileDir)
      throw new BrunoLaunchError(`Capture profile was not applied: userData is ${info.userData}, expected ${opts.captureProfileDir}`);
    log(`Bruno ${info.version} (Electron ${info.electron ?? '?'}) pid ${info.pid}; userData ${info.userData}`);
    return {
      mode: 'electron', app, page,
      executablePath: opts.executablePath,
      version: info.version, electronVersion: info.electron, chromeVersion: info.chrome, pid: info.pid,
      profileMode: opts.profileMode,
      userDataPath: info.userData ?? userDataPath,
      windowId: Number.isFinite(windowId) ? windowId : undefined,
      close: () => app!.close(),
    };
  } catch (e) {
    await app.close().catch(() => undefined);
    throw new BrunoLaunchError(`Bruno launched but its window did not become ready: ${firstLine(e)}`, e);
  }
}

export interface ContentSize { width: number; height: number; x?: number; y?: number }
export interface GeometryResult {
  requested: ContentSize;
  actual: { width: number; height: number };
  devicePixelRatio: number;
  workArea: { width: number; height: number };
}

export class GeometryError extends Error {
  readonly code = 'geometry_unsatisfied';
  constructor(public readonly result: GeometryResult) {
    super(`Bruno window could not be sized to ${result.requested.width}×${result.requested.height} (got ${result.actual.width}×${result.actual.height}; display work area ${result.workArea.width}×${result.workArea.height})`);
    this.name = 'GeometryError';
  }
}

/**
 * S2 rule: every framing resizes the real window. Verifies the renderer viewport actually matches
 * (macOS clamps windows to the work area) and throws a GeometryError with the real numbers instead
 * of silently producing a wrong-size artifact.
 */
export async function setContentSize(session: BrunoSession, size: ContentSize): Promise<GeometryResult> {
  const workArea = await session.app.evaluate(({ BrowserWindow, screen }, s) => {
    const w = BrowserWindow.getAllWindows()[0];
    const cur = w.getContentBounds();
    w.setContentBounds({ x: s.x ?? cur.x, y: s.y ?? cur.y, width: s.width, height: s.height }, false);
    const wa = screen.getPrimaryDisplay().workAreaSize;
    return { width: wa.width as number, height: wa.height as number };
  }, size);
  const deadline = Date.now() + 3000;
  let actual = { width: 0, height: 0, dpr: 1 };
  while (Date.now() < deadline) {
    actual = await session.page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio }));
    if (actual.width === size.width && actual.height === size.height) break;
    await session.page.waitForTimeout(100);
  }
  const result: GeometryResult = { requested: size, actual: { width: actual.width, height: actual.height }, devicePixelRatio: actual.dpr, workArea };
  if (actual.width !== size.width || actual.height !== size.height) throw new GeometryError(result);
  return result;
}

export type BrunoTheme = 'light' | 'dark' | 'system';

export async function readTheme(page: Page): Promise<{ applied: string; stored: BrunoTheme | undefined }> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('bruno.theme');
    let stored: string | undefined;
    try { stored = raw ? (JSON.parse(raw) as string) : undefined; } catch { stored = undefined; }
    return { applied: document.documentElement.className, stored: stored as 'light' | 'dark' | 'system' | undefined };
  });
}

export class ThemeError extends Error {
  readonly code = 'theme_unsatisfied';
  constructor(message: string) { super(message); this.name = 'ThemeError'; }
}

/**
 * D3 (measured S5c): Bruno reads its theme from renderer localStorage `bruno.theme` on load. Write
 * it, reload, wait for the shell, and assert `html.class` — the postcondition workflows depend on.
 */
export async function setTheme(session: BrunoSession, theme: 'light' | 'dark', timeoutMs = 20_000): Promise<void> {
  const before = await readTheme(session.page);
  if (before.applied.split(/\s+/).includes(theme) && before.stored === theme) return;
  await session.page.evaluate((t) => localStorage.setItem('bruno.theme', JSON.stringify(t)), theme);
  await session.page.reload({ waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await session.page.locator(APP_SHELL_LOCATOR).first().waitFor({ state: 'visible', timeout: timeoutMs });
  const after = await readTheme(session.page);
  if (!after.applied.split(/\s+/).includes(theme)) {
    throw new ThemeError(`Theme did not apply: wanted "${theme}", html.class is "${after.applied}" (bruno.theme=${after.stored ?? 'unset'})`);
  }
}
