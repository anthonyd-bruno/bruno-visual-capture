import os from 'node:os';
import path from 'node:path';

/** PRD §67, §98 — everything Bruno Capture persists lives under one Application Support directory. */
export const DEFAULT_APP_SUPPORT_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'Bruno Capture');

export interface AppPaths {
  root: string;
  settingsFile: string;
  workflowSourcesFile: string;
  /** Default artifact root; `settings.capture.artifactRoot` may point elsewhere. */
  artifactsDir: string;
  /** Phase 9: workflows the AI composed from prompts (source kind `generated`); editable YAML like any other. */
  generatedWorkflowsDir: string;
  /** Seeded `ELECTRON_USER_DATA_PATH` for `profileMode: 'capture'` (D4). */
  profileDir: string;
  /** Copies of user Bruno files taken before we write them (risk register: seeding damage). */
  backupsDir: string;
  /** Installed native helper (stable path so TCC grants survive). */
  binDir: string;
  logsDir: string;
  tmpDir: string;
}

export function appPaths(root = process.env.BRU_CAPTURE_HOME ?? DEFAULT_APP_SUPPORT_DIR): AppPaths {
  return {
    root,
    settingsFile: path.join(root, 'settings.json'),
    workflowSourcesFile: path.join(root, 'workflow-sources.json'),
    artifactsDir: path.join(root, 'artifacts'),
    generatedWorkflowsDir: path.join(root, 'workflows', 'generated'),
    profileDir: path.join(root, 'profile'),
    backupsDir: path.join(root, 'backups'),
    binDir: path.join(root, 'bin'),
    logsDir: path.join(root, 'logs'),
    tmpDir: path.join(root, 'tmp'),
  };
}

/** The user's real Bruno profile (PRD §23). */
export const BRUNO_USER_DATA_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'bruno');
