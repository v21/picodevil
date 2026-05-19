import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=metal', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('console', msg => {
  if (msg.type() === 'error') console.log('[error]', msg.text().substring(0, 300));
});
page.on('pageerror', err => console.error('[page error]', err.message));

await page.goto('http://localhost:5173');
await page.waitForFunction(() => typeof window.uzuEval === 'function', null, { timeout: 10000 });
console.log('App ready');

// wght=300
await page.evaluate(c => window.uzuEval(c), `$: text("Hello").font('Hepta Slab').fontAxis('wght', 300)`);
await page.waitForTimeout(3000);
writeFileSync('/tmp/fontaxis-thin.png', await page.screenshot());
console.log('wght=300 → /tmp/fontaxis-thin.png');

// wght=900
await page.evaluate(c => window.uzuEval(c), `$: text("Hello").font('Hepta Slab').fontAxis('wght', 900)`);
await page.waitForTimeout(500);
writeFileSync('/tmp/fontaxis-bold.png', await page.screenshot());
console.log('wght=900 → /tmp/fontaxis-bold.png');

await browser.close();
