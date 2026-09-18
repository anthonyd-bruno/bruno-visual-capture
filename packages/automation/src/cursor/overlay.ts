export const CURSOR_ELEMENT_ID = '__bru_capture_cursor';

/**
 * In-page cursor overlay (PRD §58). A fixed, pointer-events:none SVG arrow whose hotspot is its
 * top-left tip. Movement is animated in-page with requestAnimationFrame so every screencast frame,
 * screenshot and preview sees the same deterministic motion; the macOS pointer is never in frame.
 * Installed via addInitScript so it survives reloads (theme.set) and via evaluate for the live page.
 */
export function cursorOverlayScript(): string {
  return `(() => {
  const ID = ${JSON.stringify(CURSOR_ELEMENT_ID)};
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const state = { x: 0, y: 0, el: null, anim: 0, visible: true };
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="30" viewBox="0 0 22 30"><path d="M2 2 L2 24 L8 18.5 L12.5 28 L16 26.5 L11.5 17.5 L20 17 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  function ensure() {
    if (state.el && document.body.contains(state.el)) return state.el;
    const el = document.createElement('div');
    el.id = ID;
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:30px;z-index:2147483647;pointer-events:none;will-change:transform;transform-origin:2px 2px;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.35));';
    el.innerHTML = svg;
    document.body.appendChild(el);
    state.el = el;
    place();
    return el;
  }
  function place() { if (state.el) state.el.style.transform = 'translate(' + (state.x - 2) + 'px,' + (state.y - 2) + 'px)'; }
  const api = {
    install() { if (document.body) ensure(); else document.addEventListener('DOMContentLoaded', () => ensure(), { once: true }); },
    set(x, y) { cancelAnimationFrame(state.anim); state.x = x; state.y = y; ensure(); place(); },
    animate(x, y, ms) {
      ensure();
      cancelAnimationFrame(state.anim);
      const x0 = state.x, y0 = state.y, t0 = performance.now();
      return new Promise((resolve) => {
        const step = (now) => {
          const t = Math.min(1, (now - t0) / ms), k = ease(t);
          state.x = x0 + (x - x0) * k; state.y = y0 + (y - y0) * k; place();
          if (t < 1) state.anim = requestAnimationFrame(step); else resolve();
        };
        state.anim = requestAnimationFrame(step);
      });
    },
    press(ms) {
      const el = ensure(); const d = ms || 120;
      el.style.transition = 'scale ' + (d / 2) + 'ms ease-out'; el.style.scale = '0.82';
      return new Promise((resolve) => setTimeout(() => { el.style.scale = '1'; setTimeout(resolve, d / 2); }, d / 2));
    },
    show() { state.visible = true; ensure().style.display = ''; },
    hide() { state.visible = false; if (state.el) state.el.style.display = 'none'; },
    pos() { return { x: state.x, y: state.y }; },
  };
  window.__bruCursor = api;
  api.install();
})();`;
}
