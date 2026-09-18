import {
  SettingsSchema, WorkflowSourcesSchema,
  type Settings, type SettingsPatch, type WorkflowSources,
} from '@bruno-capture/shared';
import type { AppPaths } from './paths.js';
import { readJsonFile, writeJsonFile } from './json-file.js';

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep-merge objects; arrays and scalars replace. Undefined patch values are ignored. */
export function deepMerge<T extends Plain>(base: T, patch: Plain): T {
  const out: Plain = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isPlain(v) && isPlain(out[k]) ? deepMerge(out[k] as Plain, v) : v;
  }
  return out as T;
}

/**
 * `settings.json` (PRD §82, §98). Loaded once, kept in memory, every write goes through the schema so
 * the file on disk is always complete and valid. Secrets never pass through here (PRD §12).
 */
export class SettingsStore {
  private current: Settings | undefined;

  constructor(private readonly paths: AppPaths) {}

  async load(): Promise<Settings> {
    const fromDisk = await readJsonFile(this.paths.settingsFile, SettingsSchema);
    this.current = fromDisk ?? SettingsSchema.parse({});
    if (!fromDisk) await writeJsonFile(this.paths.settingsFile, this.current);
    return this.current;
  }

  get(): Settings {
    if (!this.current) throw new Error('SettingsStore.load() has not been called');
    return this.current;
  }

  async patch(patch: SettingsPatch): Promise<Settings> {
    const next = SettingsSchema.parse(deepMerge(this.get() as unknown as Plain, patch as Plain));
    await writeJsonFile(this.paths.settingsFile, next);
    this.current = next;
    return next;
  }

  /** Effective artifact root (PRD §67). */
  artifactRoot(): string {
    return this.get().capture.artifactRoot ?? this.paths.artifactsDir;
  }
}

/** `workflow-sources.json` (PRD §27, §28): custom directories and in-place imported files. */
export class WorkflowSourcesStore {
  private current: WorkflowSources | undefined;

  constructor(private readonly paths: AppPaths) {}

  async load(): Promise<WorkflowSources> {
    this.current = (await readJsonFile(this.paths.workflowSourcesFile, WorkflowSourcesSchema)) ?? WorkflowSourcesSchema.parse({});
    return this.current;
  }

  get(): WorkflowSources {
    if (!this.current) throw new Error('WorkflowSourcesStore.load() has not been called');
    return this.current;
  }

  async addDirectory(dir: string): Promise<WorkflowSources> {
    const cur = this.get();
    if (!cur.customDirectories.includes(dir)) await this.save({ ...cur, customDirectories: [...cur.customDirectories, dir] });
    return this.get();
  }

  async removeDirectory(dir: string): Promise<WorkflowSources> {
    const cur = this.get();
    await this.save({ ...cur, customDirectories: cur.customDirectories.filter((d) => d !== dir) });
    return this.get();
  }

  async addImportedFile(id: string, file: string): Promise<WorkflowSources> {
    const cur = this.get();
    if (!cur.importedFiles.some((f) => f.path === file))
      await this.save({ ...cur, importedFiles: [...cur.importedFiles, { id, path: file, addedAt: new Date().toISOString() }] });
    return this.get();
  }

  /** PRD §80 "Remove Reference": forget the path, never touch the YAML. */
  async removeImportedFile(id: string): Promise<WorkflowSources> {
    const cur = this.get();
    await this.save({ ...cur, importedFiles: cur.importedFiles.filter((f) => f.id !== id) });
    return this.get();
  }

  private async save(next: WorkflowSources): Promise<void> {
    const parsed = WorkflowSourcesSchema.parse(next);
    await writeJsonFile(this.paths.workflowSourcesFile, parsed);
    this.current = parsed;
  }
}
