import { describe, expect, it } from 'vitest';
import type { Locator, Page } from 'playwright';
import { CURSOR_ELEMENT_ID, CursorController, cursorOverlayScript, moveDurationMs } from '../src/index.js';

function fakePage() {
  const calls: string[] = [];
  const page = {
    addInitScript: async () => { calls.push('addInitScript'); },
    evaluate: async (fn: unknown, arg?: unknown) => { calls.push(`evaluate:${typeof fn === 'string' ? 'script' : JSON.stringify(arg ?? null)}`); },
    mouse: { move: async (x: number, y: number, o?: { steps?: number }) => { calls.push(`mouse.move:${x},${y}${o?.steps ? `:${o.steps}` : ''}`); } },
  } as unknown as Page;
  const locator = {
    scrollIntoViewIfNeeded: async () => { calls.push('scroll'); },
    boundingBox: async () => ({ x: 100, y: 200, width: 50, height: 20 }),
    click: async (o?: unknown) => { calls.push(`click:${JSON.stringify(o ?? {})}`); },
    hover: async () => { calls.push('hover'); },
  } as unknown as Locator;
  return { page, locator, calls };
}

describe('cursor', () => {
  it('moveDurationMs stays within the PRD §58 band and grows with distance', () => {
    expect(moveDurationMs(0)).toBe(200);
    expect(moveDurationMs(450)).toBe(275);
    expect(moveDurationMs(5000)).toBe(350);
  });

  it('overlay script is self-contained and idempotent by element id', () => {
    const s = cursorOverlayScript();
    expect(s).toContain(CURSOR_ELEMENT_ID);
    expect(s).toContain('pointer-events:none');
    expect(s).toContain('window.__bruCursor');
  });

  it('hidden mode never injects anything and delegates clicks', async () => {
    const { page, locator, calls } = fakePage();
    const c = new CursorController(page, 'hidden');
    await c.install({ width: 1600, height: 1000 });
    await c.click(locator, { position: { x: 10, y: 10 } });
    expect(calls).toEqual(['click:{"position":{"x":10,"y":10}}']);
  });

  it('visible mode jumps the overlay and the mouse, then clicks', async () => {
    const { page, locator, calls } = fakePage();
    const c = new CursorController(page, 'visible');
    await c.install({ width: 1600, height: 1000 });
    expect(c.position()).toEqual({ x: 880, y: 600 });
    calls.length = 0;
    await c.click(locator);
    expect(calls).toEqual(['scroll', 'evaluate:[125,210]', 'mouse.move:125,210', 'click:{}']);
  });

  it('smooth mode animates in-page with a stepped real-mouse move and a press pulse', async () => {
    const { page, locator, calls } = fakePage();
    const c = new CursorController(page, 'smooth', { initial: { x: 0, y: 0 } });
    await c.install();
    calls.length = 0;
    await c.click(locator);
    const ms = moveDurationMs(Math.hypot(125, 210));
    expect(calls).toEqual(['scroll', `evaluate:[125,210,${ms}]`, `mouse.move:125,210:${Math.round(ms / 16)}`, 'evaluate:null', 'click:{}']);
    expect(c.position()).toEqual({ x: 125, y: 210 });
  });
});
