import type { Locator, Page } from 'playwright';
import { cursorOverlayScript } from './overlay.js';

export type CursorMode = 'hidden' | 'visible' | 'smooth';
export interface Point { x: number; y: number }

declare global {
  interface Window {
    __bruCursor?: { set(x: number, y: number): void; animate(x: number, y: number, ms: number): Promise<void>; press(ms?: number): Promise<void>; show(): void; hide(): void; pos(): Point };
  }
}

/** PRD §58: ~200–350 ms per movement, adjusted for distance. Deterministic. */
export function moveDurationMs(distancePx: number): number {
  return Math.round(200 + 150 * Math.min(1, distancePx / 900));
}

export interface CursorControllerOptions { initial?: Point; log?: (m: string) => void }

/**
 * Routes user-visible pointer interactions through the overlay. `hidden` delegates straight to
 * Playwright (no injection at all); `visible` jumps; `smooth` animates the overlay in-page while the
 * real mouse follows so hover states match what the viewer sees.
 */
export class CursorController {
  private pos: Point;
  private installed = false;

  constructor(private readonly page: Page, public readonly mode: CursorMode, private readonly opts: CursorControllerOptions = {}) {
    this.pos = opts.initial ?? { x: 0, y: 0 };
  }

  async install(viewport?: { width: number; height: number }): Promise<void> {
    if (this.mode === 'hidden' || this.installed) return;
    if (!this.opts.initial && viewport) this.pos = { x: Math.round(viewport.width * 0.55), y: Math.round(viewport.height * 0.6) };
    await this.page.addInitScript(cursorOverlayScript());
    await this.page.evaluate(cursorOverlayScript());
    await this.page.evaluate(([x, y]) => window.__bruCursor?.set(x, y), [this.pos.x, this.pos.y] as const);
    await this.page.mouse.move(this.pos.x, this.pos.y);
    this.installed = true;
    this.opts.log?.(`cursor ${this.mode} at ${this.pos.x},${this.pos.y}`);
  }

  position(): Point { return { ...this.pos }; }

  async moveTo(target: Point): Promise<void> {
    const x = Math.round(target.x), y = Math.round(target.y);
    if (this.mode === 'hidden') { await this.page.mouse.move(x, y); this.pos = { x, y }; return; }
    if (!this.installed) await this.install();
    if (this.mode === 'visible') {
      await this.page.evaluate(([px, py]) => window.__bruCursor?.set(px, py), [x, y] as const);
      await this.page.mouse.move(x, y);
    } else {
      const dist = Math.hypot(x - this.pos.x, y - this.pos.y);
      const ms = moveDurationMs(dist);
      await Promise.all([
        this.page.evaluate(([px, py, d]) => window.__bruCursor?.animate(px, py, d), [x, y, ms] as const),
        this.page.mouse.move(x, y, { steps: Math.max(2, Math.round(ms / 16)) }),
      ]);
    }
    this.pos = { x, y };
  }

  private async centerOf(locator: Locator, position?: Point): Promise<Point> {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) throw new Error('cursor target has no bounding box (not visible?)');
    return position ? { x: box.x + position.x, y: box.y + position.y } : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  async hover(locator: Locator): Promise<void> {
    if (this.mode === 'hidden') { await locator.hover(); return; }
    await this.moveTo(await this.centerOf(locator));
    await locator.hover();
  }

  async click(locator: Locator, opts: { position?: Point; timeout?: number } = {}): Promise<void> {
    if (this.mode === 'hidden') { await locator.click({ position: opts.position, timeout: opts.timeout }); return; }
    await this.moveTo(await this.centerOf(locator, opts.position));
    if (this.mode === 'smooth') await this.page.evaluate(() => window.__bruCursor?.press(120));
    await locator.click({ position: opts.position, timeout: opts.timeout });
  }

  async setVisible(visible: boolean): Promise<void> {
    if (this.mode === 'hidden' || !this.installed) return;
    await this.page.evaluate((v) => (v ? window.__bruCursor?.show() : window.__bruCursor?.hide()), visible);
  }
}
