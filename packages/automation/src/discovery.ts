import { execFile } from 'node:child_process';
import { access, constants, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export type BrunoSource = 'applications' | 'user-applications' | 'manual';

export interface BrunoCandidate {
  /** `/Applications/Bruno.app` when known; absent for a bare development executable. */
  appPath?: string;
  /** The Mach-O binary Playwright launches. */
  executablePath: string;
  version?: string;
  bundleId?: string;
  source: BrunoSource;
}

const KNOWN_APP_LOCATIONS: ReadonlyArray<{ appPath: string; source: BrunoSource }> = [
  { appPath: '/Applications/Bruno.app', source: 'applications' },
  { appPath: path.join(os.homedir(), 'Applications', 'Bruno.app'), source: 'user-applications' },
];

async function exists(p: string, mode = constants.F_OK): Promise<boolean> {
  try { await access(p, mode); return true; } catch { return false; }
}

interface InfoPlist { CFBundleShortVersionString?: string; CFBundleVersion?: string; CFBundleIdentifier?: string; CFBundleExecutable?: string }

/** Reads `Contents/Info.plist` via `plutil` — works before launch and in CDP mode (D2). */
export async function readInfoPlist(appPath: string): Promise<InfoPlist> {
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  if (!(await exists(plist))) return {};
  try {
    const { stdout } = await execFileP('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist], { maxBuffer: 4 * 1024 * 1024 });
    const json = JSON.parse(stdout) as Record<string, unknown>;
    const pick = (k: keyof InfoPlist) => (typeof json[k] === 'string' ? (json[k] as string) : undefined);
    return { CFBundleShortVersionString: pick('CFBundleShortVersionString'), CFBundleVersion: pick('CFBundleVersion'), CFBundleIdentifier: pick('CFBundleIdentifier'), CFBundleExecutable: pick('CFBundleExecutable') };
  } catch {
    return {};
  }
}

/** Finds the enclosing `.app` bundle of a path inside one, if any. */
export function appBundleOf(p: string): string | undefined {
  let cur = path.resolve(p);
  while (cur !== path.dirname(cur)) {
    if (cur.endsWith('.app')) return cur;
    cur = path.dirname(cur);
  }
  return undefined;
}

/**
 * Describe whatever the user pointed at: a `.app` bundle, the executable inside one, or a bare
 * development executable (PRD §21). Throws when nothing runnable is there.
 */
export async function describeBrunoExecutable(input: string, source: BrunoSource = 'manual'): Promise<BrunoCandidate> {
  const resolved = path.resolve(input.replace(/^~(?=\/|$)/, os.homedir()));
  const info = await stat(resolved).catch(() => undefined);
  if (!info) throw new Error(`Bruno not found at ${resolved}`);

  const appPath = info.isDirectory() && resolved.endsWith('.app') ? resolved : appBundleOf(resolved);
  if (appPath) {
    const plist = await readInfoPlist(appPath);
    const executablePath = info.isDirectory()
      ? path.join(appPath, 'Contents', 'MacOS', plist.CFBundleExecutable ?? 'Bruno')
      : resolved;
    if (!(await exists(executablePath, constants.X_OK))) throw new Error(`No executable at ${executablePath}`);
    return { appPath, executablePath, version: plist.CFBundleShortVersionString, bundleId: plist.CFBundleIdentifier, source };
  }
  if (info.isDirectory()) throw new Error(`${resolved} is a directory, not a .app bundle or executable`);
  if (!(await exists(resolved, constants.X_OK))) throw new Error(`${resolved} is not executable`);
  return { executablePath: resolved, source };
}

/** Inspect the common macOS locations (PRD §21). Never throws; returns what is installed. */
export async function discoverBruno(): Promise<BrunoCandidate[]> {
  const found: BrunoCandidate[] = [];
  for (const { appPath, source } of KNOWN_APP_LOCATIONS) {
    if (!(await exists(appPath))) continue;
    try { found.push(await describeBrunoExecutable(appPath, source)); } catch { /* not a runnable bundle */ }
  }
  return found;
}

export interface RunningBruno { pid: number; command: string; executablePath: string }

/**
 * Main Bruno processes (helpers carry `--type=`). Uses `ps` rather than `pgrep -f` so our own
 * command line can never match itself.
 */
export async function findRunningBruno(): Promise<RunningBruno[]> {
  const { stdout } = await execFileP('/bin/ps', ['-axo', 'pid=,command=']);
  const out: RunningBruno[] = [];
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const command = m[2]!;
    if (!/\/Contents\/MacOS\/Bruno(\s|$)/.test(command) || /--type=/.test(command)) continue;
    const executablePath = /^(.*?\/Contents\/MacOS\/Bruno)(\s|$)/.exec(command)![1]!;
    out.push({ pid: Number(m[1]), command, executablePath });
  }
  return out;
}

/**
 * Ask a user-launched Bruno to quit the way the Dock would (measured: exit 0 in ~400 ms), then wait
 * for it to disappear. Returns false if it is still running after `timeoutMs`.
 */
export async function quitBrunoGracefully(timeoutMs = 15_000): Promise<boolean> {
  await execFileP('/usr/bin/osascript', ['-e', 'tell application "Bruno" to quit'], { timeout: timeoutMs }).catch(() => undefined);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await findRunningBruno()).length === 0) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return (await findRunningBruno()).length === 0;
}
