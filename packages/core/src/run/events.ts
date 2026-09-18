import type { RunEvent } from '@bruno-capture/shared';

type Listener = (event: RunEvent | null) => void;

/**
 * Append-only event log per run with replay, so an SSE client that connects late or reconnects
 * still renders correct state (plan §4 "Run engine"). `null` marks the end of the stream.
 */
export class RunEventBus {
  private readonly history: RunEvent[] = [];
  private readonly listeners = new Set<Listener>();
  private closed = false;

  emit(event: RunEvent): void {
    if (this.closed) return;
    // Preview frames are transient (PRD §59): keep only the latest in history.
    if (event.type === 'preview.frame') {
      const i = this.history.findIndex((e) => e.type === 'preview.frame');
      if (i >= 0) this.history.splice(i, 1);
    }
    this.history.push(event);
    for (const l of this.listeners) l(event);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const l of this.listeners) l(null);
    this.listeners.clear();
  }

  events(): readonly RunEvent[] { return this.history; }
  isClosed(): boolean { return this.closed; }

  /** Replays history, then streams live events until the bus closes or `signal` aborts. */
  async *iterate(signal?: AbortSignal): AsyncGenerator<RunEvent> {
    const queue: Array<RunEvent | null> = [...this.history];
    let wake: (() => void) | undefined;
    const listener: Listener = (e) => { queue.push(e); wake?.(); };
    if (this.closed) queue.push(null); else this.listeners.add(listener);
    const onAbort = () => { queue.push(null); wake?.(); };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      while (true) {
        if (queue.length === 0) await new Promise<void>((r) => { wake = r; });
        wake = undefined;
        while (queue.length) {
          const e = queue.shift()!;
          if (e === null) return;
          yield e;
        }
      }
    } finally {
      this.listeners.delete(listener);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}
