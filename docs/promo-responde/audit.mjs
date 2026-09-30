/* Auditor de encuadre: recorre el video y avisa si algún texto se sale
   del marco seguro. Mide con getBoundingClientRect, así que contempla
   la escala del stage + el zoom/temblor de la cámara en ese instante. */
import { chromium } from 'playwright-core';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = process.argv.slice(2);
const FILE = args[args.indexOf('--file') + 1] || 'composition-g.html';
const STEP = Number(args[args.indexOf('--step') + 1] || 0.1);
/* zona segura: por dentro del marco del HUD (58px) con un respiro */
const SAFE = { x0: 74, x1: 1006, y0: 92, y1: 1828 };

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
page.on('pageerror', e => console.error('PAGE ERROR:', e.message));
await page.goto('file://' + join(HERE, FILE));
await page.evaluate(() => window.READY);

const DUR = await page.evaluate(() => window.DURATION);
const worst = new Map();
for (let t = 0; t <= DUR; t += STEP) {
  const bad = await page.evaluate(({ t, SAFE }) => {
    window.seek(t);
    const out = [];
    const stage = document.getElementById('stage');
    const phone = document.getElementById('phone');
    const walk = el => {
      for (const c of el.children) {
        const cs = getComputedStyle(c);
        if (cs.display === 'none' || parseFloat(cs.opacity) < 0.06) continue;
        if (phone && phone.contains(c)) continue;          // el teléfono recorta lo suyo
        const hasText = [...c.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
        if (hasText) {
          /* medir los GLIFOS, no la caja: un div de 1080 centrado no desborda */
          const rg = document.createRange();
          rg.selectNodeContents(c);
          const r = rg.getBoundingClientRect();
          /* si una máscara (overflow:hidden) lo está tapando, no cuenta */
          let clipped = false;
          for (let p = c.parentElement; p && p !== document.body; p = p.parentElement) {
            if (getComputedStyle(p).overflow === 'hidden') {
              const pr = p.getBoundingClientRect();
              const ov = Math.min(r.bottom, pr.bottom) - Math.max(r.top, pr.top);
              if (ov < r.height * 0.45) { clipped = true; break; }
            }
          }
          if (clipped) continue;
          if (String(c.className).includes('ghostnum')) continue;   /* decorativo de fondo */
          if (r.width > 2 && (r.left < SAFE.x0 || r.right > SAFE.x1 || r.top < SAFE.y0 || r.bottom > SAFE.y1)) {
            out.push({
              id: c.id || (c.className && String(c.className).slice(0, 24)) || c.tagName,
              txt: (c.textContent || '').trim().slice(0, 28),
              l: Math.round(r.left), r: Math.round(r.right),
              tp: Math.round(r.top), b: Math.round(r.bottom),
            });
          }
        }
        walk(c);
      }
    };
    walk(stage);
    return out;
  }, { t, SAFE });
  for (const b of bad) {
    const over = Math.max(SAFE.x0 - b.l, b.r - SAFE.x1, SAFE.y0 - b.tp, b.b - SAFE.y1);
    const k = b.id + '|' + b.txt;
    if (!worst.has(k) || worst.get(k).over < over) worst.set(k, { ...b, over, t: t.toFixed(2) });
  }
}
await browser.close();

if (!worst.size) console.log('✓ sin desbordes —', FILE);
else {
  console.log('DESBORDES en', FILE, '(marco seguro', SAFE.x0 + '–' + SAFE.x1 + ')');
  [...worst.values()].sort((a, b) => b.over - a.over).forEach(w =>
    console.log(`  ${String(Math.round(w.over)).padStart(4)}px  t=${w.t}  ${w.id}  [${w.l}→${w.r}]  "${w.txt}"`));
}
