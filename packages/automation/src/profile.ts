import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as toYaml } from 'yaml';

/** A collection entry as Bruno's `workspace.yml` lists it (measured S6). */
export interface WorkspaceCollectionRef { name: string; path: string }

export interface CaptureProfileSeed {
  /** The `--user-data-dir` directory. Created if missing. */
  dir: string;
  workspaceName?: string;
  collections: WorkspaceCollectionRef[];
  sidebarWidth?: number;
  devToolsOpen?: boolean;
  /** Environment name to pre-select on every seeded collection (file must exist in `environments/`). */
  selectedEnvironment?: string;
  /** Written into onboarding.lastSeenVersion; use the detected Bruno version. */
  brunoVersion?: string;
}

export interface SeededProfile { dir: string; workspaceDir: string; workspaceFile: string; uiStateFile: string; preferencesFile: string }

interface WorkspaceYaml {
  opencollection: string;
  info: { name: string; type: 'workspace' };
  collections: WorkspaceCollectionRef[];
  specs?: unknown[];
  docs?: string;
  [k: string]: unknown;
}

function workspaceYaml(name: string, collections: WorkspaceCollectionRef[]): WorkspaceYaml {
  return { opencollection: '1.0.0', info: { name, type: 'workspace' }, collections, specs: [], docs: '' };
}

function uiStateSnapshot(workspaceDir: string, collections: WorkspaceCollectionRef[], sidebarWidth: number, devToolsOpen: boolean, selectedEnvironment?: string) {
  return {
    version: '0.0.1',
    activeWorkspacePath: workspaceDir,
    extras: {
      devTools: { open: devToolsOpen, activeTab: 'terminal', tabs: { terminal: {} } },
      sidebar: { collapsed: false, width: sidebarWidth },
    },
    workspaces: [{
      pathname: workspaceDir,
      environment: '',
      lastActiveCollectionPathname: collections[0]?.path ?? null,
      activeWorkspaceTabType: null,
      sorting: 'default',
      collections: collections.map((c) => c.path),
    }],
    // Per-collection UI state (measured): `isOpen` is what makes Bruno mount a collection at startup.
    collections: collections.map((c) => ({
      pathname: c.path,
      workspacePathname: workspaceDir,
      environment: {},
      environmentPath: selectedEnvironment ? `${c.path}/environments/${selectedEnvironment}.yml` : null,
      selectedEnvironment: selectedEnvironment ?? null,
      isOpen: true,
      isMounted: true,
      activeTab: {},
      tabs: [],
    })),
  };
}

/** Marks the profile as already onboarded so first launch does not create a sample collection. */
function preferencesSeed(profileDir: string, workspaceDir: string, brunoVersion: string) {
  return {
    preferences: {
      onboarding: { hasLaunchedBefore: true, hasSeenWelcomeModal: true, lastSeenVersion: brunoVersion, hasSentFirstRequest: true },
      general: { defaultLocation: `${profileDir}/collections`, defaultWorkspacePath: workspaceDir },
      autoupdate: { enabled: false },
      telemetry: { enabled: false },
    },
    themeMode: 'system',
  };
}

/**
 * D3/D4: write the two files Bruno reads at startup so the fixture collection is already in the
 * workspace on first launch. Doing this *before* the first launch also stops onboarding from creating
 * a sample collection under ~/Documents/bruno (measured S6). Idempotent.
 */
export async function seedCaptureProfile(seed: CaptureProfileSeed): Promise<SeededProfile> {
  const workspaceDir = path.join(seed.dir, 'default-workspace');
  await mkdir(path.join(workspaceDir, 'collections'), { recursive: true });
  await mkdir(path.join(workspaceDir, 'environments'), { recursive: true });
  const workspaceFile = path.join(workspaceDir, 'workspace.yml');
  const uiStateFile = path.join(seed.dir, 'ui-state-snapshot.json');
  await writeFile(workspaceFile, toYaml(workspaceYaml(seed.workspaceName ?? 'Bruno Capture', seed.collections)), 'utf8');
  await writeFile(uiStateFile, JSON.stringify(uiStateSnapshot(workspaceDir, seed.collections, seed.sidebarWidth ?? 250, seed.devToolsOpen ?? false, seed.selectedEnvironment), null, 2) + '\n', 'utf8');
  const preferencesFile = path.join(seed.dir, 'preferences.json');
  await mkdir(path.join(seed.dir, 'collections'), { recursive: true });
  await writeFile(preferencesFile, JSON.stringify(preferencesSeed(seed.dir, workspaceDir, seed.brunoVersion ?? '0.0.0'), null, '\t') + '\n', 'utf8');
  return { dir: seed.dir, workspaceDir, workspaceFile, uiStateFile, preferencesFile };
}

export interface UserWorkspacePatch {
  /** The user's Bruno userData dir (`~/Library/Application Support/bruno`). */
  userDataDir: string;
  collection: WorkspaceCollectionRef;
  /** Where to copy the original files before touching them (PRD risk register). */
  backupDir: string;
}

export interface UserWorkspacePatchResult { workspaceFile: string; added: boolean; backedUpTo: string[] }

/**
 * `profileMode: 'user'` (PRD §23): add the fixture collection to the user's active workspace. Backs up
 * `workspace.yml` (and the ui-state snapshot, which Bruno rewrites) first. Never removes anything.
 */
export async function addCollectionToUserWorkspace(p: UserWorkspacePatch): Promise<UserWorkspacePatchResult> {
  const uiStateFile = path.join(p.userDataDir, 'ui-state-snapshot.json');
  let workspaceDir = path.join(p.userDataDir, 'default-workspace');
  try {
    const ui = JSON.parse(await readFile(uiStateFile, 'utf8')) as { activeWorkspacePath?: string };
    if (ui.activeWorkspacePath) workspaceDir = ui.activeWorkspacePath;
  } catch { /* fall back to default-workspace */ }
  const workspaceFile = path.join(workspaceDir, 'workspace.yml');
  if (!(await stat(workspaceFile).then((s) => s.isFile()).catch(() => false))) throw new Error(`Bruno workspace file not found at ${workspaceFile}`);

  await mkdir(p.backupDir, { recursive: true });
  const backedUpTo: string[] = [];
  for (const f of [workspaceFile, uiStateFile]) {
    if (await stat(f).then(() => true).catch(() => false)) {
      const dest = path.join(p.backupDir, path.basename(f));
      await copyFile(f, dest);
      backedUpTo.push(dest);
    }
  }

  const doc = parseYaml(await readFile(workspaceFile, 'utf8')) as WorkspaceYaml;
  doc.collections ??= [];
  const added = !doc.collections.some((c) => c.path === p.collection.path);
  if (added) {
    doc.collections.push({ name: p.collection.name, path: p.collection.path });
    await writeFile(workspaceFile, toYaml(doc), 'utf8');
  }
  return { workspaceFile, added, backedUpTo };
}
