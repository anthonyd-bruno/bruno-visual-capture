import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { WorkflowSources } from '@bruno-capture/shared';
import type { RegistrySnapshot, WorkflowRegistry } from './registry.js';

export interface WorkflowWatcherOptions {
  registry: WorkflowRegistry;
  sources: () => WorkflowSources;
  builtInDir: string;
  /** Phase 9: generated workflows directory (created lazily; watched once it exists). */
  generatedDir?: string;
  debounceMs?: number;
  log?: (message: string) => void;
  onRefresh?: (snapshot: RegistrySnapshot, changedPaths: string[]) => void;
}

const YAML = /\.ya?ml$/i;

/**
 * PRD §29/§97: watch every workflow source, debounce bursts (editors write several times), reload
 * through the registry, and report. Active runs are unaffected by design — the engine holds its own
 * copy of the definition and raw YAML from run creation.
 */
export class WorkflowWatcher {
  private watcher?: FSWatcher;
  private timer?: NodeJS.Timeout;
  private pending = new Set<string>();
  private refreshing: Promise<void> | undefined;

  constructor(private readonly opts: WorkflowWatcherOptions) {}

  paths(): string[] {
    const s = this.opts.sources();
    return [this.opts.builtInDir, ...(this.opts.generatedDir ? [this.opts.generatedDir] : []), ...s.customDirectories, ...s.importedFiles.map((f) => f.path)];
  }

  async start(): Promise<void> {
    await this.stop();
    const targets = this.paths();
    this.watcher = watch(targets, {
      ignoreInitial: true, persistent: true, depth: 4,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
      ignored: (p, stats) => Boolean(stats?.isFile() && !YAML.test(p)) || path.basename(p).startsWith('.'),
    });
    const onChange = (p: string) => { if (YAML.test(p) || !path.extname(p)) this.schedule(p); };
    this.watcher.on('add', onChange).on('change', onChange).on('unlink', onChange).on('addDir', onChange).on('unlinkDir', onChange);
    this.watcher.on('error', (e) => this.opts.log?.(`workflow watcher error: ${(e as Error).message}`));
    this.opts.log?.(`watching ${targets.length} workflow source(s)`);
  }

  /** Call after sources change (import / directory add or remove). */
  async restart(): Promise<void> { await this.start(); }

  async stop(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    await this.watcher?.close();
    this.watcher = undefined;
  }

  private schedule(p: string): void {
    this.pending.add(p);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, this.opts.debounceMs ?? 300);
  }

  private async flush(): Promise<void> {
    if (this.refreshing) { await this.refreshing; if (this.pending.size) this.schedule([...this.pending][0]!); return; }
    const changed = [...this.pending]; this.pending.clear();
    this.refreshing = (async () => {
      try {
        const snap = await this.opts.registry.refresh();
        this.opts.log?.(`workflows reloaded after change: ${changed.map((c) => path.basename(c)).join(', ')} → ${snap.total} files, ${snap.invalid} invalid`);
        this.opts.onRefresh?.(snap, changed);
      } catch (e) {
        this.opts.log?.(`workflow reload failed: ${(e as Error).message}`);
      }
    })();
    await this.refreshing;
    this.refreshing = undefined;
  }
}
