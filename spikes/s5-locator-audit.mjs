// S5 — live locator audit of the gap areas: theme signals, Runner entry point, HTTP send, Timeline, env, OpenAPI.
import { _electron as electron } from 'playwright';
const exe = '/Applications/Bruno.app/Contents/MacOS/Bruno';
const app = await electron.launch({ executablePath: exe, timeout: 45_000 });
const J = (o, n = 2500) => JSON.stringify(o).slice(0, n);
try {
  const win = await app.firstWindow({ timeout: 45_000 });
  await win.locator('[data-testid="sidebar"]').waitFor({ timeout: 20_000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentBounds({ x: 40, y: 60, width: 1600, height: 1000 }, false));
  await win.waitForTimeout(600);
  const dump = (sel, max = 60) => win.evaluate(([sel, max]) => [...document.querySelectorAll(sel)].slice(0, max).map(e => ({
    tag: e.tagName.toLowerCase(), testid: e.getAttribute('data-testid'), role: e.getAttribute('role'), aria: e.getAttribute('aria-label'),
    title: e.getAttribute('title'), text: (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40) })), [sel, max]);

  console.log('1. THEME signals:', J(await win.evaluate(() => ({
    htmlClass: document.documentElement.className, dataTheme: document.documentElement.getAttribute('data-theme'), bodyClass: document.body.className,
    localStorageKeys: Object.keys(localStorage).filter(k => /theme|mode|pref/i.test(k)).map(k => `${k}=${String(localStorage.getItem(k)).slice(0, 60)}`),
    bg: getComputedStyle(document.body).backgroundColor }))));

  const rows = win.locator('[data-testid="sidebar-collection-row"]');
  console.log('2. COLLECTIONS:', await rows.count(), J(await rows.allInnerTexts(), 300));
  await rows.first().hover(); await win.waitForTimeout(300);
  const ca = win.locator('[data-testid="collection-actions"]').first();
  console.log('   collection-actions visible after hover:', await ca.isVisible().catch(() => false));
  await ca.click({ timeout: 5000 }).catch(e => console.log('   click failed:', String(e.message).split('\n')[0]));
  await win.waitForTimeout(500);
  console.log('3. COLLECTION MENU items:', J(await dump('[data-testid^="collection-actions-"], [role="menuitem"], [class*="dropdown-item"], [class*="menu"] [data-testid]')));
  await win.screenshot({ path: 'out/s5-menu.png' });
  await win.keyboard.press('Escape'); await win.waitForTimeout(300);

  await rows.first().click(); await win.waitForTimeout(800);
  const items = win.locator('[data-testid="sidebar-collection-item-row"]');
  console.log('4. ITEMS after expanding first collection:', await items.count());
  if (await items.count()) { await items.first().click(); await win.waitForTimeout(1500); }
  console.log('   request-pane visible:', await win.locator('[data-testid="request-pane"]').isVisible().catch(() => false), '| response-pane:', await win.locator('[data-testid="response-pane"]').isVisible().catch(() => false));

  console.log('5. URL BAR controls:', J(await dump('[data-testid="url-bar-container"] button, [data-testid="url-bar-container"] [role="button"], [data-testid="url-bar-container"] [title], [data-testid="url-bar-container"] [data-testid]')));
  console.log('   url-bar innerHTML head:', J(await win.locator('[data-testid="url-bar-container"]').evaluate(e => e.innerHTML).catch(() => 'n/a'), 1800));
  console.log('   getByText(/^send$/i):', await win.getByText(/^send$/i).count(), '| [title*=Send]:', await win.locator('[title*="Send" i]').count(), '| aria-label*=send:', await win.locator('[aria-label*="send" i]').count());

  console.log('6. RESPONSE PANE tabs/controls:', J(await dump('[data-testid="response-pane"] [role="tab"], [data-testid="response-pane"] [class*="tab"], [data-testid="response-pane"] [data-testid]', 40)));
  console.log('   Timeline text matches:', await win.getByText(/timeline/i).count(), J(await win.getByText(/timeline/i).evaluateAll(es => es.map(e => ({ tag: e.tagName, cls: e.className, testid: e.getAttribute('data-testid') }))), 600));

  console.log('7. RUNNER element(s):', J(await dump('[data-testid="runner"]')), '| text "Runner":', await win.getByText(/^runner$/i).count());
  console.log('8. API SPECS header:', J(await dump('[data-testid="api-specs-header-add-menu"]')), '| text "API Spec":', await win.getByText(/api spec/i).count());

  await win.locator('[data-testid="environment-selector-trigger"]').click().catch(() => {}); await win.waitForTimeout(500);
  console.log('9. ENV dropdown:', J(await dump('[data-testid^="env-"], [data-testid="configure-env"]', 30)));
  await win.keyboard.press('Escape');

  console.log('10. DEVTOOLS/bottom bar:', J(await dump('[data-testid="toggle-devtools-button"], [data-testid="settings-tab-bar"] *[data-testid], [data-testid="workspace-menu"]', 30)));
  await win.screenshot({ path: 'out/s5-request.png' });
  console.log('S5 DONE');
} catch (e) { console.log('S5 FAIL:', String(e.message).split('\n')[0]); } finally { await app.close().catch(() => {}); }
