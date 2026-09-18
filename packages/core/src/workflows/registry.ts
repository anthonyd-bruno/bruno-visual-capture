import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import {
  WorkflowDefinitionSchema, selectorDebt,
  type Capabilities, type CapturePreset, type WorkflowDefinition, type WorkflowSourceKind, type WorkflowSources, type WorkflowSummary,
} from '@bruno-capture/shared';

export interface WorkflowIssue { path: string; message: string }

/** One YAML file as the registry sees it — valid or not, it stays listed (PRD §28, §96). */
export interface LoadedWorkflow {
  /** Present when the file parsed far enough to have an id, even if validation failed. */
  id?: string;
  file: string;
  source: WorkflowSourceKind;
  /** The directory (built-in/custom) or the file itself (imported) that this came from. */
  sourcePath: string;
  importId?: string;
  definition?: WorkflowDefinition;
  rawText: string;
  issues: WorkflowIssue[];
  loadedAt: string;
}

export interface RegistrySnapshot { workflows: LoadedWorkflow[]; total: number; invalid: number; refreshedAt: string }

/** `<repo>/workflows` — built-ins ship with the app (PRD §27). */
export function builtInWorkflowsDir(): string {
  return fileURLToPath(new URL('../../../../workflows/', import.meta.url));
}
export function bundledFixturesDir(): string {
  return fileURLToPath(new URL('../../../../fixtures/', import.meta.url));
}

const YAML_EXT = new Set(['.yaml', '.yml']);

async function listYamlFiles(dir: string, depth = 0): Promise<string[]> {
  if (depth > 4) return [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  const out: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listYamlFiles(full, depth + 1)));
    else if (YAML_EXT.has(path.extname(e.name).toLowerCase())) out.push(full);
  }
  return out.sort();
}

export interface LoadOptions { fixturesDir?: string }

/** Read, parse and validate one file. Never throws — errors become issues on the returned record. */
export async function loadWorkflowFile(file: string, source: WorkflowSourceKind, sourcePath: string, opts: LoadOptions = {}): Promise<LoadedWorkflow> {
  const base: LoadedWorkflow = { file, source, sourcePath, rawText: '', issues: [], loadedAt: new Date().toISOString() };
  try {
    base.rawText = await readFile(file, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    base.issues.push({ path: '', message: code === 'ENOENT' ? 'Workflow file not found' : `Cannot read file: ${(e as Error).message}` });
    return base;
  }
  let raw: unknown;
  try {
    raw = parseYaml(base.rawText, { strict: true, uniqueKeys: true });
  } catch (e) {
    const err = e as YAMLParseError;
    const where = err.linePos?.[0] ? ` (line ${err.linePos[0].line})` : '';
    base.issues.push({ path: '', message: `Invalid YAML${where}: ${err.message.split('\n')[0]}` });
    return base;
  }
  if (raw && typeof raw === 'object' && typeof (raw as { id?: unknown }).id === 'string') base.id = (raw as { id: string }).id;
  const parsed = WorkflowDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    base.issues.push(...parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })));
    return base;
  }
  base.id = parsed.data.id;
  if (parsed.data.fixture?.source === 'bundled' && opts.fixturesDir) {
    const fixturePath = path.join(opts.fixturesDir, parsed.data.fixture.path);
    const ok = await stat(fixturePath).then((s) => s.isDirectory()).catch(() => false);
    if (!ok) { base.issues.push({ path: 'fixture.path', message: `Bundled fixture not found at ${fixturePath}` }); return base; }
  }
  base.definition = parsed.data;
  return base;
}

export function summarize(lw: LoadedWorkflow): WorkflowSummary | undefined {
  const d = lw.definition;
  if (!d) return undefined;
  return {
    id: d.id, name: d.name, description: d.description, kind: d.kind, feature: d.feature, tags: d.tags,
    supportedOutputs: d.supportedOutputs, parameters: d.parameters,
    captureIds: d.steps.flatMap((s) => ('capture' in s ? [s.capture.id] : [])),
    hasRecordingBounds: d.steps.some((s) => 'startRecording' in s),
    source: lw.source, sourcePath: lw.sourcePath, valid: true, selectorDebt: selectorDebt(d),
    steps: d.steps,
    fixture: d.fixture?.source === 'inline' ? { source: 'inline', collection: { name: d.fixture.collection.name } } : d.fixture,
  };
}

export interface WorkflowRegistryOptions {
  builtInDir?: string;
  /** Phase 9: AI-composed workflows (source kind `generated`). */
  generatedDir?: string;
  fixturesDir?: string;
  sources: () => WorkflowSources;
  log?: (message: string) => void;
}

/** Phase 9: everything a composed workflow may reference beyond the registry (the server fills these). */
export interface CapabilityExtras {
  actions?: Capabilities['actions'];
  regions?: Capabilities['regions'];
  states?: Capabilities['states'];
  fixtures?: Capabilities['fixtures'];
  testIds?: string[];
  brunoVersion?: string;
}

/**
 * All workflow files from every source (PRD §27), re-read on `refresh()`. Invalid files are kept and
 * reported; a broken external file can never hide a built-in one (PRD §96). Duplicate ids: the first
 * file (built-in → custom → imported, then path order) wins and the rest are marked invalid.
 */
export class WorkflowRegistry {
  private byId = new Map<string, LoadedWorkflow>();
  private all: LoadedWorkflow[] = [];
  private refreshedAt = '';
  private readonly builtInDir: string;
  private readonly fixturesDir: string;
  readonly generatedDir?: string;

  constructor(private readonly opts: WorkflowRegistryOptions) {
    this.builtInDir = opts.builtInDir ?? builtInWorkflowsDir();
    this.fixturesDir = opts.fixturesDir ?? bundledFixturesDir();
    this.generatedDir = opts.generatedDir;
  }

  async refresh(): Promise<RegistrySnapshot> {
    const sources = this.opts.sources();
    const jobs: Array<Promise<LoadedWorkflow>> = [];
    const loadOpts = { fixturesDir: this.fixturesDir };
    for (const f of await listYamlFiles(this.builtInDir)) jobs.push(loadWorkflowFile(f, 'built-in', this.builtInDir, loadOpts));
    if (this.generatedDir) for (const f of await listYamlFiles(this.generatedDir)) jobs.push(loadWorkflowFile(f, 'generated', this.generatedDir, loadOpts));
    for (const dir of sources.customDirectories) for (const f of await listYamlFiles(dir)) jobs.push(loadWorkflowFile(f, 'custom-directory', dir, loadOpts));
    for (const imp of sources.importedFiles) jobs.push(loadWorkflowFile(imp.path, 'imported', imp.path, loadOpts).then((lw) => ({ ...lw, importId: imp.id })));
    const loaded = await Promise.all(jobs);

    const byId = new Map<string, LoadedWorkflow>();
    for (const lw of loaded) {
      if (!lw.definition) continue;
      const prev = byId.get(lw.definition.id);
      if (prev) {
        lw.issues.push({ path: 'id', message: `Duplicate workflow id "${lw.definition.id}" — already defined by ${prev.file}` });
        lw.definition = undefined;
      } else byId.set(lw.definition.id, lw);
    }
    this.byId = byId;
    this.all = loaded;
    this.refreshedAt = new Date().toISOString();
    const invalid = loaded.filter((l) => !l.definition).length;
    this.opts.log?.(`workflow registry: ${loaded.length} files, ${invalid} invalid`);
    return this.snapshot();
  }

  snapshot(): RegistrySnapshot {
    return { workflows: this.all, total: this.all.length, invalid: this.all.filter((l) => !l.definition).length, refreshedAt: this.refreshedAt };
  }

  get(id: string): LoadedWorkflow | undefined { return this.byId.get(id); }
  list(): LoadedWorkflow[] { return this.all; }
  summaries(): WorkflowSummary[] { return this.all.map(summarize).filter((s): s is WorkflowSummary => Boolean(s)); }
  stats(): { total: number; invalid: number } { const s = this.snapshot(); return { total: s.total, invalid: s.invalid }; }

  /** What the UI lists and the AI planner is told about (PRD §13, §84). */
  capabilities(presets: readonly CapturePreset[], extras: CapabilityExtras = {}): Capabilities {
    const workflows = this.summaries();
    const features = new Map<string, number>();
    for (const w of workflows) features.set(w.feature, (features.get(w.feature) ?? 0) + 1);
    return {
      features: [...features.entries()].sort().map(([id, workflowCount]) => ({ id, name: id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), workflowCount })),
      workflows,
      presets: [...presets],
      outputs: ['screenshot', 'screenshots', 'video', 'gif'],
      actions: extras.actions ?? [], regions: extras.regions ?? [], states: extras.states ?? [], fixtures: extras.fixtures ?? [],
      testIds: extras.testIds ?? [], bruno: { version: extras.brunoVersion },
    };
  }
}
