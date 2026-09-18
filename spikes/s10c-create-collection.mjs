// S10c: inline "create collection" editor in the sidebar (4.1.0 has no modal for it).
import { register } from 'tsx/esm/api'; register();
import fs from 'node:fs'; import path from 'node:path';
const { launchBruno, setContentSize, seedCaptureProfile } = await import('../packages/automation/src/index.ts');
const scratch = process.env.SCRATCH;
const profile = path.join(scratch, 's10c-profile'); fs.rmSync(profile, { recursive: true, force: true });
await seedCaptureProfile({ dir: profile, collections: [], sidebarWidth: 220, brunoVersion: '4.1.0' });
const s = await launchBruno({ executablePath: '/Applications/Bruno.app/Contents/MacOS/Bruno', profileMode: 'capture', captureProfileDir: profile });
await setContentSize(s, { width: 1600, height: 1000, x: 40, y: 60 });
const page = s.page; const J = (o, n = 1600) => JSON.stringify(o).slice(0, n);
const dump = (sel, max = 30) => page.evaluate(([sel, max]) => [...document.querySelectorAll(sel)].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).slice(0, max).map(e => ({ tag: e.tagName.toLowerCase(), testid: e.getAttribute('data-testid'), role: e.getAttribute('role'), aria: e.getAttribute('aria-label'), title: e.getAttribute('title'), ph: e.getAttribute('placeholder'), cls: (e.className || '').toString().slice(0, 40), text: (e.innerText || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 30) })), [sel, max]);
await page.locator('[data-testid="collections-header-add-menu"]').first().click(); await page.locator('[data-testid="collections-header-add-menu-create"]').click(); await page.waitForTimeout(500);
console.log('1. sidebar inline editor controls:', J(await dump('[data-testid="sidebar"] input, [data-testid="sidebar"] button, [data-testid="sidebar"] [data-testid]:not([data-testid="sidebar"]), [data-testid="sidebar"] svg[class*="tabler"]', 30)));
const input = page.locator('[data-testid="sidebar"] input').first();
console.log('2. input attrs:', J(await input.evaluate(e => ({ testid: e.getAttribute('data-testid'), value: e.value, ph: e.placeholder, selectionStart: e.selectionStart, selectionEnd: e.selectionEnd, focused: document.activeElement === e }))));
await input.fill('Spike Collection');
await page.screenshot({ path: 'spikes/out/s10c-inline.png' });
await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
console.log('3. after Enter rows:', J(await dump('[data-testid="sidebar-collection-row"]', 5)), '| input still?', await input.isVisible().catch(() => false));
console.log('4. disk:', fs.existsSync(path.join(profile, 'collections')) ? fs.readdirSync(path.join(profile, 'collections')) : 'no profile/collections', '| workspace.yml:', fs.readFileSync(path.join(profile, 'default-workspace', 'workspace.yml'), 'utf8').slice(0, 400));
console.log('5. body text:', J(await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 300))));
await page.screenshot({ path: 'spikes/out/s10c-after.png' });
// second: does the gear open a location picker (native dialog risk)?
await page.locator('[data-testid="collections-header-add-menu"]').first().click(); await page.locator('[data-testid="collections-header-add-menu-create"]').click(); await page.waitForTimeout(400);
const gear = page.locator('[data-testid="sidebar"] input ~ * , [data-testid="sidebar"] [class*="settings"], [data-testid="sidebar"] svg').first();
console.log('6. cancel path: Escape closes editor?'); await page.keyboard.press('Escape'); await page.waitForTimeout(300); console.log('   input visible after Escape:', await page.locator('[data-testid="sidebar"] input').first().isVisible().catch(() => false));
await s.close();
