import type { CaptureAction } from './types.js';

export class UnknownActionError extends Error {
  readonly code = 'unknown_action';
  constructor(public readonly actionId: string, known: string[]) {
    super(`Unknown action "${actionId}". Known actions: ${known.join(', ')}`);
    this.name = 'UnknownActionError';
  }
}

export class ActionRegistry {
  private readonly actions = new Map<string, CaptureAction<unknown>>();

  register(...defs: Array<CaptureAction<unknown>>): this {
    for (const d of defs) {
      if (this.actions.has(d.id)) throw new Error(`action "${d.id}" registered twice`);
      this.actions.set(d.id, d);
    }
    return this;
  }

  get(id: string): CaptureAction<unknown> {
    const a = this.actions.get(id);
    if (!a) throw new UnknownActionError(id, [...this.actions.keys()]);
    return a;
  }

  has(id: string): boolean { return this.actions.has(id); }
  list(): CaptureAction<unknown>[] { return [...this.actions.values()]; }
  ids(): string[] { return [...this.actions.keys()]; }
}
