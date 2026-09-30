import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// node render.mjs --file composition-a.html [--stills 1,2,3] [--fps 60] [--start s] [--end s] [--outdir frames-a]
const args = process.argv.slice(2);
function opt(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
}

const FILE = opt('file', 'composition.html');
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('PAGE ERROR:', e.message));
page.on('console', m => { if (m.type() === 'error') console.error('CONSOLE:', m.text()); });
await page.goto('file://' + join(HERE, FILE));
await page.evaluate(() => window.READY);
await page.waitForTimeout(300);

const DUR = await page.evaluate(() => window.DURATION);
console.log('DURATION', DUR);

const stills = opt('stills', null);
if (stills) {
  mkdirSync(join(HERE, 'stills'), { recursive: true });
  const tag = FILE.replace(/\W+/g, '').replace('compositionhtml', '').replace('html', '') || 'x';
  for (const ts of stills.split(',').map(Number)) {
    await page.evaluate(t => window.seek(t), ts);
    await page.waitForTimeout(50);
    const buf = await page.screenshot({ type: 'png' });
    writeFileSync(join(HERE, 'stills', `${tag}_t${ts.toFixed(2).replace('.', '_')}.png`), buf);
    console.log('still', ts);
  }
} else {
  const fps = Number(opt('fps', 60));
  const start = Number(opt('start', 0));
  const end = Number(opt('end', DUR));
  const outdir = opt('outdir', 'frames');
  mkdirSync(join(HERE, outdir), { recursive: true });
  const n0 = Math.round(start * fps), n1 = Math.round(end * fps);
  const T0 = Date.now();
  for (let i = n0; i < n1; i++) {
    await page.evaluate(t => window.seek(t), i / fps);
    const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
    writeFileSync(join(HERE, outdir, `f${String(i).padStart(5, '0')}.jpg`), buf);
    if (i % 240 === 0) {
      const el = (Date.now() - T0) / 1000, done = i - n0 + 1;
      console.log(`frame ${i}/${n1} · ${(done / el).toFixed(1)} fps · eta ${((n1 - i) / (done / el)).toFixed(0)}s`);
    }
  }
  console.log('frames listos en', ((Date.now() - T0) / 1000).toFixed(0), 's');
}
await browser.close();
